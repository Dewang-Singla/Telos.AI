import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { demoAccounts, DEMO_MARKER, DEMO_EMAIL_SUFFIX } from "./demo-data.mjs";

function loadLocalEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (match && !process.env[match[1]])
        process.env[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function readSecret() {
  if (!process.stdin.isTTY)
    throw new Error(
      "Run this command in your terminal, or set SUPABASE_SECRET_KEY locally. Never paste a secret into chat.",
    );
  process.stdout.write(
    "Supabase secret/service-role key (hidden; not saved): ",
  );
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\x03") {
          finish();
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value.trim());
          return;
        }
        if (char === "\x7f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}
function diagnostic(error, stage) {
  const code = /^[A-Za-z0-9_]{1,40}$/.test(error?.code || "")
    ? error.code
    : "unknown";
  const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : "";
  let action = "Check connectivity and the project URL, then retry.";
  if (["PGRST202", "42883", "42703"].includes(code))
    action =
      "Migration 006 is not available in this project's Data API. Check that it finished with Success on this project.";
  else if (code === "42501")
    action =
      "The database role lacks access to the demo function. Confirm the key is a secret/service-role API key from this project.";
  else if (
    error?.status === 401 ||
    error?.status === 403 ||
    ["bad_jwt", "not_admin", "user_not_admin"].includes(code)
  )
    action =
      "Use this project's secret API key (sb_secret_...) or legacy service_role key, not its publishable key, database password or JWT signing secret.";
  else if (code === "PGRST106")
    action =
      "Check that public is an exposed schema in the project's Data API settings.";
  return `${stage} failed (${code}${status}). ${action}`;
}
export async function checkDemoAccess(admin) {
  const auth = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (auth.error)
    throw new Error(diagnostic(auth.error, "Auth administrator check"));
  // A null target must stop at the managed-account guard, before any database write.
  // This checks the actual provisioning permission without requiring direct profile SELECT.
  const probe = await admin.rpc("seed_demo_content", {
    target_id: null,
    content: {},
  });
  if (
    probe.error?.code === "P0001" &&
    probe.error.message === "Not a managed demo account"
  )
    return;
  if (probe.error)
    throw new Error(
      diagnostic(
        { ...probe.error, status: probe.status },
        "Demo function check",
      ),
    );
  throw new Error(
    "The demo function did not reject an empty target. Stop and verify migration 006 before loading accounts.",
  );
}
export async function provisionDemo(admin, accounts, log = console.log) {
  const existing = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(diagnostic(error, "List demo accounts"));
    for (const user of data.users) {
      if (
        user.email?.endsWith(DEMO_EMAIL_SUFFIX) &&
        user.app_metadata?.telos_demo === DEMO_MARKER
      )
        existing.set(user.email, user.id);
    }
    if (data.users.length < 1000) break;
  }
  let count = 0;
  for (const account of accounts) {
    let id = existing.get(account.email);
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({
        email: account.email,
        password: randomBytes(36).toString("base64url"),
        email_confirm: true,
        ban_duration: "876000h",
        app_metadata: { telos_demo: DEMO_MARKER },
      });
      if (error)
        throw new Error(
          `Could not create ${account.content.profile.username}: ${error.code || error.status || "request failed"}. Rerun to resume.`,
        );
      id = data.user.id;
    }
    const { error } = await admin.rpc("seed_demo_content", {
      target_id: id,
      content: account.content,
    });
    if (error)
      throw new Error(
        diagnostic(error, `Fill ${account.content.profile.username}`),
      );
    count++;
    if (count % 10 === 0)
      log(`Prepared ${count}/${accounts.length} offline demo bots.`);
  }
  return {
    accounts: count,
    intents: accounts.reduce((n, a) => n + a.content.intents.length, 0),
    posts: accounts.reduce((n, a) => n + a.content.posts.length, 0),
  };
}
async function main() {
  loadLocalEnv();
  const accounts = demoAccounts();
  if (process.argv.includes("--preview")) {
    console.log(
      JSON.stringify(
        {
          accounts: accounts.length,
          intents: accounts.length * 2,
          posts: accounts.length * 3,
          sample: accounts[0].content,
        },
        null,
        2,
      ),
    );
    return;
  }
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl)
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL in .env.local first.");
  console.log(
    `Target: ${new URL(projectUrl).origin}. Preparing ${accounts.length} labeled, offline demo bots. No emails will be sent.`,
  );
  const key = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (await readSecret())
  )
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
  if (!key || key.startsWith("sb_publishable_"))
    throw new Error(
      "Use a Supabase secret/service-role key, not the publishable key.",
    );
  const admin = createClient(projectUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  await checkDemoAccess(admin);
  console.log("Administrator key and migration 006 access verified.");
  if (process.argv.includes("--check")) {
    console.log("Check complete. No accounts or content were created.");
    return;
  }
  const result = await provisionDemo(admin, accounts);
  console.log(
    `Ready: ${result.accounts} offline demo bots, ${result.intents} intents, ${result.posts} posts. Refresh Telos. Re-running does not duplicate content.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
