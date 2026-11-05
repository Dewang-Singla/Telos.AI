import { describe, expect, it } from "vitest";
import { intentDraft } from "../src/lib/intent-input";
describe("independent search drafts", () => {
  it("starts each new topic without roles, skills, tags or dates from a previous search", () => {
    const guitar = intentDraft("Looking for a guitar teacher");
    guitar.role = "learn";
    guitar.tags = ["guitar"];
    guitar.skills = ["Fingerstyle"];
    guitar.starts_at = "2099-01-01T09:00:00Z";
    const job = intentDraft("Looking for a React developer job");
    expect(job).toMatchObject({
      role: "open",
      tags: [],
      skills: [],
      starts_at: null,
      ends_at: null,
      city: "",
      show_on_profile: false,
    });
    expect(job).not.toHaveProperty("id");
    expect(job).not.toHaveProperty("user_id");
  });
  it("keeps profile display separate from matching context", () => {
    expect(intentDraft("Looking for a guitar teacher")).not.toHaveProperty(
      "show_in_matches",
    );
  });
});
