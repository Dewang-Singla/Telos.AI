# Changelog

## Matching context and saved-search reuse — 4 November 2026

- Updated the matching contract per the user's clarification: all qualified matches show the exact matching description, including older real-user intents. Removed the matching-text switch and misleading Private history label. Show on profile remains separate and optional; normal search/Feed do not list raw intents.
- Added migration 007 with unconditional matched descriptions and serialized reuse of equivalent active searches. Owner, location, role, skills, schedule, profile-display and other search constraints still distinguish separate searches. Existing duplicate rows are not deleted automatically.
- Reopening preserves a stable selected record and waits for its location context; unchanged submissions only refresh matches. Main-text edits send the existing ID and preserve saved constraints. A synchronous submission guard blocks burst duplicates. Added database/API/input regressions and expanded the live browser specification.
- Added DEMO_INTENTS.md with every bundled topic's exact base pair and the second-intent suffix. The existing demo dataset remains 80 bots, 160 intents and 240 posts; no reseeding is required for this change.

## Direction-aware matching and offline demo loader — 4 November 2026

- Added migration 006: infer common English role direction without AI; complementary providers rank ahead of peers within online/offline groups; hire/hire and work/work are excluded, while co-learners remain eligible. Keyword topic matching excludes generic role words.
- Added owner-controlled Show intent to matches. New app searches expose exact matched text when checked; existing searches retain hidden text until opted in. Profiles, Feed and normal search do not become public intent directories.
- Added a service-role-only loader for 80 clearly labeled offline demo bots, 160 intents and 240 posts. Accounts are login-banned, use discarded random passwords and send no email. Content is idempotent and supports city/coordinate demonstration. Live loading requires the owner's secret key locally and has not run yet.
- Removed the routine confirmation-resend link from login; it appears when an actual unconfirmed-email response requires it. Existing verified accounts should sign in directly. University mail delivery still needs inspection of the specific Auth log/spam/quarantine result.

## Signup verification codes and Google OAuth — 4 November 2026

- Added an email-code step after password signup and confirmation resend, leading-zero-safe code input, server-side token verification, expiry/attempt errors, cooldown and a path to enter an existing code after reopening the app.
- Added Continue with Google on sign-in/signup using Supabase PKCE and the existing cookie callback. Disabled providers are handled before navigation; callback cancellation uses a fixed local message.
- Prepared a signup email template and exact hosted setup instructions in AUTH_SETUP.md. Cloud template/SMTP/Google credentials and real-account delivery/OAuth tests are pending. This change is signup verification, not authenticator MFA.

## Optional profile location fields — 4 November 2026

- Split profile location into independently optional City, State and Country inputs, with consistent profile/match display and no separators for missing values.
- Added migration 005 with empty defaults and owner-write grants, preserving existing City data and profile visibility rules. The existing cloud project needs only this new migration.
- Added validation/formatting coverage for all eight field combinations and actual database upgrade, clearing, ownership and bounds checks. Updated the opt-in cloud/browser tests.

## Device-location handling — 4 November 2026

- Preserved manual city search and optional profile location. Nearby automatically detects only when permission is already granted; Use my location explicitly requests permission otherwise.
- Distinguished permission denial, timeout and unavailable devices, with location errors next to their controls. Manual input cancels stale detection results.
- Restricted radius controls to coordinate searches and prevented creation of nearby intents without an origin. Added device-location regressions and updated browser specifications; actual device detection still needs browser testing.

## Confirmation recovery — 4 November 2026

- Corrected the misleading expired-link message: session-cookie handoff failures, consumed/expired email tokens and provider outages now have distinct messages and retry paths.
- Added confirmation resend from login/signup, with a cooldown and a dedicated email-only form. Recovery failures return to password-reset requests. No confirmation requirement was disabled.
- Forwarded validated PKCE flow identifiers when provided, and added regression tests that also prevent codes/provider details from appearing in application diagnostic logs.

## Normal search — 4 November 2026

- Removed People from main navigation and its duplicate sidebar shortcut. Added one top Search with People/Posts result tabs, mobile access, query links, pagination, loading/error states and stale-response guards.
- Redirected `/discover` into `/search`. Profile search now handles usernames with underscores and pagination; post search uses the existing privacy-filtered listing RPC. Private intents are excluded.
- Added API, database and HTTP regressions and updated browser specifications. No new migration or external service is needed.

## Unified discovery and relationships — 4 November 2026

- Merged intent management into Find people and redirected the old `/intents` route. Removed duplicate navigation/shortcut links and added saved-intent pagination.
- Added one-way follows, follower/following counts and lists, and All/Following/Connections feed views with chronological ordering and existing privacy checks.
- Added actual profile relationship states, incoming request actions, cancellation, and removal. Connections persist independently of intents; removal preserves chat history while RLS prevents new messages. Blocking clears relationships and unblocking does not restore them.
- Restricted relationship helpers to the caller's relationships, and kept realtime relationship events private to affected accounts.
- Completed password recovery, restricted and tested auth callback destinations, fixed stale profile/feed responses, preserved photo URL/path alignment and made Retry refresh the session too.
- Added migration 004 and expanded PostgreSQL, API, callback, HTTP, opt-in cloud and browser test coverage. Cloud/browser execution still requires external setup.

## Private intent architecture — 4 November 2026

- Made Find people the landing screen. Private intents and ordinary social posts now use separate workflows, tables, APIs and permissions.
- Added owner-only intent reads with explicit, reversible Show on profile opt-in. Removed legacy RPCs that returned other users' intent rows.
- Matching now returns one permitted profile per person without intent text, IDs or timestamps. Ranking stays inside SQL. Private changes use anonymous realtime invalidations.
- Added text/photo posts, likes, comments, bookmarks, photo access policies and general custom profile details.
- Kept invitation search context private and removed old public request/intent associations.
- Added actual local PostgreSQL/PostGIS/pgvector/RLS integration tests and fixed new-profile/new-post RETURNING policies based on executed failures.
- Verified a clean production dependency audit; cloud/browser verification remains pending external setup.

## Social interface revision — 4 November 2026

- Replaced promotional discovery with a social timeline, larger bold type, concise controls, timeline profiles and a split messenger.
- Removed demo users/posts and all simulated browser-local activity from runtime screens.
- Added unrestricted free-form posting, optional details, keyword fallback and semantic indexing when configured.
- Added authenticated multi-session presence, online/time match ordering, live post invalidations and automatic match refresh.
- Added nearby toggles, current/manual location filters and consistent saved-state handling.
- Added latest-message previews, chat deep links, reconnect refresh and metadata-stripped profile uploads.
- Added migration 002 and tests for ordering, presence authorization, fallback posting, live database discovery and real two-user browser flows.
- Fixed profile upserts under column grants, made save/block writes idempotent without UPDATE access, and routed existing connections into their conversations.
- Preserved chat scroll position during history pagination and added stable timestamp/ID cursors.

## 1.0.0 — 4 November 2026

- Built the complete initial Next.js application from the empty working tree.
- Added a quiet green-and-cream social identity, responsive discovery, landing/auth/onboarding, profiles/settings, and labeled demo interactions.
- Added Supabase-backed API flows and a schema for profiles, intentions, saves, blocks, requests, conversations, messages, notifications, and reports.
- Added pgvector and PostGIS retrieval with private quantized location context, role complementarity, hard constraints, and factual matching explanations.
- Added server-only Gemini extraction/embeddings and graceful provider failure handling.
- Added RLS, immutable identity/timestamps, restricted grants, storage policies, realtime publication, and database spam controls.
- Added unit, HTTP, SQL syntax, opt-in live integration, and browser E2E tests; retained the source ZIP exporter.
- Documented exact first-time account setup and Vercel deployment. External integrations and deployment remain unverified pending the user's accounts/credentials.
