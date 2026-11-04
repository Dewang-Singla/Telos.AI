import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";
import {
  intentSchema,
  messageSchema,
  profileSchema,
  reportSchema,
  requestSchema,
  postSchema,
  commentSchema,
  uuid,
} from "@/lib/validation";
import { embed, interpret } from "@/lib/ai";
import type { Interpretation, PersonMatch, SocialPost } from "@/lib/types";

export const dynamic = "force-dynamic";
function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Vary", "Cookie, Authorization");
  return NextResponse.json(body, { ...init, headers });
}
type Context = { params: Promise<{ resource: string }> };
type DB = Awaited<ReturnType<typeof serverClient>>;
class HTTPError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
function checked<T>({
  data,
  error,
}: {
  data: T;
  error: { message: string; code?: string } | null;
}): NonNullable<T> {
  if (error) {
    if (error.code === "23505")
      throw new HTTPError(
        "That username or connection request already exists.",
        409,
      );
    if (error.message.includes("limit"))
      throw new HTTPError("Hourly limit reached. Please try again later.", 429);
    if (error.message.includes("indexing"))
      throw new HTTPError(error.message, 409);
    if (error.message.includes("profile first"))
      throw new HTTPError("Create your profile in Settings first.", 409);
    throw new HTTPError(
      "This action could not be completed. Check your access and database setup.",
      400,
    );
  }
  return data as NonNullable<T>;
}
async function session() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    throw new HTTPError(
      "Live accounts are not connected yet. See DEPLOYMENT.md for setup.",
      503,
    );
  const db = await serverClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (!user || error) throw new HTTPError("Sign in to use live Telos.", 401);
  return { db, user };
}
function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return privateJson(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 422 },
    );
  const e = error as { message?: string; status?: number; name?: string };
  return privateJson(
    {
      error:
        e.name === "TimeoutError"
          ? "The AI request timed out. Try again later."
          : e.message || "Unexpected server error.",
    },
    { status: e.status || 500 },
  );
}
async function json(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowed = new Set(
    [req.nextUrl.origin, process.env.NEXT_PUBLIC_APP_URL].filter(Boolean),
  );
  if (!origin || !allowed.has(origin))
    throw new HTTPError("This request origin is not allowed.", 403);
  const raw = await req.text();
  if (raw.length > 20000) throw new HTTPError("Request is too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HTTPError("Invalid JSON request.", 400);
  }
}
async function aiLimit(db: DB) {
  if (!checked(await db.rpc("consume_rate_limit", { action_name: "ai" })))
    throw new HTTPError(
      "Your hourly AI limit has been reached. Manual posting is still available.",
      429,
    );
}
const intentSelect = "*,profile:profiles!intents_user_id_fkey(*)";
async function signPosts(db: DB, posts: SocialPost[]) {
  const paths = [...new Set(posts.flatMap((post) => post.media_paths))];
  const urls = new Map<string, string>();
  if (paths.length) {
    const signed = checked(
      await db.storage.from("post-media").createSignedUrls(paths, 300),
    );
    for (const file of signed) {
      if (file.path && file.signedUrl && !file.error)
        urls.set(file.path, file.signedUrl);
    }
  }
  return posts.map((post) => ({
    ...post,
    media_urls: post.media_paths.map((path) => urls.get(path) || ""),
  }));
}

export async function GET(req: NextRequest, context: Context) {
  try {
    const { resource } = await context.params;
    const { db, user } = await session();
    const q = req.nextUrl.searchParams;
    switch (resource) {
      case "profile":
        return privateJson(
          checked(
            await db
              .from("profiles")
              .select("*")
              .eq("id", q.get("id") ? uuid.parse(q.get("id")) : user.id)
              .maybeSingle(),
          ),
        );
      case "people": {
        const term = q
          .get("q")
          ?.slice(0, 70)
          .replace(/^@/, "")
          .replace(/[^\p{L}\p{N}_\s-]/gu, " ")
          .trim();
        if (q.has("q") && !term) return privateJson([]);
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(10000)
          .parse(q.get("offset") || 0);
        let query = db
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: true });
        if (term)
          query = query.or(`name.ilike.%${term}%,username.ilike.%${term}%`);
        return privateJson(checked(await query.range(offset, offset + 39)));
      }
      case "intents": {
        const author = q.get("user") ? uuid.parse(q.get("user")) : user.id;
        let query = db.from("intents").select(intentSelect);
        if (q.get("sort") === "soon")
          query = query.order("starts_at", {
            ascending: true,
            nullsFirst: false,
          });
        else query = query.order("created_at", { ascending: false });
        query = query.eq("user_id", author);
        if (author !== user.id)
          query = query.eq("show_on_profile", true).eq("status", "active");
        if (q.get("category"))
          query = query.eq("category", q.get("category")!.slice(0, 100));
        if (q.get("mode") && q.get("mode") !== "all")
          query = query.eq("mode", q.get("mode"));
        if (q.get("city"))
          query = query.ilike(
            "city",
            `%${q.get("city")!.slice(0, 100).replace(/[%_]/g, "")}%`,
          );
        const term = q
          .get("q")
          ?.slice(0, 200)
          .replace(/[^\p{L}\p{N}\s-]/gu, " ")
          .trim();
        if (term)
          query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(10000)
          .parse(q.get("offset") || 0);
        return privateJson(checked(await query.range(offset, offset + 49)));
      }
      case "saved":
      case "posts": {
        const scope = z
          .enum(["all", "following", "connections"])
          .parse(q.get("scope") || "all");
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(10000)
          .parse(q.get("offset") || 0);
        const rows = checked(
          await db.rpc("list_posts", {
            author_id: q.get("user") ? uuid.parse(q.get("user")) : null,
            search_text: (q.get("q") || "").slice(0, 200),
            saved_only: resource === "saved",
            page_offset: offset,
            post_uuid: q.get("id") ? uuid.parse(q.get("id")) : null,
            feed_scope: scope,
          }),
        ) as SocialPost[];
        return privateJson(await signPosts(db, rows));
      }
      case "comments": {
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(10000)
          .parse(q.get("offset") || 0);
        return privateJson(
          checked(
            await db
              .from("post_comments")
              .select("*,profile:profiles!post_comments_user_id_fkey(*)")
              .eq("post_id", uuid.parse(q.get("post")))
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(offset, offset + 49),
          ),
        );
      }
      case "relationship":
        return privateJson(
          checked(
            await db.rpc("relationship_status", {
              target_id: uuid.parse(q.get("id")),
            }),
          ),
        );
      case "follows":
        return privateJson(
          checked(
            await db.rpc("follow_people", {
              direction: z
                .enum(["followers", "following"])
                .parse(q.get("direction")),
              page_offset: z.coerce
                .number()
                .int()
                .min(0)
                .max(10000)
                .parse(q.get("offset") || 0),
            }),
          ),
        );
      case "connections": {
        const tab = z
          .enum(["received", "sent", "connected", "all"])
          .parse(q.get("tab") || "all");
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(10000)
          .parse(q.get("offset") || 0);
        let query = db
          .from("connection_requests")
          .select(
            "*,sender:profiles!connection_requests_sender_id_fkey(*),recipient:profiles!connection_requests_recipient_id_fkey(*)",
          );
        if (tab === "connected") query = query.eq("status", "accepted");
        else if (tab !== "all")
          query = query
            .eq("status", "pending")
            .eq(tab === "received" ? "recipient_id" : "sender_id", user.id);
        else query = query.in("status", ["pending", "accepted"]);
        return privateJson(
          checked(
            await query
              .order("created_at", { ascending: false })
              .order("id", { ascending: true })
              .range(offset, offset + 49),
          ),
        );
      }
      case "conversations": {
        const conversations = checked(
          await db
            .from("conversations")
            .select(
              "*,connection_requests(status),conversation_members(*,profile:profiles(*)),messages(body,created_at,sender_id)",
            )
            .order("created_at", {
              referencedTable: "messages",
              ascending: false,
            })
            .limit(1, { referencedTable: "messages" })
            .order("created_at", { ascending: false })
            .limit(100),
        );
        const counts = await Promise.all(
          conversations.map(async (c) => {
            const member = c.conversation_members.find(
              (m: { user_id: string }) => m.user_id === user.id,
            );
            const result = await db
              .from("messages")
              .select("id", { count: "exact", head: true })
              .eq("conversation_id", c.id)
              .neq("sender_id", user.id)
              .gt("created_at", member?.last_read_at || c.created_at);
            if (result.error) checked(result);
            const latest = c.messages?.[0];
            return {
              ...c,
              unread: result.count || 0,
              last_message: latest?.body || "",
              last_message_at: latest?.created_at || c.created_at,
              can_message: c.connection_requests?.status === "accepted",
            };
          }),
        );
        return privateJson(
          counts.sort((a, b) =>
            b.last_message_at.localeCompare(a.last_message_at),
          ),
        );
      }
      case "messages": {
        let query = db
          .from("messages")
          .select("*")
          .eq("conversation_id", uuid.parse(q.get("conversation")))
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(50);
        if (q.get("before")) {
          const before = z.iso
            .datetime({ offset: true })
            .parse(q.get("before"));
          if (q.get("before_id"))
            query = query.or(
              `created_at.lt.${before},and(created_at.eq.${before},id.lt.${uuid.parse(q.get("before_id"))})`,
            );
          else query = query.lt("created_at", before);
        }
        return privateJson(checked(await query).reverse());
      }
      case "notifications":
        return privateJson(
          checked(
            await db
              .from("notifications")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(60),
          ),
        );
      case "blocks":
        return privateJson(
          checked(
            await db
              .from("blocks")
              .select("blocked_id")
              .eq("blocker_id", user.id),
          ),
        );
      case "presence": {
        const rows = checked(
          await db
            .from("member_presence")
            .select("user_id")
            .gt("last_seen_at", new Date(Date.now() - 90000).toISOString())
            .limit(1000),
        );
        return privateJson(rows.map((row) => row.user_id));
      }
      case "intent-context":
        return privateJson(
          checked(
            await db.rpc("get_intent_context", {
              intent_uuid: uuid.parse(q.get("id")),
            }),
          ),
        );
      default:
        throw new HTTPError("Not found.", 404);
    }
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: NextRequest, context: Context) {
  try {
    const { resource } = await context.params;
    const payload = await json(req);
    const { db, user } = await session();
    switch (resource) {
      case "profile": {
        const body = profileSchema.parse(payload);
        return privateJson(
          checked(
            await db
              .from("profiles")
              .upsert({ ...body, id: user.id })
              .select()
              .single(),
          ),
        );
      }
      case "interpret": {
        const { description } = z
          .object({ description: z.string().trim().min(10).max(3000) })
          .parse(payload);
        await aiLimit(db);
        return privateJson(await interpret(description));
      }
      case "intents": {
        const body = intentSchema.parse(payload);
        const id = payload.id ? uuid.parse(payload.id) : null;
        let parsed: Interpretation | null = null,
          vector: number[] | null = null;
        if (process.env.GEMINI_API_KEY) {
          try {
            await aiLimit(db);
            parsed = await interpret(`${body.title}\n${body.description}`);
            vector = await embed(parsed.topic);
          } catch {
            /* Keyword retrieval remains available. */
          }
        }
        const automatic = payload.automatic === true && !id && parsed !== null;
        const interpreted = automatic
          ? intentSchema.safeParse({
              ...body,
              title: parsed!.title,
              role: body.role === "open" ? parsed!.role : body.role,
              city: body.city || parsed!.city,
              mode:
                body.latitude !== null || body.city || body.mode !== "online"
                  ? body.mode
                  : parsed!.mode !== "online" && !parsed!.city
                    ? body.mode
                    : parsed!.mode,
              tags: body.tags.length ? body.tags : parsed!.tags,
              skills: body.skills.length ? body.skills : parsed!.skills,
              starts_at: body.starts_at || parsed!.starts_at,
              ends_at: body.ends_at || parsed!.ends_at,
              participants: parsed!.participants,
            })
          : null;
        const enriched = interpreted?.success ? interpreted.data : body;
        const { latitude, longitude, radius_km, ...details } = enriched;
        const savedId = checked(
          await db.rpc("save_intent", {
            payload: details,
            intent_uuid: id,
            lat: latitude,
            lng: longitude,
            radius: radius_km,
          }),
        );
        // Saving is independent of AI provider health. Explicit retry indexing endpoint below.
        let indexed = false;
        if (vector) {
          try {
            checked(
              await db.rpc("set_intent_embedding", {
                intent_uuid: savedId,
                values_json: vector,
                model_name:
                  process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
              }),
            );
            indexed = true;
          } catch {
            /* Persist the intention and report indexing status honestly. */
          }
        }
        return privateJson({
          id: savedId,
          indexed,
          message: "Saved.",
        });
      }
      case "index": {
        const id = uuid.parse(payload.id);
        await aiLimit(db);
        const intent = checked(
          await db
            .from("intents")
            .select("title,description")
            .eq("id", id)
            .eq("user_id", user.id)
            .single(),
        );
        const extracted = await interpret(
          `${intent.title}\n${intent.description}`,
        );
        const vector = await embed(extracted.topic);
        checked(
          await db.rpc("set_intent_embedding", {
            intent_uuid: id,
            values_json: vector,
            model_name:
              process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
          }),
        );
        return privateJson({ ok: true });
      }
      case "status": {
        const body = z
          .object({
            id: uuid,
            status: z.enum(["active", "paused", "completed", "delete"]),
          })
          .parse(payload);
        if (body.status === "delete")
          checked(
            await db
              .from("intents")
              .delete()
              .eq("id", body.id)
              .eq("user_id", user.id),
          );
        else
          checked(
            await db
              .from("intents")
              .update({ status: body.status })
              .eq("id", body.id)
              .eq("user_id", user.id),
          );
        return privateJson({ ok: true });
      }
      case "intent-visibility": {
        const body = z
          .object({
            id: uuid,
            show_on_profile: z.boolean(),
          })
          .parse(payload);
        checked(
          await db
            .from("intents")
            .update({
              show_on_profile: body.show_on_profile,
            })
            .eq("id", body.id)
            .eq("user_id", user.id),
        );
        return privateJson({ ok: true });
      }
      case "matches": {
        const body = z
          .object({
            id: uuid,
            nearby: z.boolean().default(false),
            latitude: z.number().min(-90).max(90).nullable().default(null),
            longitude: z.number().min(-180).max(180).nullable().default(null),
            radius: z.number().min(1).max(500).default(25),
            city: z.string().trim().max(100).default(""),
            offset: z.number().int().min(0).max(10000).default(0),
          })
          .parse(payload);
        const rows = checked(
          await db.rpc("find_people", {
            source_id: body.id,
            nearby_only: body.nearby,
            lat: body.latitude,
            lng: body.longitude,
            radius: body.radius,
            city_filter: body.city,
            page_offset: body.offset,
            min_similarity: Number(process.env.MATCH_MIN_SIMILARITY || 0.55),
          }),
        ) as PersonMatch[];
        return privateJson(
          rows.map((row) => ({
            profile: row.profile,
            is_online: Boolean(row.is_online),
            distance_km: row.distance_km ?? null,
            matched_intent:
              typeof row.matched_intent === "string"
                ? row.matched_intent
                : null,
          })),
        );
      }
      case "presence": {
        const body = z
          .object({ session_id: uuid, active: z.boolean() })
          .parse(payload);
        checked(
          await db.rpc("update_presence", {
            session_uuid: body.session_id,
            active: body.active,
          }),
        );
        return privateJson({ ok: true });
      }
      case "nearby": {
        throw new HTTPError("Use Find people with a saved search.", 410);
      }
      case "saved": {
        const b = z.object({ id: uuid, saved: z.boolean() }).parse(payload);
        if (b.saved) {
          const result = await db
            .from("post_saves")
            .insert({ user_id: user.id, post_id: b.id });
          if (result.error?.code !== "23505") checked(result);
        } else
          checked(
            await db
              .from("post_saves")
              .delete()
              .eq("user_id", user.id)
              .eq("post_id", b.id),
          );
        return privateJson({ ok: true });
      }
      case "connections": {
        const b = requestSchema.parse(payload);
        return privateJson(
          checked(
            await db.rpc("send_connection_request", {
              recipient_uuid: b.recipient_id,
              note_text: b.note,
              source_uuid: b.source_intent_id,
            }),
          ),
        );
      }
      case "follow": {
        const body = z
          .object({ id: uuid, following: z.boolean() })
          .parse(payload);
        checked(
          await db.rpc("set_follow", {
            target_id: body.id,
            following: body.following,
          }),
        );
        return privateJson({ ok: true });
      }
      case "connection-action": {
        const body = z
          .object({ id: uuid, action: z.enum(["cancel", "remove"]) })
          .parse(payload);
        checked(
          await db.rpc("manage_connection", {
            request_uuid: body.id,
            action_name: body.action,
          }),
        );
        return privateJson({ ok: true });
      }
      case "posts": {
        const body = postSchema.parse(payload),
          id = payload.id ? uuid.parse(payload.id) : null;
        if (body.media_paths.some((path) => !path.startsWith(`${user.id}/`)))
          throw new HTTPError("Invalid photo ownership.", 403);
        for (const path of body.media_paths) {
          const result = checked(
            await db.storage
              .from("post-media")
              .list(user.id, { search: path.split("/")[1], limit: 1 }),
          );
          if (!result.some((file) => file.name === path.split("/")[1]))
            throw new HTTPError("Photo not found.", 422);
        }
        const result = id
          ? await db
              .from("posts")
              .update(body)
              .eq("id", id)
              .eq("user_id", user.id)
              .select("id")
              .single()
          : await db
              .from("posts")
              .insert({ ...body, user_id: user.id })
              .select("id")
              .single();
        return privateJson(checked(result));
      }
      case "delete-post": {
        const id = uuid.parse(payload.id);
        const post = checked(
          await db
            .from("posts")
            .delete()
            .eq("id", id)
            .eq("user_id", user.id)
            .select("media_paths")
            .single(),
        );
        if (post.media_paths.length)
          await db.storage.from("post-media").remove(post.media_paths);
        return privateJson({ ok: true });
      }
      case "like": {
        const body = z.object({ id: uuid, liked: z.boolean() }).parse(payload);
        if (body.liked) {
          const result = await db
            .from("post_likes")
            .insert({ post_id: body.id, user_id: user.id });
          if (result.error?.code !== "23505") checked(result);
        } else
          checked(
            await db
              .from("post_likes")
              .delete()
              .eq("post_id", body.id)
              .eq("user_id", user.id),
          );
        return privateJson({ ok: true });
      }
      case "comments": {
        const body = commentSchema.parse(payload);
        return privateJson(
          checked(
            await db
              .from("post_comments")
              .insert({ ...body, user_id: user.id })
              .select("*,profile:profiles!post_comments_user_id_fkey(*)")
              .single(),
          ),
        );
      }
      case "delete-comment": {
        const id = uuid.parse(payload.id);
        checked(
          await db
            .from("post_comments")
            .delete()
            .eq("id", id)
            .eq("user_id", user.id),
        );
        return privateJson({ ok: true });
      }
      case "respond": {
        const b = z.object({ id: uuid, accept: z.boolean() }).parse(payload);
        return privateJson({
          conversation_id: checked(
            await db.rpc("respond_request", {
              request_uuid: b.id,
              accept_request: b.accept,
            }),
          ),
        });
      }
      case "messages": {
        const body = messageSchema.parse(payload);
        return privateJson(
          checked(
            await db
              .from("messages")
              .insert({ ...body, sender_id: user.id })
              .select()
              .single(),
          ),
        );
      }
      case "read": {
        const id = uuid.parse(payload.id);
        checked(await db.rpc("mark_conversation_read", { cid: id }));
        return privateJson({ ok: true });
      }
      case "notifications": {
        checked(
          await db
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .is("read_at", null),
        );
        return privateJson({ ok: true });
      }
      case "block": {
        const b = z.object({ id: uuid, blocked: z.boolean() }).parse(payload);
        if (b.blocked) {
          const result = await db
            .from("blocks")
            .insert({ blocker_id: user.id, blocked_id: b.id });
          if (result.error?.code !== "23505") checked(result);
        } else
          checked(
            await db
              .from("blocks")
              .delete()
              .eq("blocker_id", user.id)
              .eq("blocked_id", b.id),
          );
        return privateJson({ ok: true });
      }
      case "report": {
        checked(
          await db
            .from("reports")
            .insert({ ...reportSchema.parse(payload), reporter_id: user.id }),
        );
        return privateJson({ ok: true });
      }
      default:
        throw new HTTPError("Not found.", 404);
    }
  } catch (e) {
    return failure(e);
  }
}
