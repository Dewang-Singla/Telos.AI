// Public messages are selected locally; never reflect provider messages or tokens from URLs.
export const authMessages: Record<string, string> = {
  confirmation: "We couldn’t finish signing you in. Please try again.",
  oauth_cancelled: "Sign-in was cancelled. Please try again.",
  confirmation_session:
    "This browser couldn’t complete sign-in. Sign in with your email and password.",
  confirmation_expired:
    "This email link expired or was already used. Try signing in, or resend confirmation.",
  confirmation_unavailable:
    "The sign-in service is unavailable. Please try again.",
};

export function authCallbackError(error: unknown): keyof typeof authMessages {
  const value = error as {
    code?: string;
    name?: string;
    status?: number;
  } | null;
  if (value?.code === "otp_expired") return "confirmation_expired";
  if (value?.code === "access_denied") return "oauth_cancelled";
  if (
    [
      "pkce_code_verifier_not_found",
      "bad_code_verifier",
      "flow_state_not_found",
      "flow_state_expired",
    ].includes(value?.code || "") ||
    value?.name === "AuthPKCECodeVerifierMissingError"
  )
    return "confirmation_session";
  if (value?.name === "AuthRetryableFetchError" || (value?.status || 0) >= 500)
    return "confirmation_unavailable";
  return "confirmation";
}
