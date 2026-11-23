import { describe, expect, it } from "vitest";
import {
  connectionNote,
  explainMatch,
  profileReadiness,
} from "../src/lib/discovery";
import type { Profile } from "../src/lib/types";

describe("discovery context", () => {
  it("distinguishes complementary teachers from fellow learners", () => {
    expect(
      explainMatch("I want to learn guitar", "I teach guitar"),
    ).toMatchObject({ kind: "complementary", label: "Potential mentor" });
    expect(
      explainMatch("I want to learn guitar", "I'm a beginner learning guitar"),
    ).toMatchObject({ kind: "peer", label: "Fellow learner" });
    expect(
      explainMatch("Hiring a video editor", "Looking for a video editing job"),
    ).toMatchObject({ kind: "complementary", label: "Potential provider" });
    expect(
      explainMatch(
        "Need a volunteer for our drive",
        "Willing to do volunteering work",
      ),
    ).toMatchObject({ kind: "complementary", label: "Potential participant" });
  });
  it("keeps ambiguous explanations modest rather than inventing qualifications", () => {
    const explanation = explainMatch("robotics", "robotics and circuits");
    expect(explanation.kind).toBe("related");
    expect(explanation.detail).not.toMatch(
      /verified|expert|guarantee|percent/i,
    );
  });
  it("creates a bounded introduction that preserves the actual reason for connecting", () => {
    const note = connectionNote(
      "I want help learning guitar",
      "I teach acoustic guitar",
      "Alex Patel",
    );
    expect(note).toContain("Hi Alex");
    expect(note).toContain("I want help learning guitar");
    expect(note).toContain("I teach acoustic guitar");
    expect(
      connectionNote("a".repeat(3000), "b".repeat(3000), "c".repeat(70)).length,
    ).toBeLessThanOrEqual(500);
  });
  it("suggests profile context without requiring location", () => {
    const ready = profileReadiness({
      bio: "I enjoy mentoring people and sharing ideas.",
      interests: ["Music"],
      skills: ["Guitar"],
      portfolio: "",
      city: "",
      country: "",
    } as Profile);
    expect(ready.every((item) => item.done)).toBe(true);
    expect(ready.map((item) => item.label).join(" ")).not.toMatch(
      /location|city|country/i,
    );
  });
});
