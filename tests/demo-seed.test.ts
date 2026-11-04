import { describe, expect, it, vi } from "vitest";
import { demoAccounts, DEMO_EMAIL_SUFFIX } from "../scripts/demo-data.mjs";
import { checkDemoAccess, provisionDemo } from "../scripts/seed-demo.mjs";
import { intentSchema, profileSchema, postSchema } from "../src/lib/validation";

describe("offline demonstration data", () => {
  it("checks administrator and function access without direct table access or writes", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        error: { code: "P0001", message: "Not a managed demo account" },
        status: 400,
      });
    const createUser = vi.fn();
    const admin = {
      auth: {
        admin: {
          listUsers: vi
            .fn()
            .mockResolvedValue({ data: { users: [] }, error: null }),
          createUser,
        },
      },
      rpc,
    };
    await expect(checkDemoAccess(admin)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("seed_demo_content", {
      target_id: null,
      content: {},
    });
    expect(createUser).not.toHaveBeenCalled();
  });
  it("distinguishes an invalid administrator key without leaking provider messages", async () => {
    const admin = {
      auth: {
        admin: {
          listUsers: vi
            .fn()
            .mockResolvedValue({
              error: {
                status: 401,
                message: "PRIVATE_KEY_SHOULD_NEVER_APPEAR",
              },
            }),
        },
      },
      rpc: vi.fn(),
    };
    await expect(checkDemoAccess(admin)).rejects.toThrow("HTTP 401");
    await expect(checkDemoAccess(admin)).rejects.not.toThrow("PRIVATE_KEY");
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it.each(["PGRST202", "42501"])(
    "identifies demo function failure %s without creating accounts",
    async (code) => {
      const createUser = vi.fn();
      const admin = {
        auth: {
          admin: {
            listUsers: vi.fn().mockResolvedValue({ error: null }),
            createUser,
          },
        },
        rpc: vi
          .fn()
          .mockResolvedValue({
            error: { code, message: "PRIVATE_PROVIDER_DATA" },
            status: 400,
          }),
      };
      await expect(checkDemoAccess(admin)).rejects.toThrow(code);
      expect(createUser).not.toHaveBeenCalled();
    },
  );
  it("stops if a wrong function accepts the empty probe", async () => {
    const admin = {
      auth: {
        admin: { listUsers: vi.fn().mockResolvedValue({ error: null }) },
      },
      rpc: vi.fn().mockResolvedValue({ error: null }),
    };
    await expect(checkDemoAccess(admin)).rejects.toThrow(
      "did not reject an empty target",
    );
  });
  it("prepares 80 labeled profiles, 160 varied intents and 240 valid posts", () => {
    const accounts = demoAccounts();
    expect(accounts).toHaveLength(80);
    expect(
      new Set(accounts.flatMap((a) => a.content.posts.map((p) => p.body))).size,
    ).toBe(240);
    expect(new Set(accounts.map((a) => a.email)).size).toBe(80);
    expect(new Set(accounts.map((a) => a.content.profile.username)).size).toBe(
      80,
    );
    for (const a of accounts) {
      expect(a.email.endsWith(DEMO_EMAIL_SUFFIX)).toBe(true);
      expect(a.content.profile.bio).toContain("Offline demo bot");
      expect(
        profileSchema.safeParse({
          ...a.content.profile,
          portfolio: "",
          visibility: "public",
          details: [],
        }).success,
      ).toBe(true);
      expect(a.content.intents).toHaveLength(2);
      expect(new Set(a.content.intents.map((i) => i.description)).size).toBe(2);
      for (const intent of a.content.intents)
        expect(intentSchema.safeParse(intent).success).toBe(true);
      for (const post of a.content.posts)
        expect(postSchema.safeParse(post).success).toBe(true);
    }
  });
  it("uses admin-created banned accounts without sending signup emails or storing passwords", async () => {
    const createUser = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: "demo-id" } }, error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const admin = {
      auth: {
        admin: {
          listUsers: vi
            .fn()
            .mockResolvedValue({ data: { users: [] }, error: null }),
          createUser,
        },
      },
      rpc,
    };
    const log = vi.fn();
    const result = await provisionDemo(admin, demoAccounts().slice(0, 1), log);
    expect(result).toEqual({ accounts: 1, intents: 2, posts: 3 });
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email_confirm: true,
        ban_duration: "876000h",
        app_metadata: { telos_demo: "v1" },
      }),
    );
    expect(createUser.mock.calls[0][0].password.length).toBeGreaterThan(30);
    expect(rpc).toHaveBeenCalledWith(
      "seed_demo_content",
      expect.objectContaining({ target_id: "demo-id" }),
    );
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("password");
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      createUser.mock.calls[0][0].password,
    );
  });
  it("resumes existing marked accounts and never reuses an unmarked real account", async () => {
    const accounts = demoAccounts().slice(0, 2);
    const createUser = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: "new-demo" } }, error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const admin = {
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: {
              users: [
                {
                  id: "existing-demo",
                  email: accounts[0].email,
                  app_metadata: { telos_demo: "v1" },
                },
                { id: "real-user", email: accounts[1].email, app_metadata: {} },
              ],
            },
            error: null,
          }),
          createUser,
        },
      },
      rpc,
    };
    await provisionDemo(admin, accounts, vi.fn());
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map((call) => call[1].target_id)).toEqual([
      "existing-demo",
      "new-demo",
    ]);
  });
  it("stops on a failed profile/content transaction so rerun can safely resume", async () => {
    const admin = {
      auth: {
        admin: {
          listUsers: vi
            .fn()
            .mockResolvedValue({ data: { users: [] }, error: null }),
          createUser: vi.fn().mockResolvedValue({
            data: { user: { id: "new-demo" } },
            error: null,
          }),
        },
      },
      rpc: vi.fn().mockResolvedValue({
        error: { code: "PGRST202", message: "SECRET_DATA" },
      }),
    };
    await expect(provisionDemo(admin, demoAccounts(), vi.fn())).rejects.toThrow(
      "Migration 006",
    );
    expect(admin.auth.admin.createUser).toHaveBeenCalledTimes(1);
  });
});
