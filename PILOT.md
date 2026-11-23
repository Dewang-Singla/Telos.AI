# Telos pilot release

Telos remains a general place for connecting around intentions: learning, creating, work, activities and community participation. This release strengthens the path from an intention to a useful conversation rather than claiming a proven business model.

## What changed

- A public homepage with interactive, explicitly illustrative examples, working discovery links and clear product boundaries.
- Guided search prompts, optional profile-readiness suggestions, clearer empty/loading states and recovery of a pending search through sign-in/profile creation in the same browser tab.
- Complementary goal and topic fit before online status; text-based explanations without made-up confidence percentages or verified-expert badges.
- Private helpful/not-relevant feedback, reason selection, hiding and undo. Hiding affects the author's source/candidate text pair only.
- Contextual, editable invitation introductions. Demo result cards open demo profiles instead of suggesting that bots can respond.
- A private My progress view with real-member connections, conversations and optional useful/not-yet/not-a-fit reports.
- Administrator-only aggregate reporting from actual database events, excluding demos. No analytics vendor, new AI provider or paid dependency was added.

## Rollout

1. Apply migration 011 once in Supabase, after successful migrations 001-010. This migration adds tables/functions/triggers and does not remove existing content.
2. Run `supabase/admin/check_migration_011.sql`; every column should be true.
3. Deploy the tested branch through main. Vercel uses the existing environment variables.
4. Test with two real accounts: a relevant complementary search, a peer search, an unrelated search, feedback/undo, invitation acceptance, a message from each participant and private outcome reporting. Check mobile layout and browser location permission behavior.
5. Run `supabase/admin/pilot_metrics.sql` as an administrator to review aggregate activity. Do not expose this report as a public API.

## Evaluate the pilot honestly

Review real conversations and voluntary feedback with a small pilot group. Investigate no-result searches, mismatched roles, failed invitations and connections that lead nowhere. Look for repeated use across several days and specific examples of useful outcomes. Invitation totals, demo content and self-reports alone do not demonstrate retention, revenue or product-market fit.

The report distinguishes one-sided from two-way conversations. It reports first useful self-reports and current useful outcomes separately. Event collection begins when migration 011 is installed; historical actions are not fabricated or backfilled. Connection counters are snapshots, not guaranteed lifetime totals. Event rows contain user/entity IDs, event names and timestamps; administrators should adopt a retention policy appropriate to the pilot. Deleting an account cascades its private event records.

## Known boundaries

Relevance depends on available intentions and language interpretation; AI can be unavailable or wrong. Profiles, location and reported outcomes are self-reported. There are no payments, identity verification, automated dispute resolution or end-to-end message encryption. Browser/UI and two-account cloud checks must be completed before treating this release as production-validated.
