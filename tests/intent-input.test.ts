import { describe, expect, it } from "vitest";
import { intentDraft, intentEditDraft } from "../src/lib/intent-input";
import type { Intent } from "../src/lib/types";
describe("editing a saved search", () => {
  const original = {
    id: "source-id",
    user_id: "owner",
    title: "Old title",
    description: "Old description",
    category: "Learn & grow",
    role: "learn",
    mode: "hybrid",
    city: "Chandigarh",
    tags: ["guitar"],
    skills: ["Fingerstyle"],
    starts_at: "2099-01-01T09:00:00Z",
    ends_at: "2099-01-01T10:00:00Z",
    participants: 3,
    show_on_profile: true,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
  } as Intent;
  it("keeps saved constraints and location when the main search text changes", () => {
    const updated = intentEditDraft(
      "  Looking for a guitar teacher!  ",
      original,
      { latitude: 30.73, longitude: 76.78, radius_km: 10 },
    );
    expect(updated).toMatchObject({
      description: "Looking for a guitar teacher!",
      title: "Looking for a guitar teacher",
      role: "learn",
      mode: "hybrid",
      city: "Chandigarh",
      tags: ["guitar"],
      skills: ["Fingerstyle"],
      participants: 3,
      show_on_profile: true,
      latitude: 30.73,
      longitude: 76.78,
      radius_km: 10,
      starts_at: original.starts_at,
      ends_at: original.ends_at,
    });
    expect(updated).not.toHaveProperty("id");
    expect(updated).not.toHaveProperty("user_id");
  });
  it("keeps new intents separate from profile display without a matching-text switch", () => {
    expect(intentDraft("Looking for a guitar teacher")).toMatchObject({
      show_on_profile: false,
    });
    expect(intentDraft("Looking for a guitar teacher")).not.toHaveProperty(
      "show_in_matches",
    );
  });
});
