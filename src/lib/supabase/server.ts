import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
export async function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error(
      "Supabase is not configured. Follow DEPLOYMENT.md to enable live accounts.",
    );
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          /* Server components cannot update cookies; proxy refreshes them. */
        }
      },
    },
  });
}
