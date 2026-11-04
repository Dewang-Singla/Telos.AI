import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  getClaims: vi.fn(),
}));
vi.mock("../src/lib/supabase/server", () => ({ serverClient: mocks.client }));
import { GET, POST } from "../src/app/api/[resource]/route";
const currentUser = "a0000000-0000-4000-8000-000000000001";
const source = "b0000000-0000-4000-8000-000000000002";
const session = "c0000000-0000-4000-8000-000000000003";
function request(
  resource: string,
  body: unknown,
  origin = "http://localhost:3000",
) {
  return POST(
    new NextRequest(`http://localhost:3000/api/${resource}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ resource }) },
  );
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
  vi.stubEnv("GEMINI_API_KEY", "");
  mocks.rpc.mockReset();
  mocks.from.mockReset();
  mocks.getClaims.mockReset();
  mocks.client.mockReset();
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: currentUser, role: "authenticated" } },
    error: null,
  });
  mocks.client.mockResolvedValue({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
    from: mocks.from,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("authenticated API boundary", () => {
  it.each([
    [null, null],
    [{ sub: currentUser, role: "anon" }, null],
    [{ sub: "invalid-id", role: "authenticated" }, null],
    [{ sub: currentUser, role: "authenticated" }, { code: "invalid_jwt" }],
    [{ sub: currentUser, role: "authenticated" }, { code: "jwt_expired" }],
  ])(
    "rejects unverified, missing, expired or unauthorized claims before database work",
    async (claims, error) => {
      mocks.getClaims.mockResolvedValue({ data: { claims }, error });
      expect(
        (await request("presence", { session_id: session, active: true }))
          .status,
      ).toBe(401);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );
  it("updates the existing intent ID when editing a reopened search", async () => {
    mocks.rpc.mockResolvedValue({ data: source, error: null });
    const response = await request("intents", {
      id: source,
      title: "An updated search",
      description: "Looking for a guitar teacher",
      category: "Community",
      role: "open",
      mode: "online",
      city: "",
      tags: [],
      skills: [],
      participants: 2,
      starts_at: null,
      ends_at: null,
      automatic: false,
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0]).toEqual([
      "save_intent",
      expect.objectContaining({
        intent_uuid: source,
        payload: expect.objectContaining({
          description: "Looking for a guitar teacher",
        }),
      }),
    ]);
  });
  it("saves independent optional location fields with the authenticated profile owner", async () => {
    const single = vi
      .fn()
      .mockResolvedValue({ data: { id: currentUser }, error: null });
    const upsert = vi.fn().mockReturnValue({ select: () => ({ single }) });
    mocks.from.mockReturnValue({ upsert });
    const response = await request("profile", {
      id: source,
      name: "A Person",
      username: "a_person",
      bio: "",
      state: " Maharashtra ",
      country: " India ",
      interests: [],
      skills: [],
      portfolio: "",
      visibility: "public",
    });
    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: currentUser,
        city: "",
        state: "Maharashtra",
        country: "India",
      }),
    );
  });
  it("searches posts through the permission-filtered listing RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/posts?q=hello%20world&offset=20",
      ),
      { params: Promise.resolve({ resource: "posts" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "list_posts",
      expect.objectContaining({
        search_text: "hello world",
        page_offset: 20,
        feed_scope: "all",
      }),
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("paginates profile search and preserves username underscores", async () => {
    const range = vi.fn().mockResolvedValue({ data: [], error: null });
    const builder = { select: vi.fn(), order: vi.fn(), or: vi.fn(), range };
    builder.select.mockReturnValue(builder);
    builder.order.mockReturnValue(builder);
    builder.or.mockReturnValue(builder);
    mocks.from.mockReturnValue(builder);
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/people?q=%40john_doe&offset=40",
      ),
      { params: Promise.resolve({ resource: "people" }) },
    );
    expect(response.status).toBe(200);
    expect(builder.or).toHaveBeenCalledWith(
      "name.ilike.%john_doe%,username.ilike.%john_doe%",
    );
    expect(range).toHaveBeenCalledWith(40, 79);
    expect(mocks.from).toHaveBeenCalledWith("profiles");
  });
  it("does not turn punctuation-only searches into a directory listing", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/people?q=%25%28%29"),
      { params: Promise.resolve({ resource: "people" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("validates feed scope before invoking the database", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/posts?scope=invalid"),
      { params: Promise.resolve({ resource: "posts" }) },
    );
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes the selected feed filter to SQL", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const response = await GET(
      new NextRequest("http://localhost:3000/api/posts?scope=following"),
      { params: Promise.resolve({ resource: "posts" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "list_posts",
      expect.objectContaining({ feed_scope: "following" }),
    );
  });
  it.each([
    [
      "follow",
      { id: source, following: true },
      "set_follow",
      { target_id: source, following: true },
    ],
    [
      "connection-action",
      { id: source, action: "remove" },
      "manage_connection",
      { request_uuid: source, action_name: "remove" },
    ],
  ])("uses an authorized RPC for %s", async (resource, body, method, args) => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const response = await request(resource as string, body);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(method, args);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects invented connection transitions", async () => {
    const response = await request("connection-action", {
      id: source,
      action: "accept",
    });
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects another member's photo path before storage access", async () => {
    const response = await request("posts", {
      body: "",
      media_paths: [`${source}/${session}.webp`],
    });
    expect(response.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("keeps private source context inside the connection RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const response = await request("connections", {
      recipient_id: source,
      source_intent_id: session,
      note: "Hello there",
      sender_id: source,
      description: "PRIVATE CONTEXT",
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("send_connection_request", {
      recipient_uuid: source,
      note_text: "Hello there",
      source_uuid: session,
    });
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
  it.each(["saved", "block"])(
    "makes %s inserts idempotent without broad UPDATE grants",
    async (resource) => {
      const insert = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "23505", message: "duplicate" },
      });
      mocks.from.mockReturnValue({ insert });
      const response = await request(resource, {
        id: source,
        saved: true,
        blocked: true,
        user_id: source,
        blocker_id: source,
      });
      expect(response.status).toBe(200);
      expect(insert).toHaveBeenCalledWith(
        resource === "saved"
          ? { user_id: currentUser, post_id: source }
          : { blocker_id: currentUser, blocked_id: source },
      );
    },
  );
  it("keeps a valid post when AI extracts contradictory dates", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.includes("generateContent")
            ? Response.json({
                candidates: [
                  {
                    content: {
                      parts: [
                        {
                          text: JSON.stringify({
                            title: "A shared activity",
                            category: "Community",
                            role: "socialize",
                            mode: "online",
                            city: "",
                            tags: [],
                            skills: [],
                            participants: 2,
                            starts_at: "2026-12-02T10:00:00Z",
                            ends_at: "2026-12-01T10:00:00Z",
                            topic: "Shared activity",
                          }),
                        },
                      ],
                    },
                  },
                ],
              })
            : Response.json({ embedding: { values: Array(768).fill(0.1) } }),
        ),
      ),
    );
    mocks.rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name === "consume_rate_limit" ? true : source,
        error: null,
      }),
    );
    const response = await request("intents", {
      title: "A shared activity",
      description: "A shared activity with other people.",
      category: "Community",
      role: "open",
      mode: "online",
      city: "",
      tags: [],
      skills: [],
      participants: 2,
      starts_at: null,
      ends_at: null,
      automatic: true,
    });
    expect(response.status).toBe(200);
    const call = mocks.rpc.mock.calls.find(([name]) => name === "save_intent");
    expect(call?.[1].payload.starts_at).toBeNull();
    expect(call?.[1].payload.role).toBe("open");
  });
  it("updates only the authenticated presence session, ignoring spoofed identities", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const response = await request("presence", {
      session_id: session,
      active: true,
      user_id: source,
      last_seen_at: "2099-01-01",
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("update_presence", {
      session_uuid: session,
      active: true,
    });
  });
  it("does not execute presence writes for unauthenticated users", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    expect(
      (await request("presence", { session_id: session, active: true })).status,
    ).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a malformed location before querying matches", async () => {
    expect(
      (
        await request("matches", {
          id: source,
          nearby: true,
          latitude: 130,
          longitude: 77,
        })
      ).status,
    ).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("posts arbitrary text without requiring a provider or fabricating indexing", async () => {
    mocks.rpc.mockResolvedValue({ data: source, error: null });
    const response = await request("intents", {
      title: "Chess",
      description: "Chess",
      category: "Community",
      role: "open",
      mode: "online",
      city: "",
      tags: [],
      skills: [],
      participants: 2,
      starts_at: null,
      ends_at: null,
      automatic: true,
      user_id: source,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: source, indexed: false });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [method, body] = mocks.rpc.mock.calls[0];
    expect(method).toBe("save_intent");
    expect(body.payload).not.toHaveProperty("user_id");
  });
  it("preserves a post when the AI provider fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 429 })),
    );
    mocks.rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name === "consume_rate_limit" ? true : source,
        error: null,
      }),
    );
    const response = await request("intents", {
      title: "A new intent",
      description: "An arbitrary new intent to test matching.",
      category: "Community",
      role: "open",
      mode: "online",
      city: "",
      tags: [],
      skills: [],
      participants: 2,
      starts_at: null,
      ends_at: null,
      automatic: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ indexed: false });
    expect(mocks.rpc.mock.calls.some(([name]) => name === "save_intent")).toBe(
      true,
    );
  });
  it("preserves database ordering and strips private intent data from matching responses", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          profile: { id: "old-online", name: "Online member" },
          is_online: true,
          intent: { description: "SECRET SEARCH TEXT", id: source },
          distance_km: null,
          matched_intent: "I teach guitar and offer lessons",
        },
        {
          profile: { id: "new-offline", name: "Offline member" },
          is_online: false,
          description: "SECRET SEARCH TEXT",
          created_at: "2026-11-04T00:00:00Z",
          distance_km: null,
        },
      ],
      error: null,
    });
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    });
    const response = await request("matches", { id: source });
    expect(response.status).toBe(200);
    const rows = await response.json();
    expect(rows.map((r: { profile: { id: string } }) => r.profile.id)).toEqual([
      "old-online",
      "new-offline",
    ]);
    expect(JSON.stringify(rows)).not.toContain("SECRET");
    expect(rows[0].matched_intent).toBe("I teach guitar and offer lessons");
    expect(Object.keys(rows[0]).sort()).toEqual([
      "distance_km",
      "is_online",
      "matched_intent",
      "profile",
    ]);
    expect(mocks.rpc.mock.calls[0][0]).toBe("find_people");
  });
  it("does not expose the removed nearby-intent endpoint", async () => {
    const response = await request("nearby", {
      latitude: 12,
      longitude: 77,
      radius: 25,
    });
    expect(response.status).toBe(410);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps new intents private unless explicitly requested", async () => {
    mocks.rpc.mockResolvedValue({ data: source, error: null });
    await request("intents", {
      title: "A private search",
      description: "A private search",
      category: "Community",
      role: "open",
      mode: "online",
      city: "",
      tags: [],
      skills: [],
      participants: 2,
      starts_at: null,
      ends_at: null,
    });
    expect(mocks.rpc.mock.calls[0][1].payload.show_on_profile).toBe(false);
  });
});
