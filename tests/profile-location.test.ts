import { describe, expect, it } from "vitest";
import { profileLocation } from "../src/lib/profile-location";
import { profileSchema } from "../src/lib/validation";

const base = {
  name: "A Person",
  username: "a_person",
  bio: "",
  interests: [],
  skills: [],
  portfolio: "",
  visibility: "public",
};
describe("optional profile location", () => {
  it.each([
    ["", "", "", ""],
    ["Mumbai", "", "", "Mumbai"],
    ["", "Maharashtra", "", "Maharashtra"],
    ["", "", "India", "India"],
    ["Mumbai", "Maharashtra", "", "Mumbai, Maharashtra"],
    ["Mumbai", "", "India", "Mumbai, India"],
    ["", "Maharashtra", "India", "Maharashtra, India"],
    ["Mumbai", "Maharashtra", "India", "Mumbai, Maharashtra, India"],
  ])("accepts and displays %j / %j / %j", (city, state, country, expected) => {
    const profile = profileSchema.parse({ ...base, city, state, country });
    expect(profileLocation(profile)).toBe(expected);
  });
  it("defaults omitted location fields to blank and trims entered values", () => {
    expect(profileLocation(profileSchema.parse(base))).toBe("");
    expect(
      profileLocation(
        profileSchema.parse({
          ...base,
          state: " Maharashtra ",
          country: " India ",
        }),
      ),
    ).toBe("Maharashtra, India");
    expect(profileLocation({ city: "Mumbai" })).toBe("Mumbai");
  });
  it.each(["city", "state", "country"])("bounds the length of %s", (field) => {
    expect(
      profileSchema.safeParse({ ...base, [field]: "x".repeat(101) }).success,
    ).toBe(false);
  });
});
