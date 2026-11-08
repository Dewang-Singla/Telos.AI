# Telos

[Live project](https://telos-ai-pink.vercel.app/) · [Database schema and setup](supabase/README.md) · [Matching design](MATCHING.md)

Telos has two separate flows:

- **Find people** (`/`, `/find`): write an intent, find matching people, and manage saved intents in the same workspace. The former `/intents` route redirects here. Qualified matches show the exact intent text for context. **Show on profile** is a separate, optional setting.
- **Feed** (`/feed`): publish ordinary text or photo posts, like, comment, and save. All, Following and Connections views show eligible posts newest first. Creating an intent never creates a social post. These are explicit filters, not a personalized recommendation model.

Profiles support a cover, photo, bio, interests, optional skills/website, arbitrary labeled details, and optional current intents. City, State and Country are independent optional fields: users can provide any combination or leave all three blank. Displays join only non-empty fields. No professional information is required.

Profile location is optional, editable display text, not proof of current location. Nearby search accepts either a manually entered intent city or device coordinates. Use my location requests browser permission; enabling Nearby reuses device detection automatically only if permission was already granted. Detection errors distinguish permission, timeout and unavailable-device cases. Manual city search filters city names, with radius controls reserved for coordinates. Browser coordinates can be inaccurate or spoofed and are not verified physical-location evidence.

The top Search opens `/search`, with People and Posts result tabs and pagination. On mobile it opens from the search icon. There is no separate People navigation section; `/discover` redirects to Search. Normal search respects profile/post visibility and blocking and does not search private intents.

## Run

Signup includes email-code verification and resend for unconfirmed accounts. Sign in/Create account also offer Google OAuth. The user reports signup-code delivery working after fixing Gmail SMTP credentials. Google consent and university-address delivery still need verification. Setup references are in [AUTH_SETUP.md](AUTH_SETUP.md). Email verification is not authenticator-app MFA; MFA is not implemented.

```powershell
npm.cmd install
npm.cmd run dev
```

Use the printed localhost URL. There is no automatic demo fallback. Copy `.env.example` to `.env.local` and configure your own Supabase project using [DEPLOYMENT.md](DEPLOYMENT.md). **A fresh database requires all ten migrations, in filename order, once each.** Run only pending migrations on an existing database. The schema and setup overview is in [supabase/README.md](supabase/README.md). AI is optional. The app has a public Vercel deployment; code on a fix branch may be newer than the live version until merged into `main` and deployed.

## Privacy and matching

The database stores intent rows behind owner-only RLS, except active intents explicitly shown on a profile. Independently, qualified matching results return the exact selected intent description for context, for both existing and new searches. Direct table access does not become public. Profile display remains optional, and searches are never copied into posts.

`find_people` evaluates candidate intents inside the database and returns a permitted profile, online status, optional coarse distance and exact `matched_intent` text. It never returns another user's intent ID, coordinates, embeddings, constraints or timestamp. Results contain one entry per person, selecting their most complementary qualified intent. Ordering is online first, then complementary roles before peers, then newest intent and stable ID. Teachers precede fellow learners within each presence group. Hire/work, request/offer and organize/join are complementary; co-learners can connect, while hire/hire and work/work do not qualify. Mode, explicit skills for complementary providers, time, visibility, blocking and proximity apply before limits.

With AI configured, the server extracts context, creates normalized 768-dimensional embeddings and reviews actual intent pairs for relevance. SQL applies topic, role, access, time and location constraints before contextual review. Conservative lexical matching remains available if the provider fails. The interface reports AI or keyword matching. Submitting a search makes it discoverable without adding it to saved history; saving keeps it beyond the transient search expiry. No fabricated probabilities are shown. Anonymous discovery invalidations do not publish intent changes. Invitation source context stays in a private table. See [MATCHING.md](MATCHING.md) for the current pipeline and limitations.

Reopening a saved intent is read-only until its text changes; edits preserve its ID and saved constraints. Equivalent active submissions are serialized/reused in the database without promoting their creation time. Existing duplicate rows are retained rather than automatically deleting their links/history.

## Demonstration data

If loading fails, first run `npm.cmd run seed:demo -- --check`. This validates administrator access and probes the demo function with an empty target, without creating accounts or content. Errors report safe stage/code/status information instead of exposing keys/provider messages. Do not rerun a successful migration because of the old generic "Cannot access the demo schema" message; use the specific diagnostic first.

Apply migration 006, then run `npm.cmd run seed:demo` in your own terminal. Enter a Supabase secret/service-role key at the hidden prompt; it is not saved or printed. Do not use a public key or put the secret in chat. The administrative loader creates **80 labeled offline demo bots, 160 intents and 240 text posts** covering learning, services, jobs and social activities. Accounts are banned from login, have random discarded passwords, and send no email. They do not chat or answer invitations automatically. City-centre demonstration coordinates support Nearby testing; profile names/badges clearly mark fictional bots. Re-running fills missing content without duplicating it or replacing real profiles. `npm.cmd run seed:demo -- --preview` prints a safe sample without credentials or network writes. The user now sees live demo profiles; the original seed totals are not independently audited by this workspace. See [DEMO_INTENTS.md](DEMO_INTENTS.md) for every bundled base pair and its second-intent suffix.

Migration 003 removes the older RPCs that returned full intent rows. Do not restore or call `discover_matches`, `match_intents`, or `nearby_intents`.

## Social features

- Independent text/photo posts with member-wide or connections-only visibility, editing and deletion.
- Up to four photos per post. Images are resized/re-encoded to remove metadata and uploaded to a private Storage bucket. Storage RLS follows post access. Authorized reads use signed URLs that expire after five minutes; a previously issued URL can remain valid until expiry after access changes.
- Persistent likes, comments and private saved posts, with database-backed counts and live feed invalidations.
- Profile media, general custom details and profile visibility settings.
- One-way Follow/Unfollow with profile counts and your own followers/following lists. Following never grants connections-only access or permission to chat.
- Mutual connection invitations from profiles or matches. Requests can be cancelled; either person can remove an accepted connection. Connections persist after the related intent ends. Old chat history remains readable after removal, while new messages are denied by RLS. Reconnecting creates a new conversation.
- Persistent direct messages, unread counts, timestamps, pagination and realtime subscriptions. Blocking removes mutual follows and active connections; unblocking does not restore them.
- Password-reset email callbacks lead to a working new-password form; callback destinations are restricted to known local paths.
- Server-authenticated, multi-tab presence sessions with heartbeat expiry, optional nearby matching, blocking and private reporting.

Private messages use membership RLS, not end-to-end encryption. Profile media remains public. AI processing sends intent text to the configured provider. Reports need manual review. Group chat, capacity reservations, push notifications and typing indicators are not implemented.

## Verify

```powershell
npm.cmd run check
```

The local database suite executes **all migrations and actual PostgreSQL/PostGIS/pgvector operations** using PGlite. It tests RLS, private matching, profile opt-in, role/skill/time constraints, proximity, presence, social interactions, photo-object permissions and conversation access. Its bootstrap supplies Supabase-like auth/storage catalog interfaces. It does not test Supabase's JWT service, Storage HTTP delivery, signed-URL implementation or websocket infrastructure. The PGlite PostGIS package is an experimental development dependency, not a production backend replacement.

With the app running:

```powershell
$env:TELOS_HTTP_TEST_URL='http://localhost:3000'
npm.cmd test
```

Browser tests, when a browser environment is available:

```powershell
npx.cmd playwright install chromium webkit
npm.cmd run test:e2e
```

Cloud integration tests require a **disposable** Supabase project with all migrations and two confirmed accounts. Set `TELOS_LIVE_TESTS=1`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `TELOS_TEST_EMAIL_A`, `TELOS_TEST_PASSWORD_A`, `TELOS_TEST_EMAIL_B`, and `TELOS_TEST_PASSWORD_B`. These tests modify the two profiles, create searches/posts/connections/messages, and test blocking. Use `TELOS_E2E_URL` for a separately running configured app. Do not run them against production accounts.

## Source

- `src/components/find-people.tsx`: private intent workspace and people results.
- `src/components/posts.tsx`: ordinary posts, photos, likes, comments and bookmarks.
- `src/components/relationships.tsx`, `src/components/connections.tsx`: following, connection states, request management and relationship lists.
- `src/components/telos.tsx`: navigation, top search, social feed and orchestration.
- `src/components/search-view.tsx`: normal people/post search, query links and result pagination.
- `src/components/views.tsx`: profiles, connections, chats, notifications and settings.
- `src/app/api/[resource]/route.ts`: authenticated APIs with no-store responses.
- `src/lib/ai.ts`: server-only structured interpretation and embeddings.
- `supabase/migrations/`: schema, RLS, matching, geography, presence and social storage.
- `tests/database.test.ts`: actual local database integration suite.

`npm.cmd run export:handoff` creates a verified source ZIP under `backups/`, excluding credentials, environment files, dependencies and generated output. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for verified results and external blockers.
