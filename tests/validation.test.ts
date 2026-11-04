import { describe, expect, it } from "vitest";
import {
  intentSchema,
  messageSchema,
  profileSchema,
  postSchema,
} from "../src/lib/validation";
const valid = {
  title: "Learn guitar together",
  description: "I would love to learn guitar with a patient teacher.",
  category: "Learn & grow",
  role: "learn",
  mode: "online",
  city: "",
  tags: ["Music"],
  skills: [],
  participants: 2,
  starts_at: null,
  ends_at: null,
};
describe("intent validation", () => {
  it("defaults to private and permits explicit profile display", () => {
    expect(intentSchema.parse(valid).show_on_profile).toBe(false);
    expect(
      intentSchema.parse({ ...valid, show_in_matches: false }),
    ).not.toHaveProperty("show_in_matches");
    expect(
      intentSchema.parse({ ...valid, show_on_profile: true }).show_on_profile,
    ).toBe(true);
  });
  it("supports an arbitrary intent and an attached location without a city label", () => {
    expect(
      intentSchema.safeParse({
        ...valid,
        role: "open",
        mode: "hybrid",
        latitude: 12.97,
        longitude: 77.59,
      }).success,
    ).toBe(true);
  });
  it("supports casual intents without professional information", () =>
    expect(intentSchema.safeParse(valid).success).toBe(true));
  it("requires a city for in-person intentions", () =>
    expect(
      intentSchema.safeParse({ ...valid, mode: "in-person" }).success,
    ).toBe(false));
  it("rejects impossible coordinates and unpaired coordinates", () => {
    expect(
      intentSchema.safeParse({ ...valid, latitude: 91, longitude: 0 }).success,
    ).toBe(false);
    expect(intentSchema.safeParse({ ...valid, latitude: 12 }).success).toBe(
      false,
    );
  });
  it("rejects reversed dates and oversized groups", () => {
    expect(
      intentSchema.safeParse({
        ...valid,
        starts_at: "2026-12-02T12:00:00Z",
        ends_at: "2026-12-01T12:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      intentSchema.safeParse({ ...valid, participants: 1001 }).success,
    ).toBe(false);
  });
  it("strips spoofed owner, status and timestamps", () => {
    const result = intentSchema.parse({
      ...valid,
      user_id: "other-user",
      status: "completed",
      created_at: "2099-01-01",
    });
    expect(result).not.toHaveProperty("user_id");
    expect(result).not.toHaveProperty("status");
  });
});
describe("independent social posts", () => {
  const path = `${crypto.randomUUID()}/${crypto.randomUUID()}.webp`;
  it("permits text-only and photo-only posts", () => {
    expect(postSchema.safeParse({ body: "Hello" }).success).toBe(true);
    expect(
      postSchema.safeParse({ body: "", media_paths: [path] }).success,
    ).toBe(true);
  });
  it("rejects empty posts, foreign URLs, traversal paths, duplicate media and excess photos", () => {
    for (const media_paths of [
      [],
      ["https://external.invalid/image.webp"],
      ["../private/file.webp"],
      [path, path],
      Array.from(
        { length: 5 },
        () => `${crypto.randomUUID()}/${crypto.randomUUID()}.webp`,
      ),
    ])
      expect(postSchema.safeParse({ body: "", media_paths }).success).toBe(
        false,
      );
  });
});
describe("profile and messaging", () => {
  it("rejects script portfolios and malformed usernames", () => {
    const p = {
      name: "A Person",
      username: "a_person",
      bio: "",
      city: "",
      interests: [],
      skills: [],
      portfolio: "javascript:alert(1)",
      visibility: "public",
    };
    expect(profileSchema.safeParse(p).success).toBe(false);
    expect(
      profileSchema.safeParse({ ...p, portfolio: "", username: "../private" })
        .success,
    ).toBe(false);
  });
  it("permits a blank profile location and no portfolio or skills", () =>
    expect(
      profileSchema.safeParse({
        name: "A Person",
        username: "a_person",
        bio: "",
        city: "",
        interests: [],
        skills: [],
        portfolio: "",
        visibility: "public",
      }).success,
    ).toBe(true));
  it("rejects empty, oversized or invalid-conversation messages", () => {
    expect(
      messageSchema.safeParse({ conversation_id: "not-a-uuid", body: "hello" })
        .success,
    ).toBe(false);
    expect(
      messageSchema.safeParse({
        conversation_id: crypto.randomUUID(),
        body: "   ",
      }).success,
    ).toBe(false);
    expect(
      messageSchema.safeParse({
        conversation_id: crypto.randomUUID(),
        body: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });
});
