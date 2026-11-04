# Verified status

Current performance update: API requests no longer run proxy Auth plus handler Auth. The handler verifies getClaims (including UUID sub and authenticated role); RLS remains authoritative. Proxy refreshes page JWT claims and cookies, excludes API/callback routes, and marks refreshed-cookie responses no-store. Browser getSession is only UI bootstrap; one in-flight refresh is shared, stale account responses are ignored, repeated same-account SIGNED_IN/TOKEN_REFRESHED do not refetch profiles or recreate presence. Views are dynamically loaded; Telos only fetches its own intent list on Profile (FindPeople manages its own list). tsconfig excludes backups. vercel.json pins functions to bom1, matching Mumbai Supabase. Latest suite: 225 passed/11 cloud-only skipped, lint/typecheck and isolated production build pass. Warm signed-out localhost page responses were about 50-70 ms; do not claim authenticated or production latency was measured. User said logging in and basically all actions felt slow. Gemini remains configured locally and provider checks previously passed; Vercel still needs its own environment variables. No SQL migration is required for these performance changes.


GitHub/AI setup update: repository is https://github.com/Dewang-Singla/Telos.AI.git. Local main preserves both the original local history and remote initial README commit. The user saved GEMINI_API_KEY privately in ignored .env.local. A synthetic Gemini embedding request succeeded (768 dimensions). gemini-2.5-flash-lite returned HTTP 404 for this key, so the local setting and shipped default were changed to gemini-3.5-flash-lite; a live synthetic request with the full app JSON schema then succeeded. No key was printed or committed. This validates provider connectivity/schema, not end-to-end app matching quality. Existing/bot intents still need indexing before semantic comparisons can benefit. Push is being completed using existing local Git credentials; no new GitHub plugin connection was required.


Deployment-readiness check: the current source passed an isolated Next.js 16.4.5 Turbopack production build, TypeScript compilation, page-data collection and static generation. It ran from backups/production-check-UNi9GE with a shared dependency junction and an isolation-only tracing/Turbopack root; the active localhost dev .next was not touched. Only public connection environment values were supplied. This is local build verification, not a successful Vercel deployment or cloud two-user realtime test. The previous full local suite remains 208 passed/11 cloud-only skipped. Gemini API interpretation/768-dimensional embeddings are implemented but no key/live provider call is configured or verified. Old/bot intents require indexing too before semantic matching can compare them. Git has no remote; GitHub/Vercel setup remains user action.


Latest validation for migration 007/search reuse: 208 local tests passed across twelve files; 11 cloud-only tests skipped. Lint and TypeScript pass. Browser specifications include context-loading/reopen/edit/count regressions but were not executed here. Cloud migration 007 still needs to run once.


Latest clarification: the user wants exact intent text visible to all qualified matches, including existing real-user intents. Matching text is no longer opt-in. Profile display remains optional; intents still do not become ordinary posts or globally readable rows. Migration 007 changes matching output and serializes equivalent active-save reuse. It must run once after 006; do not rerun 006. Frontend reopening now retains selected identity through context loading, blocks submission until ready, refreshes unchanged searches without a write, and updates changed text using the existing ID/constraints. New-search saves use a synchronous guard. Existing duplicate rows are not automatically deleted. DEMO_INTENTS.md lists exact bundled base pairs/suffix. User now sees seeded bots and has proven administrator/006 access; exact deployed counts are not independently verified.


Updated 4 November 2026 (Asia/Calcutta).

## Current implementation

Find people is the intent workspace; intents do not create social posts. Migration 006 infers common English role direction without an AI key, with explicit Details roles taking precedence. Teachers precede fellow learners within each presence group. Hire/work, request/offer and organize/join complement each other. Hire/hire and work/work do not qualify. Ordering is online first, complementary relationship next, newest qualified intent next. Per-person dedup selects the best intent. Provider skill constraints, time, mode, blocking, visibility and geography still apply. Rule-based inference has limited language coverage; optional AI remains available.


Feed supports real text/photo posts, likes, comments, saves, edits/deletion and chronological All/Following/Connections views. Profiles support independent optional City/State/Country, custom details, media and follows. Mutual connections persist beyond intents; removal keeps chats read-only. Blocking ends follows/connections. Nearby supports manual intent city and optional browser coordinates, with radius only for coordinates. Profile location is independent and self-reported.

Signup has email-code verification and resend. Routine login now shows resend only after email_not_confirmed. Resend is not passwordless login; confirmed accounts sign in directly. Google OAuth uses PKCE and the cookie callback. Authenticator-app MFA is not implemented.

An administrative loader prepares 80 labeled offline bots, 160 intents and 240 text posts. Fictional profiles have coarse city-centre locations. Accounts are login-banned, have discarded random passwords, send no signup email and never simulate presence or auto-chat. A hidden local secret-key prompt avoids saving credentials. Provisioning checks metadata, refuses real profiles and is idempotent. No live demo records have been loaded by this workspace.

## Verification

The user reports migration 006 was run, but the live loader stopped at its generic direct-profile-table preflight. Replaced that unnecessary read with explicit administrator validation and a no-write managed-account guard probe of the actual demo RPC. Added --check for diagnosis without seeding. Nine loader/dataset tests pass, including five new preflight cases; the exact cloud failure is still awaiting this diagnostic, so live demo records are not verified.

- Latest complete local suite: 197 tests across eleven files passed; 11 cloud-only cases skipped. TypeScript and ESLint pass.
- Actual local PostgreSQL/PostGIS/pgvector/RLS tests cover direction, provider priority, hiring exclusions, opt-in text, privacy, demo permissions/idempotence/offline enforcement, posts, locations, relationships and chat. Helper/API/HTTP tests cover auth and provisioning.
- Local auth/storage catalog shims do not verify real Supabase JWT, Storage HTTP/signed URLs or realtime websockets.
- Browser specifications were updated, not executed: browser/native access is unavailable. An isolated production build now passes; the user's dev server remains running.
- Exporter tests previously pass. Last audit: zero production vulnerabilities, 16 moderate development-tool findings; no incompatible forced updates were applied.

## Cloud state and next actions

The user reports migrations 001-004 applied, real signup/login/profile creation and working signup-code emails after fixing Gmail SMTP username. Google provider setup was in progress; actual Google consent/callback is unconfirmed. University-address resend delivery is undiagnosed: first check that signup is unconfirmed, then inspect the specific Auth log and Junk/Other/quarantine. SMTP acceptance does not prove inbox delivery.

Apply migration 006, plus 005 first if still pending, once each. Then run npm.cmd run seed:demo locally and enter a Supabase secret/service-role key at the hidden terminal prompt. The public key cannot provision accounts. Never rerun successful 001-004. .env.local is ignored/excluded from archives. No AI key or Vercel deployment is configured. Cloud matching, storage, relationships, realtime and the demo loader still require real-project testing.

## Limits

Bots do not answer invitations or chat. Two real users are required for interaction tests. Presence expires after 90 seconds. Keyword rules are not general language understanding. Reports need manual review. Messages are not end-to-end encrypted. Signed photo URLs can last five minutes after access changes; profile media is public. Upload cleanup, group chat, push notifications and typing indicators are not implemented.
