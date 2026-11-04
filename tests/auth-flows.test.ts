import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { googleSignInUrl, verifySignupCode } from "../src/lib/auth-flows";

const verifyOtp = vi.fn();
const signInWithOAuth = vi.fn();
const db = {
  auth: { verifyOtp, signInWithOAuth },
} as unknown as SupabaseClient;
const project = "https://example.supabase.co";
const origin = "https://telos.example";
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({
    data: { session: { access_token: "test" } },
    error: null,
  });
  signInWithOAuth.mockResolvedValue({
    data: {
      url: `${project}/auth/v1/authorize?provider=google&code_challenge=test`,
    },
    error: null,
  });
  fetcher.mockResolvedValue(Response.json({ external: { google: true } }));
});
describe("signup verification", () => {
  it("verifies the code with Supabase against its email, preserving leading zeroes", async () => {
    await verifySignupCode(db, " user@example.com ", " 012345 ");
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      token: "012345",
      type: "email",
    });
  });
  it.each(["", "12345", "12345x", "12345678901", "12 3456"])(
    "rejects malformed code %j before contacting Auth",
    async (code) => {
      await expect(
        verifySignupCode(db, "user@example.com", code),
      ).rejects.toThrow("Enter the verification code");
      expect(verifyOtp).not.toHaveBeenCalled();
    },
  );
  it("accepts configurable longer codes", async () => {
    await verifySignupCode(db, "user@example.com", "0123456789");
    expect(verifyOtp).toHaveBeenCalled();
  });
  it("never treats invalid or expired codes as success or exposes provider text", async () => {
    verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { code: "otp_expired", message: "SECRET_PROVIDER_DATA" },
    });
    await expect(
      verifySignupCode(db, "user@example.com", "123456"),
    ).rejects.toThrow("This code is invalid or expired. Request a new one.");
  });
  it("respects server attempt limits", async () => {
    verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { status: 429 },
    });
    await expect(
      verifySignupCode(db, "user@example.com", "123456"),
    ).rejects.toThrow("Too many attempts");
  });
  it("requires a session instead of navigating on a sessionless response", async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    await expect(
      verifySignupCode(db, "user@example.com", "123456"),
    ).rejects.toThrow("Sign in with your email and password");
  });
});
describe("Google sign-in", () => {
  it("uses PKCE through the SDK, exact app callback and no extra Google scopes", async () => {
    const url = await googleSignInUrl(
      db,
      project,
      "public-test-key",
      origin,
      fetcher,
    );
    expect(new URL(url).origin).toBe(project);
    expect(fetcher).toHaveBeenCalledWith(
      `${project}/auth/v1/settings`,
      expect.objectContaining({
        headers: { apikey: "public-test-key" },
        cache: "no-store",
      }),
    );
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback`,
        skipBrowserRedirect: true,
      },
    });
  });
  it.each([false, undefined])(
    "does not start redirects when Google is disabled (%s)",
    async (enabled) => {
      fetcher.mockResolvedValue(
        Response.json({ external: { google: enabled } }),
      );
      await expect(
        googleSignInUrl(db, project, "public", origin, fetcher),
      ).rejects.toThrow("Continue with email");
      expect(signInWithOAuth).not.toHaveBeenCalled();
    },
  );
  it("does not treat unavailable settings as enabled", async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      googleSignInUrl(db, project, "public", origin, fetcher),
    ).rejects.toThrow("Sign-in is unavailable");
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });
  it("handles an SDK error without exposing provider details", async () => {
    signInWithOAuth.mockResolvedValue({
      data: { url: null },
      error: { message: "PRIVATE_DATA" },
    });
    await expect(
      googleSignInUrl(db, project, "public", origin, fetcher),
    ).rejects.toThrow("Couldn’t start Google sign-in");
  });
  it("rejects a redirect outside the Supabase authorization endpoint", async () => {
    signInWithOAuth.mockResolvedValue({
      data: { url: "https://attacker.invalid" },
      error: null,
    });
    await expect(
      googleSignInUrl(db, project, "public", origin, fetcher),
    ).rejects.toThrow("Couldn’t start Google sign-in");
  });
});
