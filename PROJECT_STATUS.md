# Project status — 23 November 2026

The pilot MVP upgrade was built and tested on `feat/pilot-mvp`. On 23 November 2026, the owner confirmed every migration-011 check returned true in Supabase. The release is ready for main and Vercel deployment; its database prerequisite is complete. Do not rerun successful migrations or run administrator reset tools as part of this upgrade.

## Product scope

Telos is a common place to connect around intentions: learning, work, collaboration, activities and community participation. The pilot release adds a public product introduction, guided discovery, text-based match explanations, private match feedback with hiding/undo, contextual invitation messages, personal progress and private connection-outcome reports. Complementary goals and topic relevance now come before online presence. Manual saving, exact matched-intent context, optional profile location, city/device location choices and independent social posts remain available.

The public homepage uses explicitly illustrative examples and has no invented customer counts, ratings or traction claims. Demo profiles stay labeled and offline; the discovery CTA opens a demo profile rather than implying a bot can reply. Pilot connection/event totals exclude demos.

## Verification

- Full local suite: 258 passed; 44 opt-in HTTP/provider/cloud cases skipped in the normal run.
- Separately enabled production HTTP checks: 30 passed.
- ESLint, TypeScript, source-export tests and isolated Next.js production compilation passed during this upgrade.
- Production dependency audit: zero known advisories reported for the installed production dependencies at this check. No dependency upgrades or new paid services were introduced.
- Database tests execute PostgreSQL, PostGIS and pgvector through PGlite. New checks cover relevance-before-presence, feedback ownership, hide/undo, changed text, accepted-participant-only outcomes, event deduplication and demo exclusion.

The computer-use native pipe and browser access host were unavailable in this session. Visual/browser interactions were not verified, and updated browser specifications were not executed. Local catalog shims do not verify Supabase Auth delivery, Storage HTTP, signed URLs or Realtime websockets. Two-account cloud testing is still required after deployment. No new live Gemini request was needed for this release's deterministic explanations and private feedback features.

## Deployment prerequisite

1. Run `supabase/migrations/202611230011_pilot_feedback_and_progress.sql` once, after successful migrations 001-010.
2. Run the read-only `supabase/admin/check_migration_011.sql`; all results should be true.
3. Merge the tested feature branch into main and verify Vercel's deployment.
4. Test matching, feedback/undo, invitations, chat and private outcomes with two real accounts, including mobile/browser location behavior.

The migration adds private tables, authenticated owner/participant functions and event triggers. It does not delete existing user content. Existing environment variables continue to apply.

## Measurement and boundaries

`supabase/admin/pilot_metrics.sql` is an administrator-only aggregate report. Event collection begins when 011 is installed; historical activity is not fabricated or backfilled. The report separates one-sided/two-way conversations and first/current useful self-reports. Those measurements do not establish retention, revenue or product-market fit. Event rows contain IDs, event names and timestamps, not search or chat text. Account deletion cascades the corresponding private records; operators should adopt a retention policy for the pilot.

Profiles, location and outcomes are self-reported. AI can be wrong or unavailable. Messages use conversation-membership access controls, not end-to-end encryption. Payments, identity verification, automated dispute resolution, push notifications and authenticator MFA are not implemented. SMTP/OAuth/provider credentials remain private configuration, not repository data.

See [PILOT.md](PILOT.md), [MATCHING.md](MATCHING.md) and [supabase/README.md](supabase/README.md) for rollout, matching and schema details.
