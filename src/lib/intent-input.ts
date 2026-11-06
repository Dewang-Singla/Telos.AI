import { intentSchema } from "./validation";
import { intentHeading } from "./intent-context";
export function intentDraft(
  description: string,
  location?: { latitude: number; longitude: number; city?: string } | null,
) {
  const text = description.trim();
  return intentSchema.parse({
    title: intentHeading(text),
    description: text,
    category: "Community",
    role: "open",
    mode: /\b(online|remote|virtual)\b/i.test(text) ? "online" : "hybrid",
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
