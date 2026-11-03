# Deployment

Not deployed. This document will be expanded alongside implementation. Do not use a paid plan, trial, or billing-enabled resource.

## Intended infrastructure
- GitHub private source repository (must be created/pushed by the owner unless already authorized access exists).
- Supabase Free: Auth, PostgreSQL, Realtime, pgvector/PostGIS.
- Vercel Hobby: Next.js; personal, non-commercial usage only. College demo fits this intended scope; commercial use requires reevaluation.
- Configurable AI provider; free availability and quotas vary. Unconfigured AI must be explicitly marked unavailable.

## Account setup required
1. Create a free Supabase project in your own account. Keep the database password private.
2. Apply repository SQL migrations when available.
3. Copy the project URL and publishable key into ignored `.env.local` using `.env.example`.
4. Set Supabase Auth Site URL and allowed redirects for localhost and the eventual production origin.
5. Import the private GitHub repository into a Vercel Hobby project; set environment variables there.
6. Run the production build, deploy, and test registration, authorization, intent persistence, and eventually two-user messaging.

No service-role key should be sent to browsers or stored in source. An actual public URL must be verified before reporting success.

## Official references checked 2026-11-03
- https://nextjs.org/docs/app/getting-started/installation
- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://vercel.com/docs/plans/hobby
