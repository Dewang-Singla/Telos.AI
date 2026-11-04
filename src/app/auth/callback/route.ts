import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { authCallbackError } from "@/lib/auth-errors";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  const recovery =
    request.nextUrl.searchParams.get("next") === "/update-password";
  const fail = (error: unknown) => {
    const reason = authCallbackError(error);
    // Log only a fixed reason label, never one-time codes, cookies or provider messages.
    console.warn("[auth/callback]", reason);
    return redirect(
      `${recovery ? "/reset-password" : "/login"}?error=${reason}`,
    );
  };
  if (request.nextUrl.searchParams.has("error"))
    return fail({
      code:
        request.nextUrl.searchParams.get("error_code") ||
        request.nextUrl.searchParams.get("error"),
    });
  if (code) {
    try {
      const db = await serverClient();
      const flowId = request.nextUrl.searchParams.get("sb_flow_id");
      if (flowId && !/^[a-zA-Z0-9_-]{8,64}$/.test(flowId))
        return fail({ code: "pkce_code_verifier_not_found" });
      const { error } = flowId
        ? await db.auth.exchangeCodeForSession(code, { flowId })
        : await db.auth.exchangeCodeForSession(code);
      if (!error)
        return redirect(recovery ? "/update-password" : "/settings?welcome=1");
      return fail(error);
    } catch (error) {
      return fail(error);
    }
  }
  return redirect("/login?error=confirmation");
}
