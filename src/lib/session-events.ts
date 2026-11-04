import type { AuthChangeEvent } from "@supabase/supabase-js";
export function shouldRefreshSession(
  event: AuthChangeEvent,
  currentId: string | null,
  nextId: string | null,
) {
  return (
    event === "USER_UPDATED" || (event === "SIGNED_IN" && currentId !== nextId)
  );
}
