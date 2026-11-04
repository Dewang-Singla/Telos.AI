import { expect, test, type Page } from "@playwright/test";
const env = process.env;
test.skip(
  env.TELOS_LIVE_TESTS !== "1" ||
    !env.TELOS_TEST_EMAIL_A ||
    !env.TELOS_TEST_PASSWORD_A ||
    !env.TELOS_TEST_EMAIL_B ||
    !env.TELOS_TEST_PASSWORD_B,
  "Requires two disposable confirmed accounts and a configured app.",
);
test.setTimeout(180000);
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
async function profile(page: Page, name: string, username: string) {
  await page.goto("/settings");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("City", { exact: true }).fill("");
  await page.getByLabel("State", { exact: true }).fill("");
  await page.getByLabel("Country", { exact: true }).fill("India");
  await page.getByLabel("Visibility", { exact: true }).selectOption("public");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await page.reload();
  await expect(page.getByLabel("Country", { exact: true })).toHaveValue(
    "India",
  );
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("");
  for (const label of ["City", "State", "Country"])
    await expect(page.getByLabel(label, { exact: true })).toHaveJSProperty(
      "required",
      false,
    );
}
async function search(page: Page, text: string) {
  await page.goto("/find");
  await page.getByRole("textbox", { name: "Your intent" }).fill(text);
  await page.getByRole("button", { name: "More details", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Details", exact: false }).click();
  await dialog
    .getByLabel("Intent", { exact: true })
    .selectOption("collaborate");
  await expect(
    dialog.getByRole("checkbox", { name: "Show on profile" }),
  ).not.toBeChecked();
  await dialog
    .getByRole("button", { name: "Find people", exact: true })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 70000 });
}
test("private searches find people, social posts stay separate, and chat persists", async ({
  browser,
}) => {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8),
    topic = `telos_${suffix}`,
    nameA = `Test A ${suffix}`,
    nameB = `Test B ${suffix}`;
  const ca = await browser.newContext(),
    cb = await browser.newContext();
  const a = await ca.newPage(),
    b = await cb.newPage();
  try {
    await signIn(a, env.TELOS_TEST_EMAIL_A!, env.TELOS_TEST_PASSWORD_A!);
    await signIn(b, env.TELOS_TEST_EMAIL_B!, env.TELOS_TEST_PASSWORD_B!);
    await profile(a, nameA, `test_a_${suffix}`);
    await profile(b, nameB, `test_b_${suffix}`);
    const profileB = await (await b.request.get("/api/profile")).json();
    const relationship = await (
      await a.request.get(`/api/relationship?id=${profileB.id}`)
    ).json();
    if (
      relationship.connection === "connected" ||
      relationship.connection === "sent"
    ) {
      expect(
        (
          await a.request.post("/api/connection-action", {
            headers: { Origin: new URL(a.url()).origin },
            data: {
              id: relationship.request_id,
              action:
                relationship.connection === "connected" ? "remove" : "cancel",
            },
          })
        ).ok(),
      ).toBe(true);
    } else if (relationship.connection === "received") {
      expect(
        (
          await a.request.post("/api/respond", {
            headers: { Origin: new URL(a.url()).origin },
            data: { id: relationship.request_id, accept: false },
          })
        ).ok(),
      ).toBe(true);
    }
    expect(
      (
        await a.request.post("/api/follow", {
          headers: { Origin: new URL(a.url()).origin },
          data: { id: profileB.id, following: false },
        })
      ).ok(),
    ).toBe(true);
    await search(a, `${topic} collaboration session`);
    await search(b, `${topic} collaboration session`);
    const beforeReopen = await (await a.request.get("/api/intents")).json();
    const sourceIntent = beforeReopen.find(
      (i: { description: string }) =>
        i.description === `${topic} collaboration session`,
    );
    let releaseContext!: () => void;
    const contextGate = new Promise<void>((resolve) => {
      releaseContext = resolve;
    });
    await a.route("**/api/intent-context?**", async (route) => {
      await contextGate;
      await route.continue();
    });
    await a
      .locator(".private-intent-title")
      .filter({ hasText: topic })
      .first()
      .click();
    await expect(
      a.getByRole("button", { name: "Find people", exact: true }),
    ).toBeDisabled();
    releaseContext();
    await expect(
      a.getByRole("button", { name: "Find people", exact: true }),
    ).toBeEnabled();
    await a.unroute("**/api/intent-context?**");
    await a.getByRole("button", { name: "Find people", exact: true }).click();
    expect((await (await a.request.get("/api/intents")).json()).length).toBe(
      beforeReopen.length,
    );
    await a
      .getByRole("textbox", { name: "Your intent" })
      .fill(`${topic} collaboration session revised`);
    const editResponse = a.waitForResponse(
      (r) =>
        r.url().endsWith("/api/intents") && r.request().method() === "POST",
    );
    await a.getByRole("button", { name: "Find people", exact: true }).click();
    const edited = await editResponse;
    expect(edited.request().postDataJSON().id).toBe(sourceIntent.id);
    await expect(
      a.getByRole("button", { name: "Find people", exact: true }),
    ).toBeEnabled();
    expect((await (await a.request.get("/api/intents")).json()).length).toBe(
      beforeReopen.length,
    );
    await a
      .getByRole("textbox", { name: "Your intent" })
      .fill(`${topic} collaboration session`);
    const restoreResponse = a.waitForResponse(
      (r) =>
        r.url().endsWith("/api/intents") && r.request().method() === "POST",
    );
    await a.getByRole("button", { name: "Find people", exact: true }).click();
    expect((await restoreResponse).request().postDataJSON().id).toBe(
      sourceIntent.id,
    );
    const match = a.locator(".match-person").filter({ hasText: nameB });
    await expect(match).toBeVisible({ timeout: 20000 });
    await expect(match).toContainText(`${topic} collaboration session`);
    await b.goto("/feed");
    await expect(
      b.locator(".community-post").filter({ hasText: topic }),
    ).toHaveCount(0);
    await b
      .getByRole("textbox", { name: "Post text" })
      .fill(`Public update ${suffix}`);
    await b
      .locator(".community-inline-composer")
      .getByRole("button", { name: "Post", exact: true })
      .click();
    await b
      .getByRole("dialog")
      .getByRole("button", { name: "Post", exact: true })
      .click();
    await expect(b.getByRole("dialog")).toHaveCount(0);
    await expect(
      b
        .locator(".community-post")
        .filter({ hasText: `Public update ${suffix}` }),
    ).toBeVisible();
    await match.getByRole("button", { name: "Connect", exact: true }).click();
    const response = a.waitForResponse(
      (r) =>
        r.url().endsWith("/api/connections") && r.request().method() === "POST",
    );
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    const sent = await response;
    expect(sent.ok()).toBe(true);
    await expect(a.getByRole("dialog")).toHaveCount(0);
    await b.goto("/connections");
    await expect(b.locator(".loading-cards")).toHaveCount(0);
    const invitation = b.locator(".connection-item").filter({ hasText: nameA });
    if (await invitation.count())
      await invitation
        .getByRole("button", { name: "Accept", exact: true })
        .click();
    await a.goto("/messages");
    await a
      .locator(".chat-list-item")
      .filter({ hasText: nameB })
      .first()
      .click();
    const message = `Message ${suffix}`;
    await a
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(message);
    await a.getByRole("button", { name: "Send message" }).click();
    await b.goto("/messages");
    await b
      .locator(".chat-list-item")
      .filter({ hasText: nameA })
      .first()
      .click();
    await expect(
      b.locator(".message-bubble").filter({ hasText: message }),
    ).toBeVisible({ timeout: 15000 });
    await b.reload();
    await b
      .locator(".chat-list-item")
      .filter({ hasText: nameA })
      .first()
      .click();
    await expect(
      b.locator(".message-bubble").filter({ hasText: message }),
    ).toBeVisible();
    await a.goto("/feed");
    const update = a
      .locator(".community-post")
      .filter({ hasText: `Public update ${suffix}` });
    await update.locator(".community-author").click();
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Follow", exact: true })
      .click();
    await expect(
      a
        .getByRole("dialog")
        .getByRole("button", { name: "Unfollow", exact: true }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Close dialog", exact: true }).click();
    await a
      .locator(".feed-tabs")
      .getByRole("button", { name: "Following", exact: true })
      .click();
    await expect(update).toBeVisible();
    await b.goto("/connections?tab=connected");
    const connection = b.locator(".connection-item").filter({ hasText: nameA });
    b.once("dialog", (dialog) => dialog.accept());
    await connection
      .getByRole("button", { name: "Remove connection", exact: true })
      .click();
    await expect(connection).toHaveCount(0);
    await b.goto("/messages");
    await b
      .locator(".chat-list-item")
      .filter({ hasText: nameA })
      .first()
      .click();
    await expect(
      b.getByText("Connection removed", { exact: true }),
    ).toBeVisible();
    await expect(
      b.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveCount(0);
  } finally {
    await ca.close();
    await cb.close();
  }
});
