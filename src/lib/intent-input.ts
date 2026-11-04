import { intentSchema } from "./validation";
import type { Intent } from "./types";
export function intentDraft(
  description: string,
  location?: { latitude: number; longitude: number; city?: string } | null,
) {
  const text = description.trim(),
    first = text.split(/[\n.!?]/)[0];
  return intentSchema.parse({
    title: (first.length >= 3 ? first : text).slice(0, 100),
    description: text,
    category: "Community",
    role: "open",
    mode: location ? "hybrid" : "online",
    city: location?.city || "",
    tags: [],
    skills: [],
    starts_at: null,
    ends_at: null,
    participants: 2,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    radius_km: 25,
    show_on_profile: false,
  });
}
export function intentEditDraft(
  description: string,
  existing: Intent,
  context: {
    latitude: number | null;
    longitude: number | null;
    radius_km: number;
  },
) {
  const text = description.trim();
  const first = text.split(/[\n.!?]/)[0];
  return intentSchema.parse({
    ...existing,
    ...context,
    title: (first.length >= 3 ? first : text).slice(0, 100),
    description: text,
  });
}
