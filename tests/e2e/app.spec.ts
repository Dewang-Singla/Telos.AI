import { expect, test } from "@playwright/test";

test("home opens private search instead of a posting timeline", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Find people", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Your intent" }),
  ).toBeVisible();
  await expect(page.locator(".community-post")).toHaveCount(0);
  await expect(page.locator('.app-sidebar a[href="/intents"]')).toHaveCount(0);
});

test("the legacy intents URL opens the unified workspace", async ({ page }) => {
  await page.goto("/intents");
  await expect(page).toHaveURL(/\/find$/);
  await expect(
    page.getByRole("heading", { name: "Your intents", exact: true }),
  ).toBeVisible();
});

test("feed views are explicit and keep social posting separate", async ({
  page,
}) => {
  await page.goto("/feed");
  const tabs = page.locator(".feed-tabs");
  for (const name of ["Following", "Connections", "All"]) {
    const button = tabs.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("textbox", { name: "Your intent" }),
    ).toHaveCount(0);
  }
});
test("feed contains only ordinary social posts", async ({ page }) => {
  await page.goto("/feed");
  await expect(
    page.getByRole("heading", { name: "Feed", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Post text" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your intent" })).toHaveCount(
    0,
  );
  await expect(page.locator(".community-post")).toHaveCount(0);
  await expect(
    page.getByText(/demo|possibilities|a little|learn & grow/i),
  ).toHaveCount(0);
});
test("posting while signed out opens authentication", async ({ page }) => {
  await page.goto("/feed");
  await page
    .locator(".community-inline-composer")
    .getByRole("button", { name: "Post", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("session errors keep password sign-in available without a routine resend link", async ({
  page,
}) => {
  await page.goto("/login?error=confirmation_session");
  await expect(page.getByRole("alert")).toContainText(
    "This browser couldn’t complete sign-in",
  );
  await expect(page.getByRole("alert")).not.toContainText("expired");
  await expect(
    page.getByRole("link", { name: "Resend confirmation", exact: true }),
  ).toHaveCount(0);
  await page.goto("/resend-confirmation");
  await expect(
    page.getByRole("heading", { name: "Resend confirmation", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
});
test("login offers resend only after an unconfirmed-email response", async ({
  page,
}) => {
  await page.route("**/auth/v1/token**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: "email_not_confirmed",
        msg: "Email not confirmed",
      }),
    }),
  );
  await page.goto("/login");
  await expect(
    page.getByRole("link", { name: "Resend confirmation", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Email", { exact: true })
    .fill("unconfirmed@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Resend confirmation", exact: true }),
  ).toBeVisible();
});
test("signup opens code verification and rejects invalid codes without signing in", async ({
  page,
}) => {
  await page.route("**/auth/v1/signup**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "a1111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        email: "signup@example.com",
        identities: [],
      }),
    }),
  );
  await page.route("**/auth/v1/verify**", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        code: "otp_expired",
        msg: "Token has expired or is invalid",
      }),
    }),
  );
  await page.goto("/signup");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("signup@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-test-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Resend in/ })).toBeDisabled();
  const request = page.waitForRequest((r) =>
    r.url().includes("/auth/v1/verify"),
  );
  await page.getByLabel("Verification code").fill("012345");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    email: "signup@example.com",
    token: "012345",
    type: "email",
  });
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  await expect(page).toHaveURL(/\/signup$/);
});
test("an existing email code can be entered without sending another email", async ({
  page,
}) => {
  let sends = 0;
  await page.route("**/auth/v1/resend**", (route) => {
    sends++;
    return route.abort();
  });
  await page.goto("/resend-confirmation");
  await page.getByRole("button", { name: "Enter a code" }).click();
  await page.getByLabel("Email", { exact: true }).fill("signup@example.com");
  await expect(page.getByLabel("Verification code")).toBeVisible();
  expect(sends).toBe(0);
});
test("disabled Google provider stays on Telos with usable email login", async ({
  page,
}) => {
  await page.route("**/auth/v1/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ external: { google: false } }),
    }),
  );
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toContainText("Continue with email");
  await expect(page.getByLabel("Password", { exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/login$/);
});
test("the top search finds people and posts in one view", async ({ page }) => {
  await page.goto("/feed");
  await expect(page.locator('.app-sidebar a[href="/discover"]')).toHaveCount(0);
  const field = page.locator(".global-search input");
  if (await field.isVisible()) {
    await field.fill("test");
    await field.press("Enter");
  } else {
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Search people or posts" })
      .fill("test");
  }
  await expect(page).toHaveURL(/\/search\?q=test/);
  const tabs = page.locator(".search-tabs");
  await tabs.getByRole("button", { name: "Posts", exact: true }).click();
  await expect(
    tabs.getByRole("button", { name: "Posts", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".private-intent-title")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search people or posts" }),
  ).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Search Telos", exact: true }),
  ).toBeVisible();
});

test("the old People link redirects to normal search", async ({ page }) => {
  await page.goto("/discover");
  await expect(page).toHaveURL(/\/search/);
  await expect(
    page.getByRole("heading", { name: "Search", exact: true }),
  ).toBeVisible();
});

test("nearby filter toggles independently", async ({ page }) => {
  await page.goto("/find");
  const toggle = page.getByRole("switch", { name: "Nearby" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await page
    .getByRole("textbox", { name: "City", exact: true })
    .fill("Test city");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

test("an unavailable location keeps manual city search usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: "prompt" }) },
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          _success: unknown,
          failure: (error: { code: number }) => void,
        ) => failure({ code: 2 }),
      },
    });
  });
  await page.goto("/find");
  await page.getByRole("switch", { name: "Nearby" }).click();
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("couldn’t determine");
  await expect(page.getByRole("alert")).not.toContainText("access denied");
  await page
    .getByRole("textbox", { name: "City", exact: true })
    .fill("Bengaluru");
  await expect(page.locator(".location-error")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Radius", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Radius", exact: true }),
  ).toHaveValue("city");
});
test("pages fit the viewport", async ({ page }) => {
  for (const path of [
    "/",
    "/feed",
    "/search",
    "/find",
    "/matches",
    "/messages",
    "/profile",
    "/settings",
    "/login",
    "/signup",
  ]) {
    await page.goto(path);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});
