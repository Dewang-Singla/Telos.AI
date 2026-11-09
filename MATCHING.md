# Intent matching

Migrations 009 and 010 are required for this version. On 9 November 2026, this project's owner confirmed all read-only migration-010 checks returned true in Supabase; do not rerun successful migrations. The check is available in `supabase/admin/check_migration_010.sql`.

## Search lifecycle

- Submitting Find people publishes an active, matchable intent immediately. It is absent from the saved list and from the public profile.
- The newest submitted search replaces the account's previous unsaved search. It expires after 24 hours. Saved intents remain active until paused, completed or deleted.
- Save intent promotes the current search into saved history without creating another copy. Profile display is a separate choice.
- Repeated equivalent submissions reuse an intent using the user's input, independent of generated headings, categories and inferred fields. Submission guards also prevent rapid double saves. Existing historical duplicates are not deleted.
- Per-session ordering and a database generation counter stop an older, slow AI request from replacing a newer search.

## Relevance and location

1. Gemini extracts a short heading and the purpose of the actual text. Unspecified mode means either; explicit user fields take precedence. No dates or mandatory skills are invented.
2. PostgreSQL retrieves a bounded pool using normalized subjects and pgvector. Generic boilerplate, unrelated named subjects, inactive/expired searches, blocks, profile access, incompatible roles and hard requirements are excluded first.
3. Gemini checks pairs of actual intent descriptions. Similar embeddings alone are insufficient: Python/Java tutoring and guitar/piano lessons can have deceptively high cosine similarities.
4. Pair decisions and owner-scoped derived artifacts are cached for 24 hours. Candidate/source text changes invalidate pair decisions. When the provider is unavailable, only conservative lexical matches are displayed and the UI reports Keyword matching.
5. Qualified people retain online-first, complementary-role, then newest-intent ordering. One qualifying intent is selected per person. Scores, vectors and coordinates are not exposed in match responses.

Volunteering requests and offers are normalized to organizer/participant roles, including older intents classified as hiring/work. A broad volunteering offer can qualify for a specific drive; the contextual review still checks restrictions and cause compatibility. Review-policy and interpretation-cache versions invalidate earlier decisions for these cases.

Nearby enables location filtering. The existing city-entry or Use my location choice is unchanged. GPS search uses the currently selected coordinates and radius. Manual city search compares whole normalized city names, including common aliases such as Bangalore/Bengaluru; it does not pretend that a typed city establishes a kilometre radius. Profile location remains independent.

## Verification

The PostgreSQL suite exercises unsaved discovery, saved-history separation, provider/peer direction, video editing vs graphic design, misleading identical vectors, whole-city matching, stale coordinates, text-pair cache permissions, and out-of-order search completion. Route tests cover contextual decisions, provider failure and sanitized responses.

`tests/ai-live.test.ts` is an explicit opt-in provider check using synthetic examples. It verifies guitar teachers/peers vs unrelated tutors, video editing vs graphic design, concise headings, and the reported climate-drive/general-volunteer pair. It needs `TELOS_AI_CHECK=1` and the server-side Gemini environment. Normal tests never call the provider. Free-tier limits still apply; no billing configuration is changed by this update.

Automated checks do not establish perfect relevance for arbitrary language or prove live websocket/browser behavior. Two-account deployed testing is still required after migration and deployment.
