import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AuthChangeEvent } from "@supabase/supabase-js";
import { shouldRefreshSession } from "../src/lib/session-events";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  claims: vi.fn(),
  user: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.create }));
import { proxy } from "../src/proxy";
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
  mocks.create
    .mockReset()
    .mockReturnValue({
      auth: { getClaims: mocks.claims, getUser: mocks.user },
    });
  mocks.claims.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.user.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe("request/session overhead", () => {
  it.each([
    "/api/profile",
    "/api/messages",
    "/api/health",
    "/auth/callback?code=test",
  ])(
    "does not repeat route-handler auth checks in proxy for %s",
    async (path) => {
      await proxy(new NextRequest("http://localhost:3000" + path));
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("refreshes page cookies using verified claims rather than another user lookup", async () => {
    await proxy(new NextRequest("http://localhost:3000/feed"));
    expect(mocks.claims).toHaveBeenCalledTimes(1);
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("preserves refreshed cookies and prevents caching that response", async () => {
    mocks.create.mockImplementation((_url, _key, options) => ({
      auth: {
        getClaims: async () => {
          options.cookies.setAll([
            {
              name: "sb-session",
              value: "new-cookie",
              options: { httpOnly: true },
            },
          ]);
          return { data: null, error: null };
        },
      },
    }));
    const result = await proxy(new NextRequest("http://localhost:3000/feed"));
    expect(result.cookies.get("sb-session")?.value).toBe("new-cookie");
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it.each([
    ["INITIAL_SESSION", "a", "a", false],
    ["TOKEN_REFRESHED", "a", "a", false],
    ["SIGNED_IN", "a", "a", false],
    ["SIGNED_IN", null, "a", true],
    ["SIGNED_IN", "a", "b", true],
    ["USER_UPDATED", "a", "a", true],
  ])(
    "handles %s without redundant profile reloads",
    (event, current, next, expected) => {
      expect(
        shouldRefreshSession(event as AuthChangeEvent, current, next),
      ).toBe(expected);
    },
  );
});
