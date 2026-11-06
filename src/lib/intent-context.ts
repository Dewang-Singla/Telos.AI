import type { Interpretation, Role } from "./types";

// Deterministic fallback: never invent a location, required skill or date.
export function inferIntentRole(content: string): Role {
  const text = content.toLowerCase();
  if (
    /\b(looking for|seeking|need|want|find)\b.{0,60}\b(job|employment|internship|position)\b|\b(open to work|available for hire|job seeker)\b/.test(
      text,
    )
  )
    return "work";
  if (/\b(hiring|recruiting|vacancy|looking to hire)\b/.test(text))
    return "hire";
  if (
    /\b(i teach|i tutor|i mentor|i coach|i train|i offer lessons|i give lessons|i am teaching|i can teach)\b|\b(teacher|tutor|trainer|coach|instructor)\b.{0,20}\b(available|offering)\b/.test(
      text,
    )
  )
    return "teach";
  if (
    /\b(learn|learning|learner|beginner|teach me|tutor|teacher|trainer|instructor|mentor|coach|lessons|coaching)\b/.test(
      text,
    )
  )
    return "learn";
  if (
    /\b(looking for|seeking|need|want)\b.{0,45}\b(developer|designer|editor|employee|candidate|freelancer)\b/.test(
      text,
    )
  )
    return "hire";
  if (/\b(organizing|organising|hosting)\b/.test(text)) return "organize";
  if (/\b(join|joining|attend|attending)\b/.test(text)) return "join";
  if (
    /\b(i offer|i can help|offering|available for rent|available to help)\b/.test(
      text,
    )
  )
    return "offer";
  if (
    /\b(need|looking|seeking|want|searching)\b.{0,60}\b(help|repair|plumber|electrician|ride|service|chef|caterer|borrow)\b/.test(
      text,
    )
  )
    return "request";
  if (
    /\b(collaborate|collaboration|cofounder|team up|build together)\b/.test(
      text,
    )
  )
    return "collaborate";
  if (/\b(friends|friendship|hang out|meet people|partners|play)\b/.test(text))
    return "socialize";
  return "open";
}

export function intentHeading(description: string): string {
  const role = inferIntentRole(description);
  const subjects: [RegExp, string][] = [
    [/\bvideo\s+edit(?:or|ors|ing)?\b/i, "Video editing"],
    [/\bgraphic\s+design(?:er|ers|ing)?\b/i, "Graphic design"],
    [/\bguitar(?:ist|s)?\b/i, "Guitar"],
    [/\bpiano\b/i, "Piano"],
    [/\bpython\b/i, "Python"],
    [/\brobot(?:s|ic|ics)?\b/i, "Robotics"],
    [
      /\b(web\s+develop\w*|website|front.?end|full.?stack)\b/i,
      "Web development",
    ],
  ];
  const subject = subjects.find(([pattern]) => pattern.test(description))?.[1];
  if (subject) {
    if (role === "learn") return `Learn ${subject}`;
    if (role === "teach") return `${subject} lessons`;
    if (role === "hire") return `${subject} hiring`;
    if (role === "work") return `${subject} work`;
    if (role === "collaborate") return `${subject} collaboration`;
    return subject;
  }
  const prefixes: Partial<Record<Role, string>> = {
    learn: "Learn",
    teach: "Teach",
    hire: "Hire",
    work: "Find work in",
    request: "Find",
    offer: "Offer",
    collaborate: "Collaborate on",
    organize: "Organize",
    join: "Join",
  };
  const cleaned = description
    .replace(/https?:\/\/\S+/gi, "")
    .replace(
      /\b(?:i (?:am|would like to|want to|can)|anyone (?:interested in|for)|is there (?:anyone|someone)|looking for|looking to|searching for|seeking|need|want|someone (?:to|who can)|please|near me|nearby|we can connect|let['’]s connect|happy to discuss schedules.*)\b/gi,
      " ",
    )
    .replace(/[!?;.\n].*$/s, "")
    .replace(/\b(?:a|an|the|to|for|me|my|some|any|and|with)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = (cleaned || description.trim()).split(/\s+/).slice(0, 6);
  let summary = words.join(" ");
  if (role === "learn")
    summary = summary
      .replace(
        /\b(tutor|teacher|trainer|mentor|instructor|learn|learning|lessons)\b/gi,
        "",
      )
      .trim();
  if (role === "teach")
    summary = summary
      .replace(/\b(teach|teaching|tutor|offer|lessons)\b/gi, "")
      .trim();
  const prefix = prefixes[role] || "";
  const title = `${prefix} ${summary}`.replace(/\s+/g, " ").trim();
  const short =
    title.length > 58 ? `${title.slice(0, 55).replace(/\s+\S*$/, "")}…` : title;
  return short ? short[0].toUpperCase() + short.slice(1) : "New connection";
}

export function fallbackInterpretation(description: string): Interpretation {
  return {
    title: intentHeading(description),
    role: inferIntentRole(description),
    category: "Community",
    mode: /\b(remote|online|virtual)\b/i.test(description)
      ? "online"
      : "hybrid",
    city: "",
    tags: [],
    skills: [],
    participants: 2,
    starts_at: null,
    ends_at: null,
    topic: description.trim().slice(0, 300),
  };
}

export function compactHeading(title: string, description: string) {
  const text = title.replace(/\s+/g, " ").trim();
  if (
    !text ||
    text.toLowerCase() === description.trim().toLowerCase() ||
    text.split(" ").length > 8 ||
    text.length > 60
  )
    return intentHeading(description);
  return text;
}
