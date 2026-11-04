import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// Use a disposable Supabase project with all migrations and two confirmed accounts.
const env = process.env;
const enabled =
  env.TELOS_LIVE_TESTS === "1" &&
  env.NEXT_PUBLIC_SUPABASE_URL &&
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  env.TELOS_TEST_EMAIL_A &&
  env.TELOS_TEST_PASSWORD_A &&
  env.TELOS_TEST_EMAIL_B &&
  env.TELOS_TEST_PASSWORD_B;
describe.skipIf(!enabled)(
  "live Supabase privacy, social posts and conversations",
  () => {
    let a: SupabaseClient,
      b: SupabaseClient,
      uidA: string,
      uidB: string,
      source: string,
      candidate: string,
      post: string,
      conversation: string;
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8),
      topic = `live_${suffix}`,
      sessions = [crypto.randomUUID(), crypto.randomUUID()];
    beforeAll(async () => {
      const client = () =>
        createClient(
          env.NEXT_PUBLIC_SUPABASE_URL!,
          env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false } },
        );
      a = client();
      b = client();
      const [sa, sb] = await Promise.all([
        a.auth.signInWithPassword({
          email: env.TELOS_TEST_EMAIL_A!,
          password: env.TELOS_TEST_PASSWORD_A!,
        }),
        b.auth.signInWithPassword({
          email: env.TELOS_TEST_EMAIL_B!,
          password: env.TELOS_TEST_PASSWORD_B!,
        }),
      ]);
      expect(sa.error).toBeNull();
      expect(sb.error).toBeNull();
      uidA = sa.data.user!.id;
      uidB = sb.data.user!.id;
      for (const [db, id, name] of [
        [a, uidA, "a"],
        [b, uidB, "b"],
      ] as const)
        expect(
          (
            await db.from("profiles").upsert({
              id,
              name: `Test ${name}`,
              username: `test_${name}_${suffix}`,
              visibility: "public",
            })
          ).error,
        ).toBeNull();
    });
    afterAll(async () => {
      if (a && source) await a.from("intents").delete().eq("id", source);
      if (b && candidate) await b.from("intents").delete().eq("id", candidate);
      if (a && post) await a.from("posts").delete().eq("id", post);
      if (a && uidB)
        await a
          .from("blocks")
          .delete()
          .eq("blocker_id", uidA)
          .eq("blocked_id", uidB);
      if (b)
        for (const session_uuid of sessions)
          await b.rpc("update_presence", { session_uuid, active: false });
      await a?.auth.signOut();
      await b?.auth.signOut();
    });
    const payload = () => ({
      title: topic,
      description: topic,
      category: "Community",
      role: "open",
      mode: "hybrid",
      city: "Bengaluru",
      tags: [],
      skills: [],
      starts_at: null,
      ends_at: null,
      participants: 2,
    });
    it("saves and clears optional location fields without requiring all three", async () => {
      const updated = await a
        .from("profiles")
        .update({ city: "", state: "", country: "India" })
        .eq("id", uidA)
        .select("city,state,country")
        .single();
      expect(updated.error).toBeNull();
      expect(updated.data).toEqual({ city: "", state: "", country: "India" });
      const cleared = await a
        .from("profiles")
        .update({ city: "", state: "", country: "" })
        .eq("id", uidA)
        .select("city,state,country")
        .single();
      expect(cleared.error).toBeNull();
      expect(cleared.data).toEqual({ city: "", state: "", country: "" });
    });
    it("creates a private intent and protects its coordinates", async () => {
      const created = await a.rpc("save_intent", {
        payload: payload(),
        lat: 12.971612,
        lng: 77.594612,
        radius: 25,
      });
      expect(created.error).toBeNull();
      source = created.data;
      const own = await a.rpc("get_intent_context", { intent_uuid: source });
      expect(own.data).toMatchObject({ latitude: 12.97, longitude: 77.59 });
      expect(
        (await b.rpc("get_intent_context", { intent_uuid: source })).error,
      ).not.toBeNull();
      expect(
        (await b.from("intents").select("*").eq("id", source)).data || [],
      ).toHaveLength(0);
    });
    it("displays an intent on a profile only after explicit opt-in", async () => {
      expect(
        (
          await a
            .from("intents")
            .update({ show_on_profile: true })
            .eq("id", source)
        ).error,
      ).toBeNull();
      expect(
        (await b.from("intents").select("id").eq("id", source)).data,
      ).toHaveLength(1);
      expect(
        (
          await a
            .from("intents")
            .update({ show_on_profile: false })
            .eq("id", source)
        ).error,
      ).toBeNull();
      expect(
        (await b.from("intents").select("id").eq("id", source)).data || [],
      ).toHaveLength(0);
      expect(
        (
          await b
            .from("intents")
            .update({ show_on_profile: true })
            .eq("id", source)
            .select()
        ).data || [],
      ).toHaveLength(0);
    });
    it("returns exact matching context without granting direct intent-row access", async () => {
      const created = await b.rpc("save_intent", {
        payload: payload(),
        lat: 12.97,
        lng: 77.59,
        radius: 25,
      });
      expect(created.error).toBeNull();
      candidate = created.data;
      const found = await a.rpc("find_people", { source_id: source });
      expect(found.error).toBeNull();
      expect(
        found.data.some(
          (p: { profile: { id: string } }) => p.profile.id === uidB,
        ),
      ).toBe(true);
      expect(JSON.stringify(found.data)).not.toContain(candidate);
      expect(
        found.data.find(
          (p: { profile: { id: string } }) => p.profile.id === uidB,
        ).matched_intent,
      ).toContain(topic);
      expect(
        (await a.from("intents").select("id").eq("id", candidate)).data,
      ).toHaveLength(0);
      expect(
        (await b.rpc("find_people", { source_id: source })).error,
      ).not.toBeNull();
      expect(
        (await a.rpc("discover_matches", { source_id: source })).error,
      ).not.toBeNull();
    });
    it("keeps multi-tab presence and radius constraints accurate", async () => {
      for (const session_uuid of sessions)
        expect(
          (await b.rpc("update_presence", { session_uuid, active: true }))
            .error,
        ).toBeNull();
      await b.rpc("update_presence", {
        session_uuid: sessions[0],
        active: false,
      });
      let rows = await a.rpc("find_people", { source_id: source });
      expect(
        rows.data.find(
          (p: { profile: { id: string } }) => p.profile.id === uidB,
        ).is_online,
      ).toBe(true);
      await b.rpc("update_presence", {
        session_uuid: sessions[1],
        active: false,
      });
      rows = await a.rpc("find_people", { source_id: source });
      expect(
        rows.data.find(
          (p: { profile: { id: string } }) => p.profile.id === uidB,
        ).is_online,
      ).toBe(false);
      const near = await a.rpc("find_people", {
        source_id: source,
        nearby_only: true,
        lat: 12.97,
        lng: 77.59,
        radius: 5,
      });
      expect(near.error).toBeNull();
      expect(
        near.data.some(
          (p: { profile: { id: string } }) => p.profile.id === uidB,
        ),
      ).toBe(true);
      const far = await a.rpc("find_people", {
        source_id: source,
        nearby_only: true,
        lat: 0,
        lng: 0,
        radius: 5,
      });
      expect(far.error).toBeNull();
      expect(
        far.data.some(
          (p: { profile: { id: string } }) => p.profile.id === uidB,
        ),
      ).toBe(false);
      expect(
        (
          await b
            .from("member_presence")
            .upsert({ user_id: uidA, last_seen_at: "2099-01-01T00:00:00Z" })
        ).error,
      ).not.toBeNull();
    });
    it("persists ordinary social posts with independent likes, comments and saves", async () => {
      const created = await a
        .from("posts")
        .insert({ user_id: uidA, body: `Public ${suffix}` })
        .select()
        .single();
      expect(created.error).toBeNull();
      post = created.data.id;
      expect(
        (await b.from("post_likes").insert({ user_id: uidB, post_id: post }))
          .error,
      ).toBeNull();
      expect(
        (await b.from("post_saves").insert({ user_id: uidB, post_id: post }))
          .error,
      ).toBeNull();
      expect(
        (
          await b
            .from("post_comments")
            .insert({ user_id: uidB, post_id: post, body: "A comment" })
        ).error,
      ).toBeNull();
      const feed = await b.rpc("list_posts", { post_uuid: post });
      expect(feed.error).toBeNull();
      expect(feed.data[0]).toMatchObject({
        id: post,
        like_count: 1,
        comment_count: 1,
        liked: true,
        saved: true,
      });
      expect(JSON.stringify(feed.data)).not.toContain(topic);
    });
    it("connects without exposing search context, then persists private messages", async () => {
      const sent = await b.rpc("send_connection_request", {
        recipient_uuid: uidA,
        note_text: "Hello from an integration test.",
        source_uuid: candidate,
      });
      expect(sent.error).toBeNull();
      if (sent.data.conversation_id) conversation = sent.data.conversation_id;
      else {
        const pending = await a
          .from("connection_requests")
          .select("*")
          .eq("sender_id", uidB)
          .eq("recipient_id", uidA)
          .eq("status", "pending")
          .single();
        expect(pending.error).toBeNull();
        expect(pending.data.intent_id).toBeNull();
        expect(JSON.stringify(pending.data)).not.toContain(candidate);
        expect(
          (
            await b.rpc("respond_request", {
              request_uuid: pending.data.id,
              accept_request: true,
            })
          ).error,
        ).not.toBeNull();
        const accepted = await a.rpc("respond_request", {
          request_uuid: pending.data.id,
          accept_request: true,
        });
        expect(accepted.error).toBeNull();
        conversation = accepted.data;
      }
      const message = await a
        .from("messages")
        .insert({
          conversation_id: conversation,
          sender_id: uidA,
          body: `Message ${suffix}`,
        })
        .select()
        .single();
      expect(message.error).toBeNull();
      expect(
        (await b.from("messages").select("id").eq("id", message.data.id)).data,
      ).toHaveLength(1);
      expect(
        (
          await b.from("messages").insert({
            conversation_id: conversation,
            sender_id: uidA,
            body: "Spoofed",
          })
        ).error,
      ).not.toBeNull();
    });
    it("denies anonymous access to private conversations", async () => {
      const anon = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL!,
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false } },
      );
      const result = await anon
        .from("messages")
        .select("*")
        .eq("conversation_id", conversation);
      expect(result.error !== null || result.data?.length === 0).toBe(true);
    });
    it("supports one-way follows and the following feed", async () => {
      expect(
        (await b.rpc("set_follow", { target_id: uidA, following: true })).error,
      ).toBeNull();
      const state = await b.rpc("relationship_status", { target_id: uidA });
      expect(state.error).toBeNull();
      expect(state.data).toMatchObject({ following: true });
      const feed = await b.rpc("list_posts", {
        post_uuid: post,
        feed_scope: "following",
      });
      expect(feed.error).toBeNull();
      expect(feed.data).toHaveLength(1);
      expect(
        (await b.rpc("set_follow", { target_id: uidA, following: false }))
          .error,
      ).toBeNull();
      expect(
        (
          await b.rpc("list_posts", {
            post_uuid: post,
            feed_scope: "following",
          })
        ).data,
      ).toHaveLength(0);
    });
    it("preserves readable history while revoking messaging after removal", async () => {
      const state = await a.rpc("relationship_status", { target_id: uidB });
      expect(state.data.connection).toBe("connected");
      expect(
        (
          await a.rpc("manage_connection", {
            request_uuid: state.data.request_id,
            action_name: "remove",
          })
        ).error,
      ).toBeNull();
      expect((await b.rpc("can_message", { cid: conversation })).data).toBe(
        false,
      );
      const history = await b
        .from("messages")
        .select("id")
        .eq("conversation_id", conversation);
      expect(history.error).toBeNull();
      expect(history.data!.length).toBeGreaterThan(0);
      expect(
        (
          await b.from("messages").insert({
            conversation_id: conversation,
            sender_id: uidB,
            body: "Disallowed after removal",
          })
        ).error,
      ).not.toBeNull();
    });
    it("enforces blocking across matching, social posts and existing chats", async () => {
      expect(
        (await a.from("blocks").insert({ blocker_id: uidA, blocked_id: uidB }))
          .error,
      ).toBeNull();
      expect(
        (await b.from("posts").select("id").eq("id", post)).data || [],
      ).toHaveLength(0);
      expect(
        (
          await b
            .from("messages")
            .select("*")
            .eq("conversation_id", conversation)
        ).data || [],
      ).toHaveLength(0);
      expect(
        (
          await b.from("messages").insert({
            conversation_id: conversation,
            sender_id: uidB,
            body: "Blocked",
          })
        ).error,
      ).not.toBeNull();
      const found = await a.rpc("find_people", { source_id: source });
      expect(
        found.data.some(
          (p: { profile: { id: string } }) => p.profile.id === uidB,
        ),
      ).toBe(false);
    });
  },
);
