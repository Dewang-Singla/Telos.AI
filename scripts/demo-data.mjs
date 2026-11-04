// Explicitly fictional, offline demonstration accounts. Never imported by the app.
const packs = [
  [
    "guitar",
    "learn",
    "teach",
    "Looking for a guitar tutor to help me learn chords and fingerstyle.",
    "I teach guitar and offer patient lessons on chords and fingerstyle.",
    "Finally managed a clean chord change between G and C. Slow practice is paying off.",
    "Try ten minutes of chord changes with a metronome before learning a whole song.",
  ],
  [
    "piano",
    "learn",
    "teach",
    "I want to learn piano and need a teacher for music reading and scales.",
    "I teach piano with lessons on scales, music reading and rhythm.",
    "Practising hands separately made this piano piece much less intimidating.",
    "A relaxed wrist and a steady tempo matter more than playing fast.",
  ],
  [
    "Python",
    "learn",
    "teach",
    "Looking for a Python tutor to learn programming and build small projects.",
    "I teach Python programming through small practical projects.",
    "Built a tiny Python script that sorts my downloads folder. Useful projects are the best practice.",
    "Writing down the expected output before running code helped me understand loops.",
  ],
  [
    "English",
    "learn",
    "teach",
    "Looking for an English teacher to practise conversation and pronunciation.",
    "I teach English conversation and pronunciation through relaxed practice.",
    "Recorded a short introduction in English today. Hearing it back made my progress clearer.",
    "Learning a phrase in a conversation is easier than memorising isolated words.",
  ],
  [
    "calculus",
    "learn",
    "teach",
    "I need a calculus tutor for derivatives and integration practice.",
    "I teach calculus, derivatives and integration with worked examples.",
    "Sketching the curve first helped me understand what the derivative means.",
    "Trying a calculus problem without checking the solution is uncomfortable but useful.",
  ],
  [
    "photography",
    "learn",
    "teach",
    "I want to learn photography and need a tutor for portraits and lighting.",
    "I teach photography with practical portrait and lighting lessons.",
    "Window light and a plain background made today's portrait session surprisingly simple.",
    "Tried the same scene at three exposures. Comparing them taught me more than another settings chart.",
  ],
  [
    "chess",
    "learn",
    "teach",
    "Looking for a chess teacher to learn openings and improve endgames.",
    "I teach chess with opening principles and practical endgame drills.",
    "Lost my queen but found the mistake during analysis. That game was still useful.",
    "A king and pawn endgame can be more interesting than a complicated opening.",
  ],
  [
    "yoga",
    "learn",
    "teach",
    "Looking for a yoga trainer for mobility and breathing practice.",
    "I teach yoga with gentle mobility and breathing lessons.",
    "Made space for a short stretch between study sessions today.",
    "Taking a quiet break outside helped me return to work with a clearer head.",
  ],
  [
    "React developer",
    "hire",
    "work",
    "Hiring a React developer for a small web application project.",
    "Looking for a React developer job building accessible web applications.",
    "Finished a React interface with keyboard navigation and clear focus states.",
    "A loading state should explain what is happening without shifting the entire layout.",
  ],
  [
    "graphic designer",
    "hire",
    "work",
    "Hiring a graphic designer for event posters and a visual identity.",
    "Looking for a graphic designer job creating posters and visual identities.",
    "Reduced a poster to two type sizes and one accent colour. It reads much better now.",
    "Collecting early sketches makes it easier to explain why a design changed.",
  ],
  [
    "video editor",
    "hire",
    "work",
    "Hiring a video editor for short educational videos and subtitles.",
    "Looking for a video editor job working on educational videos and subtitles.",
    "Subtitles need enough time on screen to read comfortably.",
    "Cutting a few seconds of silence gave this edit a much better rhythm.",
  ],
  [
    "content writer",
    "hire",
    "work",
    "Hiring a content writer for clear articles about technology.",
    "Looking for a content writer job writing clear technology articles.",
    "Rewrote the introduction after finishing the article. Now it actually matches the point.",
    "Reading a draft aloud catches awkward sentences that a spell checker misses.",
  ],
  [
    "badminton",
    "socialize",
    "socialize",
    "Looking for badminton partners for friendly doubles games.",
    "Looking for badminton partners to play friendly doubles and practise.",
    "A close doubles game and a long walk home made a good evening.",
    "Working on footwork before trying another jump smash.",
  ],
  [
    "hiking",
    "organize",
    "join",
    "Organizing a hiking group for a relaxed nature trail.",
    "Looking to join a hiking group for a relaxed nature trail.",
    "The best part of this trail was the quiet stretch before the viewpoint.",
    "Packed lighter for this hike and remembered enough water this time.",
  ],
  [
    "volunteering",
    "organize",
    "join",
    "Organizing a volunteering group for a neighbourhood cleanup.",
    "Looking to join a volunteering group for a neighbourhood cleanup.",
    "Spent the morning helping clean a public path. Small groups can get a surprising amount done.",
    "Keeping reusable gloves and bags ready makes the next cleanup easier to start.",
  ],
  [
    "plumbing",
    "request",
    "offer",
    "I need help with a plumbing repair for a leaking kitchen tap.",
    "Offering plumbing repair help for leaking kitchen taps.",
    "Fixed a small drip before it turned into a bigger repair.",
    "Labelled the shutoff valves today. Future me will appreciate that.",
  ],
  [
    "bicycle repair",
    "request",
    "offer",
    "I need help with bicycle repair and adjusting the brakes.",
    "Offering bicycle repair help with brake adjustments and maintenance.",
    "A clean chain made my bicycle ride quieter than expected.",
    "Learning which tool does what is half the fun of a small repair.",
  ],
  [
    "cooking",
    "learn",
    "teach",
    "I want to learn cooking and need a teacher for simple vegetarian meals.",
    "I teach cooking with simple vegetarian meals and kitchen basics.",
    "Made dinner from the vegetables already in the fridge. No extra shopping needed.",
    "Writing down rough quantities means I can make a good meal again.",
  ],
  [
    "music collaboration",
    "collaborate",
    "collaborate",
    "Looking to collaborate on original music and acoustic recordings.",
    "Looking to collaborate on original music with an acoustic sound.",
    "Recorded a rough melody before I could forget it. A phone memo is enough to save an idea.",
    "Leaving space between parts made the arrangement sound fuller.",
  ],
  [
    "startup",
    "collaborate",
    "collaborate",
    "Looking for a cofounder to collaborate on a student startup project.",
    "Looking for a cofounder to build a useful student startup together.",
    "Talked to three people about a problem before sketching another solution.",
    "A small prototype gave us better feedback than a long feature list.",
  ],
];
const firstNames = [
  "Aarav",
  "Meera",
  "Kabir",
  "Isha",
  "Rohan",
  "Ananya",
  "Dev",
  "Tara",
  "Arjun",
  "Naina",
  "Vihaan",
  "Sana",
  "Aditya",
  "Kavya",
  "Nikhil",
  "Diya",
];
const lastNames = [
  "Mehta",
  "Sharma",
  "Rao",
  "Kapoor",
  "Singh",
  "Verma",
  "Nair",
  "Gupta",
];
const locations = [
  ["Chandigarh", "Chandigarh", 30.73, 76.78],
  ["Mohali", "Punjab", 30.7, 76.72],
  ["Delhi", "Delhi", 28.61, 77.21],
  ["Bengaluru", "Karnataka", 12.97, 77.59],
];
export const DEMO_MARKER = "v1";
export const DEMO_EMAIL_SUFFIX = "@demo.telos.invalid";
export function demoAccounts() {
  return packs.flatMap(
    (
      [topic, firstRole, secondRole, wanted, offered, postA, postB],
      packIndex,
    ) =>
      Array.from({ length: 4 }, (_, variant) => {
        const index = packIndex * 4 + variant;
        const [city, state, latitude, longitude] =
          locations[(packIndex + Math.floor(variant / 2)) % locations.length];
        const role = variant % 2 ? secondRole : firstRole;
        const description = variant % 2 ? offered : wanted;
        const search = (text) => ({
          title: text.slice(0, 100),
          description: text,
          category: "Community",
          role,
          mode: "hybrid",
          city,
          tags: [topic],
          skills: [],
          starts_at: null,
          ends_at: null,
          participants: 2,
          show_on_profile: false,
          show_in_matches: true,
          latitude,
          longitude,
        });
        return {
          email: `demo-${String(index + 1).padStart(3, "0")}${DEMO_EMAIL_SUFFIX}`,
          content: {
            profile: {
              username: `demo_${String(index + 1).padStart(3, "0")}`,
              name: `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length) % lastNames.length]} · Demo`,
              bio: `Offline demo bot. Interested in ${topic}, thoughtful conversations and community projects.`,
              city,
              state,
              country: "India",
              interests: [topic, "Community"],
              skills: variant % 2 ? [topic] : [],
            },
            intents: [
              search(description),
              search(
                `${description} Happy to discuss schedules and get started with a short conversation.`,
              ),
            ],
            posts: [
              {
                body:
                  variant === 0
                    ? postA
                    : variant === 1
                      ? postB
                      : variant === 2
                        ? `${postA}\n\nI have been keeping a practice notebook to track the small improvements.`
                        : `${postB}\n\nExplaining the process to a friend helped me notice what I had skipped.`,
              },
              {
                body: [
                  `My ${topic} notes from this week: start small, ask a specific question and try again after feedback. It feels better than waiting until I know everything.`,
                  `One thing I appreciate about ${topic} is how much you can learn from someone else's approach. What changed the way you work?`,
                  `Setting aside an hour for ${topic} in ${city} this week. I want to finish one small task rather than start five more.`,
                  `Sharing progress on ${topic} feels easier when the conversation includes what went wrong. The unfinished attempts are part of it too.`,
                ][variant],
              },
              {
                body: [
                  `A small ${topic} goal for the week: keep a record of what I tried, what worked and what I want to improve. What helps you keep practising?`,
                  `Back in ${city} after a busy week. Looking forward to making time for ${topic} and catching up with the community.`,
                  `Found an old set of ${topic} notes today. The things that felt complicated then are becoming familiar. Progress is easy to overlook.`,
                  `A useful ${topic} discussion ends with something I can try myself. I am collecting those practical ideas this month.`,
                ][variant],
              },
            ],
          },
        };
      }),
  );
}
