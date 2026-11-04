import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({
    app: "Telos",
    status: "ok",
    configured: {
      supabase: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ),
      ai: Boolean(process.env.GEMINI_API_KEY),
    },
  });
}
