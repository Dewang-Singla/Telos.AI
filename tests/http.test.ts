import { describe, expect, it } from "vitest";
// Opt in while next dev / next start is running: TELOS_HTTP_TEST_URL=http://localhost:3000
const origin = process.env.TELOS_HTTP_TEST_URL;
describe.skipIf(!origin)("HTTP integration (no configured backend)", () => {
  it.each([
    "/",
    "/feed",
    "/welcome",
    "/discover",
    "/search",
    "/find",
    "/matches",
    "/nearby",
    "/intents",
    "/saved",
    "/messages",
    "/connections",
    "/notifications",
    "/profile",
    "/settings",
    "/login",
    "/signup",
    "/reset-password",
    "/resend-confirmation",
    "/update-password",
  ])("serves %s without a server error", async (path) => {
    const r = await fetch(`${origin}${path}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await r.text()).toContain("Telos");
  });
  it("redirects the former intent section into the single Find people workspace", async () => {
    const r = await fetch(`${origin}/intents`, { redirect: "manual" });
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("/find");
    const page = await (await fetch(`${origin}/find`)).text();
    expect(page).not.toContain('href="/intents"');
  });
  it("offers Google sign-in without adding it to password recovery", async () => {
    for (const route of ["/login", "/signup"]) {
      const html = await (await fetch(`${origin}${route}`)).text();
      expect(html).toContain("Continue with Google");
    }
    const reset = await (await fetch(`${origin}/reset-password`)).text();
    expect(reset).not.toContain("Continue with Google");
  });
  it("has one normal search entry and redirects the old People section", async () => {
    const redirect = await fetch(`${origin}/discover?q=sample`, {
      redirect: "manual",
    });
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe(
      "/search?q=sample&tab=people",
    );
    const home = await (await fetch(`${origin}/feed`)).text();
    expect(home).toContain('action="/search"');
    expect(home).not.toContain('href="/discover"');
    const search = await (
      await fetch(`${origin}/search?q=sample&tab=posts`)
    ).text();
    expect(search).toContain('value="sample"');
    expect(search).toContain('aria-pressed="true">Posts');
  });
  it("reports integration configuration without exposing secrets", async () => {
    const r = await fetch(`${origin}/api/health`);
    const data = await r.json();
    expect(data.app).toBe("Telos");
    expect(typeof data.configured.supabase).toBe("boolean");
    expect(JSON.stringify(data)).not.toContain("API_KEY");
  });
  it("rejects cross-origin mutations before authentication", async () => {
    const r = await fetch(`${origin}/api/intents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.invalid",
      },
      body: "{}",
    });
    expect(r.status).toBe(403);
  });
  it("rejects missing-origin mutations", async () => {
    const r = await fetch(`${origin}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(403);
  });
  it("never returns demo conversations as real backend data", async () => {
    const r = await fetch(`${origin}/api/conversations`);
    expect([401, 503]).toContain(r.status);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(await r.json()).toHaveProperty("error");
  });
  it("returns 404 for unknown pages", async () =>
    expect((await fetch(`${origin}/this-page-does-not-exist`)).status).toBe(
      404,
    ));
});
