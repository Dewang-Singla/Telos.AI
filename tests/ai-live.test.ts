import { describe, expect, it } from "vitest";
import { assessMatches, interpret } from "../src/lib/ai";

// Explicit opt-in only. Uses synthetic text; no accounts, profiles or chat content.
describe.skipIf(process.env.TELOS_AI_CHECK !== "1")(
  "live Gemini matching quality",
  () => {
    it("recognizes a general volunteer offer as compatible with a specific climate drive", async () => {
      const source = "need a volunteer for climate change awareness drive";
      const offer = "willing to do some volunteering work";
      const roles = await Promise.all([interpret(source), interpret(offer)]);
      expect(roles.map((role) => role.role)).toEqual(["organize", "join"]);
      const decisions = await assessMatches(source, [
        { key: "volunteer", text: offer },
      ]);
      expect(decisions.get("volunteer")).toBe(true);
    }, 60000);
    it("distinguishes actual context from high but misleading embedding similarities", async () => {
      const results = await assessMatches("I want to learn acoustic guitar", [
        {
          key: "teacher",
          text: "I offer beginner guitar lessons and chord practice",
        },
        {
          key: "peer",
          text: "I am also learning to play guitar and want a practice partner",
        },
        { key: "piano", text: "I teach piano and music reading" },
        { key: "python", text: "I teach Python programming to beginners" },
      ]);
      expect(Object.fromEntries(results)).toEqual({
        teacher: true,
        peer: true,
        piano: false,
        python: false,
      });
      const editing = await assessMatches(
        "Anyone interested in video editing?",
        [
          { key: "same", text: "I am interested in video editing" },
          {
            key: "provider",
            text: "I edit videos and can help with cuts and subtitles",
          },
          { key: "design", text: "I create graphic designs and posters" },
        ],
      );
      expect(Object.fromEntries(editing)).toEqual({
        same: true,
        provider: true,
        design: false,
      });
    }, 60000);
    it("creates a short subject heading without copying the whole intent", async () => {
      const text =
        "Anyone interested in graphic designing? I want to connect with others who enjoy designing posters and visual identities.";
      const result = await interpret(text);
      expect(result.title.length).toBeLessThanOrEqual(60);
      expect(result.title.toLowerCase()).not.toBe(text.toLowerCase());
      expect(result.topic.toLowerCase()).toMatch(/graphic|design|visual/);
    }, 30000);
  },
);
