import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ client: vi.fn(), exchange: vi.fn() }));
vi.mock("../src/lib/supabase/server", () => ({ serverClient: mocks.client }));
import { GET } from "../src/app/auth/callback/route";
import { authMessages } from "../src/lib/auth-errors";
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://telos.example");
  mocks.client
    .mockReset()
    .mockResolvedValue({ auth: { exchangeCodeForSession: mocks.exchange } });
  mocks.exchange.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("authentication callbacks", () => {
  it("handles cancelled OAuth without claiming an email expired", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/auth/callback?error=access_denied&error_description=PRIVATE_GOOGLE_DATA",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://telos.example/login?error=oauth_cancelled",
    );
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "PRIVATE_GOOGLE_DATA",
    );
  });
  it.each([
    "pkce_code_verifier_not_found",
    "bad_code_verifier",
    "flow_state_not_found",
    "flow_state_expired",
  ])("does not mislabel %s as an expired email", async (code) => {
    mocks.exchange.mockResolvedValue({ error: { code } });
    const response = await GET(
      new NextRequest("http://localhost:3000/auth/callback?code=one-time-code"),
    );
    expect(response.headers.get("location")).toBe(
      "https://telos.example/login?error=confirmation_session",
    );
    expect(authMessages.confirmation_session).not.toMatch(/expired/i);
    expect(console.warn).toHaveBeenCalledWith(
      "[auth/callback]",
      "confirmation_session",
    );
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "one-time-code",
    );
  });
  it("recognizes a provider-reported consumed or expired token without an exchange", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/auth/callback?error=access_denied&error_code=otp_expired&error_description=PRIVATE_PROVIDER_DATA",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://telos.example/login?error=confirmation_expired",
    );
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "PRIVATE_PROVIDER_DATA",
    );
  });
  it("distinguishes network failures from token expiry", async () => {
    mocks.exchange.mockResolvedValue({
      error: { name: "AuthRetryableFetchError", status: 503 },
    });
    const response = await GET(
      new NextRequest("http://localhost:3000/auth/callback?code=test"),
    );
    expect(response.headers.get("location")).toBe(
      "https://telos.example/login?error=confirmation_unavailable",
    );
  });
  it("returns failed password recovery to its own retry form", async () => {
    mocks.exchange.mockResolvedValue({
      error: { code: "pkce_code_verifier_not_found" },
    });
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/auth/callback?code=test&next=/update-password",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://telos.example/reset-password?error=confirmation_session",
    );
  });
  it("forwards a valid PKCE flow identifier for the correct verifier cookie", async () => {
    await GET(
      new NextRequest(
        "http://localhost:3000/auth/callback?code=test&sb_flow_id=abcdef123456",
      ),
    );
    expect(mocks.exchange).toHaveBeenCalledWith("test", {
      flowId: "abcdef123456",
    });
  });
  it("rejects a malformed flow identifier without consuming the code", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/auth/callback?code=test&sb_flow_id=../other-cookie",
      ),
    );
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://telos.example/login?error=confirmation_session",
    );
  });
  it.each([
    ["", "/settings?welcome=1"],
    ["&next=/update-password", "/update-password"],
    ["&next=https://attacker.invalid", "/settings?welcome=1"],
  ])(
    "restricts the callback destination for %s",
    async (suffix, destination) => {
      const response = await GET(
        new NextRequest(
          `http://localhost:3000/auth/callback?code=test${suffix}`,
        ),
      );
      expect(mocks.exchange).toHaveBeenCalledWith("test");
      expect(response.headers.get("location")).toBe(
        `https://telos.example${destination}`,
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
    },
  );
  it("handles an expired exchange", async () => {
    mocks.exchange.mockResolvedValue({ error: { message: "expired" } });
    const response = await GET(
      new NextRequest("http://localhost:3000/auth/callback?code=expired"),
    );
    expect(response.headers.get("location")).toBe(
      "https://telos.example/login?error=confirmation",
    );
  });
  it("handles an unavailable exchange without a server crash", async () => {
    mocks.exchange.mockRejectedValue(new Error("unavailable"));
    const response = await GET(
      new NextRequest("http://localhost:3000/auth/callback?code=test"),
    );
    expect(response.headers.get("location")).toBe(
      "https://telos.example/login?error=confirmation",
    );
  });
  it("rejects a missing authorization code", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/auth/callback"),
    );
    expect(response.headers.get("location")).toBe(
      "https://telos.example/login?error=confirmation",
    );
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
