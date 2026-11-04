import type { Profile } from "./types";

export function profileLocation(
  profile: Pick<Profile, "city" | "state" | "country">,
): string {
  return [profile.city, profile.state, profile.country]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}
