import { z } from "zod";
import { categories, roles } from "./types";
const text = (max: number) => z.string().trim().max(max);
const tags = z.array(text(40).min(1)).max(12);
const date = z.string().datetime({ offset: true }).nullable();
export const interpretationSchema = z.object({
  title: text(120).min(3),
  category: z.enum(categories.slice(1) as [string, ...string[]]),
  role: z.enum(roles),
  mode: z.enum(["online", "in-person", "hybrid"]),
  tags,
  skills: tags,
  city: text(100),
  participants: z.number().int().min(1).max(1000),
  starts_at: date,
  ends_at: date,
  topic: text(300).min(2),
});
export const intentSchema = interpretationSchema
  .omit({ topic: true })
  .extend({
    title: text(120).min(3),
    description: text(3000).min(3),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    radius_km: z.number().min(1).max(500).default(25),
    show_on_profile: z.boolean().default(false),
  })
  .refine(
    (v) =>
      !v.starts_at || !v.ends_at || new Date(v.ends_at) > new Date(v.starts_at),
    { message: "End time must be after start time", path: ["ends_at"] },
  )
  .refine((v) => (v.latitude === null) === (v.longitude === null), {
    message: "Both location coordinates are required",
  })
  .refine(
    (v) =>
      v.mode !== "in-person" ||
      v.city.length > 0 ||
      (v.latitude !== null && v.longitude !== null),
    {
      message: "Add a city for in-person or hybrid activities",
      path: ["city"],
    },
  );
export const profileSchema = z.object({
  name: text(70).min(2),
  username: text(30)
    .min(3)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores"),
  bio: text(600),
  city: text(100).default(""),
  state: text(100).default(""),
  country: text(100).default(""),
  interests: tags,
  skills: tags,
  portfolio: z.union([
    z.literal(""),
    z.url().refine((v) => v.startsWith("https://"), "Use an HTTPS URL"),
  ]),
  visibility: z.enum(["public", "connections"]),
  details: z
    .array(z.object({ label: text(40).min(1), value: text(200) }))
    .max(10)
    .default([]),
});
export const uuid = z.uuid();
export const messageSchema = z.object({
  conversation_id: uuid,
  body: text(2000).min(1),
});
export const requestSchema = z.object({
  recipient_id: uuid,
  intent_id: uuid.nullable().default(null),
  source_intent_id: uuid.nullable().default(null),
  note: text(500).min(5),
});
export const reportSchema = z.object({
  target_id: uuid,
  intent_id: uuid.nullable().default(null),
  reason: text(1000).min(10),
  post_id: uuid.nullable().default(null),
});
export const postSchema = z
  .object({
    body: text(5000),
    media_paths: z
      .array(z.string().regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.webp$/))
      .max(4)
      .default([]),
    visibility: z.enum(["public", "connections"]).default("public"),
  })
  .refine((p) => p.body.length > 0 || p.media_paths.length > 0, {
    message: "Add text or a photo.",
  })
  .refine((p) => new Set(p.media_paths).size === p.media_paths.length, {
    message: "Duplicate photos.",
  });
export const commentSchema = z.object({
  post_id: uuid,
  body: text(1000).min(1),
});
