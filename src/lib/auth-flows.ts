import type { SupabaseClient } from "@supabase/supabase-js";

// Supabase verifies, expires and rate-limits codes; the app never stores them.
export async function verifySignupCode(
  db: SupabaseClient,
  email: string,
  code: string,
) {
  const token = code.trim();
  if (!/^[0-9]{6,10}$/.test(token))
    throw new Error("Enter the verification code from your email.");
  const { data, error } = await db.auth.verifyOtp({
    email: email.trim(),
    token,
    type: "email",
  });
  if (error) {
    if (error.code === "otp_expired")
      throw new Error("This code is invalid or expired. Request a new one.");
    if (error.status === 429)
      throw new Error("Too many attempts. Please wait before trying again.");
    throw new Error("Couldn’t verify this code. Please try again.");
  }
  if (!data.session)
    throw new Error("Email verified. Sign in with your email and password.");
}

export async function googleSignInUrl(
  db: SupabaseClient,
  projectUrl: string,
  publishableKey: string,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  // Public Auth settings let us handle a disabled provider without leaving Telos.
  const response = await fetcher(`${projectUrl}/auth/v1/settings`, {
    headers: { apikey: publishableKey },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error("Sign-in is unavailable. Please try again.");
  const settings = await response.json();
  if (settings.external?.google !== true)
    throw new Error("Google sign-in is unavailable. Continue with email.");
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url)
    throw new Error("Couldn’t start Google sign-in. Please try again.");
  const destination = new URL(data.url);
  if (
    destination.origin !== new URL(projectUrl).origin ||
    destination.pathname !== "/auth/v1/authorize"
  )
    throw new Error("Couldn’t start Google sign-in. Please try again.");
  return destination.href;
}
