# Telos AI

An intent-driven social platform: express what you want to do, find compatible people, and connect. General-purpose by design: learning, work, hobbies, community, and everyday activities.

## Workspace checkpoint

The original workspace was empty. This checkpoint establishes documentation and a dependency-free, Windows-compatible source ZIP exporter before application development.

Prerequisite: Node.js 22+ and npm. The application milestone in progress uses Next.js App Router, TypeScript strict mode, Tailwind, Supabase Auth/PostgreSQL, pgvector, and PostGIS. See PROJECT_STATUS.md for verified progress; do not assume planned features exist.

```powershell
npm install
npm run dev
```

Local URL: http://localhost:3000. Configuration, database setup, and deployment are in DEPLOYMENT.md. No secrets belong in Git or exported source. All provider configuration must remain on the server except Supabase's public URL/publishable key.

## Source preservation

```powershell
npm run test:export
npm run export:handoff
```

The exporter writes a verified ZIP plus SHA-256 file to `backups/`. It includes source, tests, migrations, docs, package manifests, lockfile, and `.env.example`. It excludes dependencies, generated build output, Git internals, private env files, credential filenames, private keys, and symlinks. Never put secrets in source files. ZIPs are independent portable checkpoints, not a substitute for GitHub backups.

Read AI_HANDOFF.md and NEXT_STEPS.md to continue with another coding agent.
