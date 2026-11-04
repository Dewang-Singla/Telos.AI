import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { vector } from "@electric-sql/pglite-pgvector";
import { demoAccounts } from "../scripts/demo-data.mjs";

// Actual PostgreSQL, PostGIS and pgvector. The bootstrap supplies only the Supabase
// auth/storage catalog interfaces; it does not emulate cloud Auth, Storage HTTP or Realtime.
const A = "a0000000-0000-4000-8000-000000000001",
  B = "b0000000-0000-4000-8000-000000000002",
  C = "c0000000-0000-4000-8000-000000000003";
let db: PGlite;
async function asUser<T>(user: string, fn: () => Promise<T>) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function query(sql: string, params: unknown[] = []) {
  return (await db.query<Record<string, unknown>>(sql, params)).rows;
}
async function intent(
  user: string,
  description = "qwerty_shared_topic",
  extra: Record<string, unknown> = {},
  latitude = 12.97,
  longitude = 77.59,
) {
  return asUser(user, async () =>
    String(
      (
        await query("select public.save_intent($1::jsonb,null,$2,$3,25) id", [
          JSON.stringify({
            title: description.slice(0, 100),
            description,
            category: "Community",
            role: "open",
            mode: "hybrid",
            city: "Bengaluru",
            tags: [],
            skills: [],
            participants: 2,
            starts_at: null,
            ends_at: null,
            ...extra,
          }),
          latitude,
          longitude,
        ])
      )[0].id,
    ),
  );
}
async function social(
  user: string,
  body = "A public update",
  visibility = "public",
  paths: string[] = [],
) {
  return asUser(user, async () =>
    String(
      (
        await query(
          "insert into public.posts(user_id,body,visibility,media_paths) values($1,$2,$3,$4::text[]) returning id",
          [user, body, visibility, paths],
        )
      )[0].id,
    ),
  );
}

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis, vector } });
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text,owner_id text,metadata jsonb default '{}',unique(bucket_id,name));
 alter table storage.objects enable row level security;
 create function storage.foldername(object_name text) returns text[] language sql immutable as $$select (string_to_array(object_name,'/'))[1:greatest(array_length(string_to_array(object_name,'/'),1)-1,0)]$$;
 grant usage on schema auth,storage,public to anon,authenticated,service_role;grant execute on function auth.uid(),auth.role(),storage.foldername(text) to anon,authenticated,service_role;
 grant select,insert,update,delete on storage.objects to authenticated;
 create publication supabase_realtime;`);
  for (const file of readdirSync(resolve("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (file === "202611040005_profile_location.sql") {
      await db.query("insert into auth.users(id) values($1)", [A]);
      await db.query(
        "insert into public.profiles(id,name,username,city) values($1,'Legacy profile','legacy_user','Existing city')",
        [A],
      );
    }
    await db.exec(readFileSync(resolve("supabase/migrations", file), "utf8"));
    if (file === "202611040005_profile_location.sql") {
      const row = (
        await query(
          "select city,state,country from public.profiles where id=$1",
          [A],
        )
      )[0];
      expect(row).toEqual({ city: "Existing city", state: "", country: "" });
    }
  }
}, 120000);
beforeEach(async () => {
  await db.exec(
    "reset role;truncate auth.users cascade;truncate public.discovery_events;truncate storage.objects;",
  );
  await db.query("insert into auth.users(id) values($1),($2),($3)", [A, B, C]);
  for (const [id, name] of [
    [A, "Alpha"],
    [B, "Beta"],
    [C, "Gamma"],
  ])
    await asUser(id, () =>
      db.query(
        "insert into public.profiles(id,name,username) values($1,$2,$3) on conflict(id) do update set id=excluded.id,name=excluded.name,username=excluded.username",
        [id, name, name.toLowerCase()],
      ),
    );
});
afterAll(async () => {
  await db?.close();
});

describe("database privacy and independent posting", () => {
  it("reuses equivalent active searches without changing their creation time", async () => {
    const first = await intent(A, "looking for guitar tutor");
    const before = (
      await query("select created_at from public.intents where id=$1", [first])
    )[0].created_at;
    const again = await intent(A, "  LOOKING  for guitar tutor  ");
    expect(again).toBe(first);
    expect(
      (
        await query(
          "select count(*)::int n from public.intents where user_id=$1",
          [A],
        )
      )[0].n,
    ).toBe(1);
    expect(
      (
        await query("select created_at from public.intents where id=$1", [
          first,
        ])
      )[0].created_at,
    ).toEqual(before);
    const other = await intent(B, "looking for guitar tutor");
    expect(other).not.toBe(first);
  });
  it("keeps different constraints, different locations and paused searches distinct", async () => {
    const first = await intent(A, "looking for guitar tutor");
    expect(
      await intent(A, "looking for guitar tutor", { skills: ["Fingerstyle"] }),
    ).not.toBe(first);
    expect(
      await intent(A, "looking for guitar tutor", {}, 13.2, 77.59),
    ).not.toBe(first);
    await asUser(A, () =>
      query("update public.intents set status='paused' where id=$1", [first]),
    );
    expect(await intent(A, "looking for guitar tutor")).not.toBe(first);
  });
  it("loads the whole demo dataset into PostgreSQL and finds complementary nearby bots", async () => {
    const accounts = demoAccounts();
    const ids = accounts.map(
      (_, index) =>
        `e0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    await db.query(
      'insert into auth.users(id,raw_app_meta_data) select value::uuid,\'{"telos_demo":"v1"}\'::jsonb from jsonb_array_elements_text($1::jsonb)',
      [JSON.stringify(ids)],
    );
    await db.exec(
      "set role service_role;select set_config('request.jwt.claim.role','service_role',false)",
    );
    try {
      for (let index = 0; index < accounts.length; index++)
        await query("select public.seed_demo_content($1,$2::jsonb)", [
          ids[index],
          JSON.stringify(accounts[index].content),
        ]);
    } finally {
      await db.exec(
        "reset role;select set_config('request.jwt.claim.role','',false)",
      );
    }
    expect(
      (
        await query("select count(*)::int n from public.profiles where is_demo")
      )[0].n,
    ).toBe(80);
    expect(
      (await query("select count(*)::int n from public.intents"))[0].n,
    ).toBe(160);
    expect((await query("select count(*)::int n from public.posts"))[0].n).toBe(
      240,
    );
    const source = await intent(A, "any guitar trainer near me???");
    const rows = await asUser(A, () =>
      query("select * from public.find_people($1,true,30.73,76.78,2)", [
        source,
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].matched_intent).toContain("I teach guitar");
    expect(rows[1].matched_intent).toContain("Looking for a guitar tutor");
    expect(rows.every((r) => r.is_online === false)).toBe(true);
    expect(
      (await asUser(A, () => query("select public.list_posts() post"))).length,
    ).toBe(20);
  });
  it.each([
    ["Looking for a guitar tutor", "learn"],
    ["any guitar trainer near me???", "learn"],
    ["I am a guitar tutor", "teach"],
    ["I want to teach guitar", "teach"],
    ["I give guitar lessons", "teach"],
    ["I am teaching guitar", "teach"],
    ["Looking for a football coach", "learn"],
    ["I need a job as a React developer", "work"],
    ["I teach guitar and offer lessons", "teach"],
    ["Looking for someone to teach me guitar", "learn"],
    ["Hiring a React developer", "hire"],
    ["Looking for a React developer job", "work"],
    ["Looking for a graphic designer", "hire"],
    ["I need help with bicycle repair", "request"],
    ["Offering bicycle repair help", "offer"],
    ["Organizing a hiking group", "organize"],
    ["Looking to join a hiking group", "join"],
  ])("infers direction for %s without an AI key", async (text, role) => {
    expect(
      (
        await query("select private.effective_intent_role('open',$1) role", [
          text,
        ])
      )[0].role,
    ).toBe(role);
    expect(
      (
        await query(
          "select private.effective_intent_role('collaborate',$1) role",
          [text],
        )
      )[0].role,
    ).toBe("collaborate");
  });
  it("ranks a teacher above a newer fellow learner while preserving online priority", async () => {
    const source = await intent(A, "Looking for a guitar tutor");
    const teacher = await intent(B, "I teach guitar and offer lessons", {
      show_in_matches: true,
    });
    await intent(C, "Looking for a guitar tutor", { show_in_matches: true });
    let rows = await asUser(A, () =>
      query("select * from public.find_people($1)", [source]),
    );
    expect(rows.map((r) => (r.profile as { id: string }).id)).toEqual([B, C]);
    expect(rows[0].matched_intent).toBe("I teach guitar and offer lessons");
    // A person's newer peer intent must not replace their better provider match.
    await intent(B, "I want to learn guitar with another beginner", {
      show_in_matches: true,
    });
    rows = await asUser(A, () =>
      query("select * from public.find_people($1)", [source]),
    );
    expect(rows[0].matched_intent).toBe("I teach guitar and offer lessons");
    expect(JSON.stringify(rows)).not.toContain(teacher);
    await asUser(C, () =>
      query("select public.update_presence($1,true)", [crypto.randomUUID()]),
    );
    rows = await asUser(A, () =>
      query("select * from public.find_people($1)", [source]),
    );
    expect(rows.map((r) => (r.profile as { id: string }).id)).toEqual([C, B]);
  });
  it("finds job seekers instead of other hirers and rejects unrelated tutor topics", async () => {
    const source = await intent(A, "Hiring a React developer");
    await intent(B, "Hiring a React developer");
    await intent(C, "Looking for a React developer job");
    const rows = await asUser(A, () =>
      query("select * from public.find_people($1)", [source]),
    );
    expect(rows.map((r) => (r.profile as { id: string }).id)).toEqual([C]);
    const guitar = await intent(A, "Looking for a guitar tutor");
    await intent(B, "I teach piano and offer lessons");
    expect(
      await asUser(A, () =>
        query("select * from public.find_people($1)", [guitar]),
      ),
    ).toHaveLength(0);
  });
  it("shows the exact qualified real-user intent even with the legacy flag off, without making it public", async () => {
    const source = await intent(A, "Looking for a guitar tutor");
    const candidate = await intent(B, "I teach guitar and offer lessons");
    const find = () =>
      asUser(A, () => query("select * from public.find_people($1)", [source]));
    await asUser(B, () =>
      query("update public.intents set show_in_matches=false where id=$1", [
        candidate,
      ]),
    );
    expect((await find())[0].matched_intent).toBe(
      "I teach guitar and offer lessons",
    );
    expect(
      await asUser(A, () =>
        query("select * from public.intents where id=$1", [candidate]),
      ),
    ).toHaveLength(0);
    const unrelated = await intent(C, "I want to learn piano");
    const unrelatedRows = await asUser(C, () =>
      query("select * from public.find_people($1)", [unrelated]),
    );
    expect(unrelatedRows).toHaveLength(0);
    await asUser(B, () =>
      query("update public.intents set status='paused' where id=$1", [
        candidate,
      ]),
    );
    expect(await find()).toHaveLength(0);
  });
  it("restricts demo provisioning and markers to the administrator", async () => {
    await expect(
      asUser(A, () => query("select public.seed_demo_content($1,'{}')", [B])),
    ).rejects.toThrow();
    await expect(
      asUser(A, () =>
        query("update public.profiles set is_demo=true where id=$1", [A]),
      ),
    ).rejects.toThrow();
    await db.query(
      "insert into auth.users(id) values('d0000000-0000-4000-8000-000000000004')",
    );
    await expect(
      asUser("d0000000-0000-4000-8000-000000000004", () =>
        query(
          "insert into public.profiles(id,name,username,is_demo) values(auth.uid(),'Spoof','spoof_demo',true)",
        ),
      ),
    ).rejects.toThrow();
  });
  it("provisions marked offline bots idempotently without modifying real users", async () => {
    const target = "d0000000-0000-4000-8000-000000000004";
    await db.query(
      'insert into auth.users(id,raw_app_meta_data) values($1,\'{"telos_demo":"v1"}\')',
      [target],
    );
    const content = {
      profile: {
        username: "demo_test",
        name: "Demo Person",
        bio: "Demo bot",
        city: "Delhi",
        state: "Delhi",
        country: "India",
        interests: ["guitar"],
        skills: [],
      },
      intents: [
        {
          title: "Guitar lessons",
          description: "I teach guitar and offer lessons",
          category: "Community",
          role: "teach",
          mode: "online",
          city: "Delhi",
          tags: [],
          skills: [],
          starts_at: null,
          ends_at: null,
          participants: 2,
          show_in_matches: true,
        },
      ],
      posts: [{ body: "A fictional demo update" }],
    };
    await db.exec(
      "set role service_role;select set_config('request.jwt.claim.role','service_role',false)",
    );
    try {
      for (let n = 0; n < 2; n++)
        await query("select public.seed_demo_content($1,$2::jsonb)", [
          target,
          JSON.stringify(content),
        ]);
      await expect(
        query("select public.seed_demo_content($1,$2::jsonb)", [
          B,
          JSON.stringify(content),
        ]),
      ).rejects.toThrow("Not a managed demo account");
    } finally {
      await db.exec(
        "reset role;select set_config('request.jwt.claim.role','',false)",
      );
    }
    expect(
      (
        await query(
          "select count(*)::int n from public.posts where user_id=$1",
          [target],
        )
      )[0].n,
    ).toBe(1);
    expect(
      (
        await query(
          "select count(*)::int n from public.intents where user_id=$1",
          [target],
        )
      )[0].n,
    ).toBe(1);
    expect(
      (
        await query("select is_demo from public.profiles where id=$1", [target])
      )[0].is_demo,
    ).toBe(true);
    await asUser(target, () =>
      query("select public.update_presence($1,true)", [crypto.randomUUID()]),
    );
    const source = await intent(A, "Looking for a guitar tutor");
    const found = await asUser(A, () =>
      query("select * from public.find_people($1)", [source]),
    );
    expect(found[0].is_online).toBe(false);
    expect(
      (
        await query(
          "select last_seen_at>now()-interval '90 seconds' active from public.member_presence where user_id=$1",
          [target],
        )
      )[0].active,
    ).toBe(false);
  });
  it("persists and clears optional profile location under owner permissions", async () => {
    const own = await asUser(A, () =>
      query(
        "update public.profiles set city='',state='',country='India' where id=$1 returning city,state,country",
        [A],
      ),
    );
    expect(own[0]).toEqual({ city: "", state: "", country: "India" });
    expect(
      await asUser(B, () =>
        query(
          "update public.profiles set state='Forged' where id=$1 returning id",
          [A],
        ),
      ),
    ).toHaveLength(0);
    const visible = await asUser(B, () =>
      query("select city,state,country from public.profiles where id=$1", [A]),
    );
    expect(visible[0]).toEqual({ city: "", state: "", country: "India" });
    await expect(
      asUser(A, () =>
        query("update public.profiles set state=$1 where id=$2", [
          "x".repeat(101),
          A,
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(A, () =>
        query("update public.profiles set country=$1 where id=$2", [
          "x".repeat(101),
          A,
        ]),
      ),
    ).rejects.toThrow();
    await asUser(A, () =>
      query(
        "update public.profiles set city='',state='',country='' where id=$1",
        [A],
      ),
    );
    expect(
      (
        await asUser(A, () =>
          query("select city,state,country from public.profiles where id=$1", [
            A,
          ]),
        )
      )[0],
    ).toEqual({ city: "", state: "", country: "" });
  });
  it("searches social post text while enforcing visibility and keeping intents out", async () => {
    await intent(A, "qwerty_search_private");
    const visible = await social(A, "Café and photos");
    await social(B, "Café and photos", "connections");
    const found = await asUser(C, () =>
      query("select public.list_posts(search_text=>$1) post", ["Café"]),
    );
    expect(found.map((r) => (r.post as { id: string }).id)).toEqual([visible]);
    expect(
      await asUser(C, () =>
        query("select public.list_posts(search_text=>$1) post", [
          "qwerty_search_private",
        ]),
      ),
    ).toHaveLength(0);
    expect(
      await asUser(C, () =>
        query("select public.list_posts(search_text=>$1) post", [
          "%' OR true --",
        ]),
      ),
    ).toHaveLength(0);
    await asUser(A, () =>
      query("insert into public.blocks(blocker_id,blocked_id) values($1,$2)", [
        A,
        C,
      ]),
    );
    expect(
      await asUser(C, () =>
        query("select public.list_posts(search_text=>$1) post", ["Café"]),
      ),
    ).toHaveLength(0);
  });
  it("keeps follows one-way, idempotent, and separate from private access", async () => {
    const post = await social(B, "For connections", "connections");
    await asUser(A, () => query("select public.set_follow($1,true)", [B]));
    await asUser(A, () => query("select public.set_follow($1,true)", [B]));
    const state = (
      await asUser(A, () =>
        query("select public.relationship_status($1) state", [B]),
      )
    )[0].state;
    expect(state).toMatchObject({
      following: true,
      follows_you: false,
      connection: "none",
      follower_count: 1,
      following_count: 0,
    });
    expect(
      await asUser(A, () =>
        query("select id from public.posts where id=$1", [post]),
      ),
    ).toHaveLength(0);
    expect(
      await asUser(C, () => query("select * from public.follows")),
    ).toHaveLength(0);
    await expect(
      asUser(A, () =>
        query(
          "insert into public.follows(follower_id,following_id) values($1,$2)",
          [C, B],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(A, () => query("select public.set_follow($1,true)", [A])),
    ).rejects.toThrow();
    await asUser(A, () => query("select public.set_follow($1,false)", [B]));
    await asUser(A, () => query("select public.set_follow($1,false)", [B]));
    expect(
      await asUser(A, () => query("select * from public.follows")),
    ).toHaveLength(0);
  });
  it("lists your followers and following without exposing another account's graph", async () => {
    await asUser(A, () => query("select public.set_follow($1,true)", [B]));
    await asUser(C, () => query("select public.set_follow($1,true)", [B]));
    const followers = await asUser(B, () =>
      query("select public.follow_people('followers') person"),
    );
    expect(
      followers.map((r) => (r.person as { id: string }).id).sort(),
    ).toEqual([A, C]);
    const following = await asUser(A, () =>
      query("select public.follow_people('following') person"),
    );
    expect(following.map((r) => (r.person as { id: string }).id)).toEqual([B]);
    expect(
      await asUser(A, () =>
        query("select public.follow_people('followers') person"),
      ),
    ).toHaveLength(0);
    expect(
      await asUser(C, () =>
        query("select * from public.relationship_events where user_id=$1", [A]),
      ),
    ).toHaveLength(0);
    await asUser(B, () =>
      query("update public.profiles set visibility='connections' where id=$1", [
        B,
      ]),
    );
    expect(
      await asUser(A, () =>
        query("select public.follow_people('following') person"),
      ),
    ).toHaveLength(0);
    await expect(
      asUser(A, () => query("select public.relationship_status($1)", [B])),
    ).rejects.toThrow();
    await asUser(A, () => query("select public.set_follow($1,false)", [B]));
  });
  it("filters the feed by following and connections without granting private-post access", async () => {
    const own = await social(A),
      followed = await social(B),
      other = await social(C);
    const privatePost = await social(B, "Connections only", "connections");
    await asUser(A, () => query("select public.set_follow($1,true)", [B]));
    const feed = (scope: string) =>
      asUser(A, () =>
        query("select public.list_posts(feed_scope=>$1) post", [scope]),
      );
    expect(
      (await feed("following")).map((r) => (r.post as { id: string }).id),
    ).toEqual([followed]);
    expect(
      (await feed("all")).map((r) => (r.post as { id: string }).id),
    ).toEqual([other, followed, own]);
    expect(await feed("connections")).toHaveLength(0);
    await asUser(A, () =>
      query("select public.send_connection_request($1,'Hello there')", [B]),
    );
    const req = (
      await asUser(B, () =>
        query("select id from public.connection_requests where sender_id=$1", [
          A,
        ]),
      )
    )[0].id;
    await asUser(B, () =>
      query("select public.respond_request($1,true)", [req]),
    );
    expect(
      (await feed("connections")).map((r) => (r.post as { id: string }).id),
    ).toEqual([privatePost, followed]);
    await asUser(A, () =>
      query("select public.manage_connection($1,'remove')", [req]),
    );
    expect(await feed("connections")).toHaveLength(0);
    expect(
      (await feed("following")).map((r) => (r.post as { id: string }).id),
    ).toEqual([followed]);
    await expect(feed("invented")).rejects.toThrow();
  });
  it("authorizes cancellations, removal and reconnecting while preserving read-only history", async () => {
    await asUser(A, () =>
      query("select public.send_connection_request($1,'Hello there')", [B]),
    );
    const first = (
      await asUser(B, () => query("select id from public.connection_requests"))
    )[0].id;
    await expect(
      asUser(C, () =>
        query("select public.manage_connection($1,'cancel')", [first]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(B, () =>
        query("select public.manage_connection($1,'cancel')", [first]),
      ),
    ).rejects.toThrow();
    await asUser(A, () =>
      query("select public.manage_connection($1,'cancel')", [first]),
    );
    await expect(
      asUser(B, () => query("select public.respond_request($1,true)", [first])),
    ).rejects.toThrow();
    await asUser(A, () =>
      query("select public.send_connection_request($1,'Hello again')", [B]),
    );
    const req = (
      await asUser(B, () =>
        query(
          "select id from public.connection_requests where status='pending'",
        ),
      )
    )[0].id;
    const cid = (
      await asUser(B, () =>
        query("select public.respond_request($1,true) id", [req]),
      )
    )[0].id;
    await asUser(A, () =>
      query(
        "insert into public.messages(conversation_id,sender_id,body) values($1,$2,'Keep this history')",
        [cid, A],
      ),
    );
    await expect(
      asUser(C, () =>
        query("select public.manage_connection($1,'remove')", [req]),
      ),
    ).rejects.toThrow();
    await asUser(B, () =>
      query("select public.manage_connection($1,'remove')", [req]),
    );
    expect(
      await asUser(A, () =>
        query("select body from public.messages where conversation_id=$1", [
          cid,
        ]),
      ),
    ).toHaveLength(1);
    expect(
      (
        await asUser(A, () =>
          query("select public.can_message($1) allowed", [cid]),
        )
      )[0].allowed,
    ).toBe(false);
    await expect(
      asUser(A, () =>
        query(
          "insert into public.messages(conversation_id,sender_id,body) values($1,$2,'No longer allowed')",
          [cid, A],
        ),
      ),
    ).rejects.toThrow();
    await asUser(A, () =>
      query("select public.send_connection_request($1,'Reconnect please')", [
        B,
      ]),
    );
    const next = (
      await asUser(B, () =>
        query(
          "select id from public.connection_requests where status='pending'",
        ),
      )
    )[0].id;
    const fresh = (
      await asUser(B, () =>
        query("select public.respond_request($1,true) id", [next]),
      )
    )[0].id;
    expect(fresh).not.toBe(cid);
    expect(
      (
        await asUser(A, () =>
          query("select public.can_message($1) allowed", [fresh]),
        )
      )[0].allowed,
    ).toBe(true);
    expect(
      (
        await asUser(C, () =>
          query("select public.are_connected($1,$2) connected", [A, B]),
        )
      )[0].connected,
    ).toBe(false);
  });
  it("keeps accepted connections after an intent ends and clears relationships on block", async () => {
    const source = await intent(A);
    await asUser(A, () =>
      query("select public.send_connection_request($1,'Hello there',$2)", [
        B,
        source,
      ]),
    );
    const req = (
      await asUser(B, () => query("select id from public.connection_requests"))
    )[0].id;
    await asUser(B, () =>
      query("select public.respond_request($1,true)", [req]),
    );
    await asUser(A, () =>
      query("delete from public.intents where id=$1", [source]),
    );
    expect(
      (
        await asUser(A, () =>
          query("select public.relationship_status($1) state", [B]),
        )
      )[0].state,
    ).toMatchObject({ connection: "connected" });
    await asUser(A, () => query("select public.set_follow($1,true)", [B]));
    await asUser(B, () => query("select public.set_follow($1,true)", [A]));
    await asUser(A, () =>
      query("insert into public.blocks(blocker_id,blocked_id) values($1,$2)", [
        A,
        B,
      ]),
    );
    expect(
      (
        await asUser(C, () =>
          query("select public.is_blocked($1,$2) blocked", [A, B]),
        )
      )[0].blocked,
    ).toBe(false);
    await asUser(A, () =>
      query("delete from public.blocks where blocker_id=$1 and blocked_id=$2", [
        A,
        B,
      ]),
    );
    expect(
      (
        await asUser(A, () =>
          query("select public.relationship_status($1) state", [B]),
        )
      )[0].state,
    ).toMatchObject({
      connection: "none",
      following: false,
      follows_you: false,
    });
  });
  it.each([
    ["learn", "teach", true],
    ["teach", "learn", true],
    ["hire", "work", true],
    ["work", "hire", true],
    ["request", "offer", true],
    ["offer", "request", true],
    ["organize", "join", true],
    ["join", "organize", true],
    ["join", "join", true],
    ["collaborate", "collaborate", true],
    ["socialize", "socialize", true],
    ["open", "learn", true],
    ["teach", "open", true],
    ["learn", "learn", true],
    ["teach", "teach", true],
    ["hire", "hire", false],
    ["request", "request", false],
    ["organize", "organize", false],
  ])(
    "qualifies %s / %s in the actual retrieval function",
    async (first, second, expected) => {
      const source = await intent(A, "private_role_test", { role: first });
      await intent(B, "private_role_test", { role: second });
      expect(
        await asUser(A, () =>
          query("select * from public.find_people($1)", [source]),
        ),
      ).toHaveLength(expected ? 1 : 0);
    },
  );
  it("makes searches owner-only and keeps them out of the social feed and identified events", async () => {
    const id = await intent(A, "secret_pineapple search");
    expect(
      await asUser(B, () =>
        query("select * from public.intents where id=$1", [id]),
      ),
    ).toHaveLength(0);
    const own = await asUser(A, () =>
      query(
        "select show_on_profile,description from public.intents where id=$1",
        [id],
      ),
    );
    expect(own[0]).toMatchObject({
      show_on_profile: false,
      description: "secret_pineapple search",
    });
    expect(
      await asUser(B, () => query("select * from public.list_posts()")),
    ).toHaveLength(0);
    expect(
      await asUser(B, () => query("select * from public.feed_events")),
    ).toHaveLength(0);
    const events = await asUser(B, () =>
      query("select * from public.discovery_events"),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(Object.keys(events[0]).sort()).toEqual(["created_at", "id"]);
    await expect(
      asUser(B, () => query("select * from private.intent_context")),
    ).rejects.toThrow();
  });
  it("supports reversible, explicit profile visibility and protects writes", async () => {
    const id = await intent(A);
    await asUser(A, () =>
      query("update public.intents set show_on_profile=true where id=$1", [id]),
    );
    expect(
      await asUser(B, () =>
        query("select id from public.intents where id=$1", [id]),
      ),
    ).toHaveLength(1);
    expect(
      await asUser(B, () =>
        query(
          "update public.intents set show_on_profile=false where id=$1 returning id",
          [id],
        ),
      ),
    ).toHaveLength(0);
    await asUser(A, () =>
      query("update public.intents set show_on_profile=false where id=$1", [
        id,
      ]),
    );
    expect(
      await asUser(B, () =>
        query("select id from public.intents where id=$1", [id]),
      ),
    ).toHaveLength(0);
    await asUser(A, () =>
      query(
        "update public.intents set show_on_profile=true,status='paused' where id=$1",
        [id],
      ),
    );
    expect(
      await asUser(B, () =>
        query("select id from public.intents where id=$1", [id]),
      ),
    ).toHaveLength(0);
  });
  it("removes legacy full-intent retrieval functions", async () => {
    const rows = await query(
      "select to_regprocedure('public.discover_matches(uuid,boolean,double precision,double precision,double precision,text,double precision,integer)') old_matches,to_regprocedure('public.nearby_intents(double precision,double precision,double precision)') old_nearby,to_regprocedure('public.match_intents(uuid,double precision)') old_vectors",
    );
    expect(rows[0]).toEqual({
      old_matches: null,
      old_nearby: null,
      old_vectors: null,
    });
  });
  it("returns matching description context without intent identifiers or full rows", async () => {
    const source = await intent(A),
      candidate = await intent(B);
    const rows = await asUser(A, () =>
      query("select * from public.find_people($1)", [source]),
    );
    expect(rows).toHaveLength(1);
    expect((rows[0].profile as { id: string }).id).toBe(B);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "distance_km",
      "is_online",
      "matched_intent",
      "profile",
    ]);
    expect(JSON.stringify(rows)).not.toContain(candidate);
    expect(rows[0].matched_intent).toBe("qwerty_shared_topic");
  });
  it("qualifies semantic matches through actual pgvector similarity", async () => {
    const source = await intent(A, "React engineering", { mode: "online" }),
      candidate = await intent(B, "MERN implementation", { mode: "online" });
    const embedding = Array(768).fill(0);
    embedding[0] = 1;
    for (const [user, id] of [
      [A, source],
      [B, candidate],
    ])
      await asUser(user, () =>
        query(
          "select public.set_intent_embedding($1,$2::jsonb,'test-vector-model')",
          [id, JSON.stringify(embedding)],
        ),
      );
    const found = await asUser(A, () =>
      query("select * from public.find_people($1)", [source]),
    );
    expect(found).toHaveLength(1);
    expect((found[0].profile as { id: string }).id).toBe(B);
  });
  it("orders online people first, deduplicates people, and handles multiple tabs", async () => {
    const source = await intent(A);
    await intent(B);
    await intent(B);
    await intent(C);
    const first = crypto.randomUUID(),
      second = crypto.randomUUID();
    for (const session of [first, second])
      await asUser(B, () =>
        query("select public.update_presence($1,true)", [session]),
      );
    let found = await asUser(A, () =>
      query("select * from public.find_people($1)", [source]),
    );
    expect(found.map((r) => (r.profile as { id: string }).id)).toEqual([B, C]);
    expect(found[0].is_online).toBe(true);
    await asUser(B, () =>
      query("select public.update_presence($1,false)", [first]),
    );
    found = await asUser(A, () =>
      query("select * from public.find_people($1)", [source]),
    );
    expect(found[0].is_online).toBe(true);
    await asUser(B, () =>
      query("select public.update_presence($1,false)", [second]),
    );
    found = await asUser(A, () =>
      query("select * from public.find_people($1)", [source]),
    );
    expect(found.map((r) => (r.profile as { id: string }).id)).toEqual([C, B]);
    await expect(
      asUser(C, () =>
        query("insert into public.member_presence values($1,now())", [B]),
      ),
    ).rejects.toThrow();
  });
  it("filters radius using PostGIS while keeping coordinates private", async () => {
    const source = await intent(
      A,
      "qwerty_shared_topic",
      {},
      12.971612,
      77.594612,
    );
    await intent(B);
    const near = await asUser(A, () =>
      query("select * from public.find_people($1,true,12.97,77.59,5)", [
        source,
      ]),
    );
    expect(near).toHaveLength(1);
    expect(near[0].distance_km).toBe(0);
    expect(
      await asUser(A, () =>
        query("select * from public.find_people($1,true,0,0,5)", [source]),
      ),
    ).toHaveLength(0);
    expect(JSON.stringify(near)).not.toContain("latitude");
    const own = await asUser(A, () =>
      query("select public.get_intent_context($1) context", [source]),
    );
    expect(own[0].context).toMatchObject({ latitude: 12.97, longitude: 77.59 });
    await expect(
      asUser(B, () => query("select public.get_intent_context($1)", [source])),
    ).rejects.toThrow();
  });
  it("enforces role, skill and time constraints before people are returned", async () => {
    const source = await intent(A, "guitar_session", {
      role: "learn",
      skills: ["Guitar"],
      starts_at: "2099-01-01T10:00:00Z",
      ends_at: "2099-01-01T12:00:00Z",
    });
    await intent(B, "guitar_session", {
      role: "teach",
      skills: ["Piano"],
      starts_at: "2099-01-01T10:00:00Z",
      ends_at: "2099-01-01T12:00:00Z",
    });
    expect(
      await asUser(A, () =>
        query("select * from public.find_people($1)", [source]),
      ),
    ).toHaveLength(0);
    const id = await intent(C, "guitar_session", {
      role: "teach",
      skills: ["Guitar"],
      starts_at: "2099-01-01T11:00:00Z",
      ends_at: "2099-01-01T13:00:00Z",
    });
    expect(
      (
        await asUser(A, () =>
          query("select * from public.find_people($1)", [source]),
        )
      ).map((r) => (r.profile as { id: string }).id),
    ).toEqual([C]);
    await asUser(C, () =>
      query("update public.intents set status='paused' where id=$1", [id]),
    );
    expect(
      await asUser(A, () =>
        query("select * from public.find_people($1)", [source]),
      ),
    ).toHaveLength(0);
  });
  it("respects profile visibility and blocking when matching private searches", async () => {
    const source = await intent(A);
    await intent(B);
    await asUser(B, () =>
      query("update public.profiles set visibility='connections' where id=$1", [
        B,
      ]),
    );
    expect(
      await asUser(A, () =>
        query("select * from public.find_people($1)", [source]),
      ),
    ).toHaveLength(0);
    await asUser(B, () =>
      query("update public.profiles set visibility='public' where id=$1", [B]),
    );
    await asUser(B, () =>
      query("insert into public.blocks(blocker_id,blocked_id) values($1,$2)", [
        B,
        A,
      ]),
    );
    expect(
      await asUser(A, () =>
        query("select * from public.find_people($1)", [source]),
      ),
    ).toHaveLength(0);
  });
  it("stores social posts, likes, comments and saves separately from searches", async () => {
    const search = await intent(A, "secret_pineapple search"),
      post = await social(A);
    await asUser(B, () =>
      query("insert into public.post_likes(post_id,user_id) values($1,$2)", [
        post,
        B,
      ]),
    );
    await asUser(B, () =>
      query("insert into public.post_saves(post_id,user_id) values($1,$2)", [
        post,
        B,
      ]),
    );
    await asUser(B, () =>
      query(
        "insert into public.post_comments(post_id,user_id,body) values($1,$2,'A real comment')",
        [post, B],
      ),
    );
    const feed = await asUser(B, () =>
      query("select public.list_posts() post"),
    );
    expect(feed).toHaveLength(1);
    expect(feed[0].post).toMatchObject({
      id: post,
      body: "A public update",
      like_count: 1,
      comment_count: 1,
      liked: true,
      saved: true,
    });
    expect(JSON.stringify(feed)).not.toContain(search);
    expect(JSON.stringify(feed)).not.toContain("secret_pineapple");
    expect(
      await asUser(B, () =>
        query(
          "update public.posts set body='forged' where id=$1 returning id",
          [post],
        ),
      ),
    ).toHaveLength(0);
  });
  it("protects connections-only posts and photo objects until access is granted", async () => {
    const path = `${A}/${crypto.randomUUID()}.webp`;
    await asUser(A, () =>
      query(
        "insert into storage.objects(bucket_id,name,owner_id) values('post-media',$1,$2)",
        [path, A],
      ),
    );
    expect(
      await asUser(B, () =>
        query("select name from storage.objects where name=$1", [path]),
      ),
    ).toHaveLength(0);
    const post = await social(A, "", "connections", [path]);
    await expect(social(B, "", "public", [path])).rejects.toThrow();
    expect(
      await asUser(B, () =>
        query("select id from public.posts where id=$1", [post]),
      ),
    ).toHaveLength(0);
    await expect(
      asUser(B, () =>
        query("insert into public.post_likes values($1,$2,now())", [post, B]),
      ),
    ).rejects.toThrow();
    const req = await asUser(A, () =>
      query("select public.send_connection_request($1,'Hello there') result", [
        B,
      ]),
    );
    expect(req[0].result).toMatchObject({ ok: true });
    const request = String(
      (
        await asUser(B, () =>
          query("select id from public.connection_requests"),
        )
      )[0].id,
    );
    await asUser(B, () =>
      query("select public.respond_request($1,true)", [request]),
    );
    expect(
      await asUser(B, () =>
        query("select name from storage.objects where name=$1", [path]),
      ),
    ).toHaveLength(1);
    await asUser(A, () =>
      query("insert into public.blocks(blocker_id,blocked_id) values($1,$2)", [
        A,
        B,
      ]),
    );
    expect(
      await asUser(B, () =>
        query("select name from storage.objects where name=$1", [path]),
      ),
    ).toHaveLength(0);
  });
  it("keeps search context private when connecting, and protects real message rows", async () => {
    const source = await intent(A, "private_connection_context");
    await expect(
      asUser(B, () =>
        query("select public.send_connection_request($1,'Hello there',$2)", [
          C,
          source,
        ]),
      ),
    ).rejects.toThrow();
    await asUser(A, () =>
      query("select public.send_connection_request($1,'Hello there',$2)", [
        B,
        source,
      ]),
    );
    const requests = await asUser(B, () =>
      query("select * from public.connection_requests"),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].intent_id).toBeNull();
    expect(JSON.stringify(requests)).not.toContain(source);
    expect(JSON.stringify(requests)).not.toContain(
      "private_connection_context",
    );
    const cid = String(
      (
        await asUser(B, () =>
          query("select public.respond_request($1,true) id", [requests[0].id]),
        )
      )[0].id,
    );
    await asUser(A, () =>
      query(
        "insert into public.messages(conversation_id,sender_id,body) values($1,$2,'A persistent message')",
        [cid, A],
      ),
    );
    expect(
      await asUser(B, () =>
        query("select body from public.messages where conversation_id=$1", [
          cid,
        ]),
      ),
    ).toHaveLength(1);
    expect(
      await asUser(C, () =>
        query("select body from public.messages where conversation_id=$1", [
          cid,
        ]),
      ),
    ).toHaveLength(0);
    await expect(
      asUser(C, () =>
        query(
          "insert into public.messages(conversation_id,sender_id,body) values($1,$2,'Forged')",
          [cid, C],
        ),
      ),
    ).rejects.toThrow();
  });
});
