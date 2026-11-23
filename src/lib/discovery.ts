import { inferIntentRole } from "./intent-context";
import type { Profile, Role } from "./types";

export const searchExamples = [
  {
    label: "Learn a skill",
    text: "I'd like to learn guitar from someone who can teach beginners online.",
  },
  {
    label: "Find a collaborator",
    text: "Looking for a designer to collaborate on a small app project.",
  },
  {
    label: "Offer your skills",
    text: "I can help with video editing for short films and creative projects.",
  },
  {
    label: "Join a cause",
    text: "I'd like to volunteer for a local community or environmental project.",
  },
] as const;

export type MatchExplanation = {
  label: string;
  detail: string;
  kind: "complementary" | "peer" | "related";
};
export function explainMatch(
  source: string,
  candidate: string,
): MatchExplanation {
  const a = inferIntentRole(source),
    b = inferIntentRole(candidate);
  const complement: Partial<Record<Role, [Role, string, string]>> = {
    learn: [
      "teach",
      "Potential mentor",
      "Your intention is to learn; theirs offers teaching or mentoring.",
    ],
    teach: [
      "learn",
      "Looking to learn",
      "Their intention asks to learn something you want to teach.",
    ],
    hire: [
      "work",
      "Potential provider",
      "You are looking to hire; their intention is to find work.",
    ],
    work: [
      "hire",
      "Potential opportunity",
      "Their intention is to hire someone for work.",
    ],
    request: [
      "offer",
      "Need meets offer",
      "Their intention offers help in response to a related need.",
    ],
    offer: [
      "request",
      "Looking for your help",
      "Their intention asks for a service or help you are offering.",
    ],
    organize: [
      "join",
      "Potential participant",
      "Their intention is to participate in an activity you want to organize.",
    ],
    join: [
      "organize",
      "An activity to join",
      "Their intention is to organize an activity you may want to join.",
    ],
  };
  const pair = complement[a];
  if (pair && b === pair[0])
    return { label: pair[1], detail: pair[2], kind: "complementary" };
  if (a === b && a !== "open")
    return {
      label:
        a === "learn"
          ? "Fellow learner"
          : a === "collaborate"
            ? "Potential collaborator"
            : "Shared goal",
      detail:
        "Your intentions describe a similar type of activity. Use their own words below to check the fit.",
      kind: "peer",
    };
  return {
    label: "Related intention",
    detail:
      "This intention relates to your search. Review their request or offer before reaching out.",
    kind: "related",
  };
}

export function connectionNote(
  source: string,
  candidate: string,
  name: string,
) {
  const excerpt = (value: string, length: number) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > length
      ? `${normalized.slice(0, length - 1).trim()}…`
      : normalized;
  };
  return `Hi ${excerpt(name.split(/\s+/)[0] || "there", 40)}, I saw your intention: “${excerpt(candidate, 145)}”\n\nI'm looking for: ${excerpt(source, 145)}\n\nWould you be open to a quick conversation?`;
}

export function profileReadiness(profile: Profile) {
  return [
    {
      label: "Add a short introduction",
      done: profile.bio.trim().length >= 20,
      hint: "Help people understand what you enjoy and what you can offer.",
    },
    {
      label: "Choose a few interests",
      done: profile.interests.length > 0,
      hint: "Give new connections a starting point for conversation.",
    },
    {
      label: "Add skills or a portfolio",
      done: profile.skills.length > 0 || Boolean(profile.portfolio),
      hint: "Share useful context when you're offering help or collaborating.",
    },
  ];
}
