"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { browserClient, configured } from "@/lib/supabase/client";
import { Logo } from "./ui";
import { authMessages } from "@/lib/auth-errors";
import { googleSignInUrl, verifySignupCode } from "@/lib/auth-flows";
export function AuthPage({ mode }: { mode: string }) {
  const signup = mode === "signup",
    reset = mode === "reset-password",
    confirmation = mode === "resend-confirmation",
    update = mode === "update-password";
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(false),
    [code, setCode] = useState(""),
    [needsVerification, setNeedsVerification] = useState(false),
    [cooldown, setCooldown] = useState(0);
  const verifying = success && (signup || confirmation);
  const emailAuth = !reset && !update && !confirmation;
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setCooldown((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason && Object.hasOwn(authMessages, reason))
      setError(authMessages[reason]);
    if (reason === "confirmation_expired") setNeedsVerification(true);
    if (update && configured)
      void browserClient()
        .auth.getUser()
        .then(({ data: { user } }) => {
          if (!user)
            setError("Open the password reset link from your email first.");
        })
        .catch(() =>
          setError("Open the password reset link from your email first."),
        );
  }, [update]);
  async function resendConfirmation() {
    if (busy || cooldown || !email.trim()) return;
    setBusy(true);
    setError("");
    try {
      const origin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      const result = await browserClient().auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      if (result.error) throw result.error;
      setSuccess(true);
      setCode("");
      setCooldown(60);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function continueWithGoogle() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const destination = await googleSignInUrl(
        browserClient(),
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin,
      );
      window.location.assign(destination);
    } catch (e) {
      setError(
        e instanceof Error &&
          e.name !== "TypeError" &&
          e.name !== "TimeoutError"
          ? e.message
          : "Google sign-in is unavailable. Please try again.",
      );
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (verifying) {
      setBusy(true);
      setError("");
      try {
        await verifySignupCode(browserClient(), email, code);
        window.location.assign("/settings");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (confirmation) {
      await resendConfirmation();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const db = browserClient(),
        origin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      if (reset) {
        const r = await db.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/auth/callback?next=/update-password`,
        });
        if (r.error) throw r.error;
        setSuccess(true);
      } else if (update) {
        const {
          data: { user },
        } = await db.auth.getUser();
        if (!user)
          throw new Error(
            "Open the password reset link from your email first.",
          );
        const result = await db.auth.updateUser({ password });
        if (result.error) throw result.error;
        window.location.assign("/");
      } else if (signup) {
        const r = await db.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${origin}/auth/callback` },
        });
        if (r.error) throw r.error;
        if (r.data.session) window.location.assign("/settings");
        else {
          setSuccess(true);
          setCode("");
          setPassword("");
          setCooldown(60);
        }
      } else {
        const r = await db.auth.signInWithPassword({ email, password });
        setNeedsVerification(r.error?.code === "email_not_confirmed");
        if (r.error) throw r.error;
        window.location.assign("/");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <Link href="/" className="auth-logo">
        <Logo />
      </Link>
      <div className="auth-box">
        <Link href="/" className="icon-button auth-back" aria-label="Back">
          <ArrowLeft size={24} />
        </Link>
        <h1>
          {verifying
            ? "Verify your email"
            : success
              ? "Check your email"
              : update
                ? "Choose a new password"
                : reset
                  ? "Reset password"
                  : confirmation
                    ? "Resend confirmation"
                    : signup
                      ? "Create account"
                      : "Sign in"}
        </h1>
        {(!success || verifying) && (
          <form onSubmit={submit}>
            {!update && (
              <label>
                Email
                <input
                  required
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  readOnly={verifying && signup}
                  disabled={busy}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            {verifying && (
              <label>
                Verification code
                <input
                  required
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6,10}"
                  minLength={6}
                  maxLength={10}
                  autoFocus
                  disabled={busy}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="auth-code"
                />
              </label>
            )}
            {!reset && !confirmation && !verifying && (
              <label>
                Password
                <input
                  required
                  type="password"
                  autoComplete={
                    signup || update ? "new-password" : "current-password"
                  }
                  minLength={signup || update ? 10 : 1}
                  maxLength={128}
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {!signup && !reset && !update && !confirmation && (
              <Link href="/reset-password" className="auth-reset">
                Forgot password?
              </Link>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button full"
              disabled={busy || (confirmation && !verifying && cooldown > 0)}
            >
              {busy ? (
                <Loader2 size={21} className="spin" />
              ) : verifying ? (
                "Verify email"
              ) : confirmation ? (
                cooldown ? (
                  `Resend in ${cooldown}s`
                ) : (
                  "Send confirmation"
                )
              ) : update ? (
                "Save password"
              ) : reset ? (
                "Send link"
              ) : signup ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        )}
        {success && !verifying && error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {success && (signup || confirmation) && (
          <button
            type="button"
            className="secondary-button full"
            disabled={busy || cooldown > 0 || !email.trim()}
            onClick={() => void resendConfirmation()}
          >
            {cooldown ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        )}
        {(verifying || (confirmation && !success)) && (
          <button
            type="button"
            className="auth-alternate auth-text-button"
            disabled={busy}
            onClick={() => {
              setSuccess(!verifying);
              setPassword("");
              setCode("");
              setError("");
            }}
          >
            {verifying ? "Use another email" : "Enter a code"}
          </button>
        )}
        {emailAuth && !success && (
          <button
            type="button"
            className="secondary-button full auth-google"
            disabled={busy || !configured}
            onClick={() => void continueWithGoogle()}
          >
            Continue with Google
          </button>
        )}
        {!signup && !reset && !update && !confirmation && needsVerification && (
          <Link className="auth-alternate" href="/resend-confirmation">
            Resend confirmation
          </Link>
        )}
        <Link className="auth-alternate" href={signup ? "/login" : "/signup"}>
          {signup ? "Sign in instead" : "Create account"}
        </Link>
      </div>
    </main>
  );
}
