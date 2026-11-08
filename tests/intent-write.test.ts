import { describe, expect, it } from "vitest";
import { intentWriteMetadata } from "../src/lib/intent-write";
import { intentDraft } from "../src/lib/intent-input";

describe("save identity is independent of generated metadata", () => {
  it("reuses identity across title, category, casing and whitespace changes", () => {
    const original = intentDraft(
      "need a volunteer for climate change awareness drive",
    );
    const changed = {
      ...original,
      title: "Climate Volunteers",
      category: "Community",
      description: "  NEED a volunteer  for climate change awareness drive ",
    };
    expect(intentWriteMetadata(original, true)._request_key).toBe(
      intentWriteMetadata(changed, true)._request_key,
    );
  });
  it("keeps explicit skill, location and profile-display choices distinct", () => {
    const original = intentDraft("Video editing");
    const key = intentWriteMetadata(original, true)._request_key;
    for (const changes of [
      { skills: ["Premiere Pro"] },
      { city: "Mohali" },
      { show_on_profile: true },
      { radius_km: 5 },
    ])
      expect(
        intentWriteMetadata({ ...original, ...changes }, true)._request_key,
      ).not.toBe(key);
  });
});
