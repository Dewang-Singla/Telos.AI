# AI handoff

## Vision and instructions
Build Telos AI, a general-purpose intent-driven social platform. Semantic retrieval AND complementary goals are essential. Never label keyword fallback as AI; never invent real users, messages, distances, expertise, or deployment success. Keep Docker and Kafka deferred. Use legitimate free resources only. Preserve checkpoints automatically.

## Inspection and architecture
The workspace was initially empty. Requested stack: Next.js App Router/React/TypeScript/Tailwind/Lucide; Supabase Auth/PostgreSQL/Realtime; pgvector/PostGIS; configurable server-side AI. Preserve this architecture unless evidence justifies a change.

## Files
- `scripts/export-handoff.mjs`: dependency-free ZIP writer, CRC verification, exclusions, SHA-256 sidecar.
- `scripts/export-handoff.test.mjs`: tests exclusions and ZIP integrity.
- Required root docs describe status, setup, deployment, and next steps.
- `backups/`: ignored, local source checkpoints. No secrets or dependency directories.

## Current integrations
None configured. No deployed URL. No runtime or database migrations at initial checkpoint. No credentials have been requested or written.

## Continuing
1. Read README.md, PROJECT_STATUS.md, NEXT_STEPS.md, DEPLOYMENT.md and actual code.
2. Inspect Git status before modifications; preserve user changes.
3. Install dependencies and run documented checks.
4. Implement the next coherent milestone and validate it before unrelated changes.
5. Update all handoff docs. Run `npm run export:handoff` after every significant feature and before ending.
6. Commit working milestones when Git is configured; never force push or publish private source without authorization.

Actual code and executed tests override outdated documentation. Do not claim production readiness from source inspection alone.
