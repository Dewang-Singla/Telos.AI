import { describe, expect, it } from "vitest";
import {
  compactHeading,
  fallbackInterpretation,
  intentHeading,
  contextRole,
} from "../src/lib/intent-context";

describe("concise intent context without an AI dependency", () => {
  it("recognizes unpaid volunteering even when a previous AI role says work", () => {
    expect(contextRole("work", "willing to do some volunteering work")).toBe(
      "join",
    );
    expect(
      contextRole(
        "hire",
        "need a volunteer for climate change awareness drive",
      ),
    ).toBe("organize");
    expect(contextRole("teach", "I teach volunteer management")).toBe("teach");
  });
  it.each([
    [
      "Looking for a guitar tutor who can help me learn beginner chords and fingerstyle on weekends",
      "Learn Guitar",
    ],
    [
      "Anyone interested in video editing? We can connect and work on a project",
      "Video editing",
    ],
    ["I need a job in graphic design", "Graphic design work"],
    ["Anyone interested in robotics? We can connect", "Robotics"],
  ])("summarizes %s", (text, title) => expect(intentHeading(text)).toBe(title));
  it("keeps a specific valid AI heading and replaces a copied sentence", () => {
    const text = "Looking for a guitar tutor who can teach me acoustic guitar";
    expect(compactHeading(text, text)).toBe("Learn Guitar");
    expect(compactHeading("Acoustic Guitar Lessons", text)).toBe(
      "Acoustic Guitar Lessons",
    );
  });
  it("treats an unspecified mode as either and never invents dates, skills or city", () => {
    expect(
      fallbackInterpretation("Anyone interested in graphic design"),
    ).toMatchObject({
      role: "open",
      mode: "hybrid",
      city: "",
      skills: [],
      starts_at: null,
      ends_at: null,
    });
  });
});
