import { createHash } from "node:crypto";
import type { z } from "zod";
import { intentSchema } from "./validation";

export function intentWriteMetadata(
  body: z.infer<typeof intentSchema>,
  automatic: boolean,
) {
  const normalize = (text: string) =>
    text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const labels = (values: string[]) =>
    [...new Set(values.map(normalize))].sort();
  const coordinate = (value: number | null) =>
    value === null
      ? null
      : (Math.sign(value) * Math.round(Math.abs(value) * 100)) / 100;
  const identity = {
    description: normalize(body.description),
    role: body.role,
    mode: body.mode,
    city: normalize(body.city),
    tags: labels(body.tags),
    skills: labels(body.skills),
    starts_at: body.starts_at ? new Date(body.starts_at).toISOString() : null,
    ends_at: body.ends_at ? new Date(body.ends_at).toISOString() : null,
    participants: body.participants,
    show_on_profile: body.show_on_profile,
    latitude: coordinate(body.latitude),
    longitude: coordinate(body.longitude),
    radius_km: body.radius_km,
  };
  return {
    _request_key: createHash("sha256")
      .update(JSON.stringify(identity))
      .digest("hex"),
    _input: body,
    _automatic: automatic,
  };
}
