# Connect Telos and publish it

Workspace status: Supabase is connected locally; the user reports migrations 001-004 and real signup/login/profile creation plus working signup-code mail. Apply 005 if pending, 006 for demo provisioning, then 007 for consistent context/search reuse. Further authenticated features and a public deployment still need testing. Skip creation/migrations already completed. No AI provider or Vercel deployment is connected. Keep private tokens and database passwords out of chat.

## 1. Create Supabase

1. Visit [supabase.com/dashboard](https://supabase.com/dashboard), sign in, and create a free project named `telos`. Choose a region close to your expected users. Keep the database password in your password manager; the application does not need it.
2. Wait until the project is ready. Open **SQL Editor → New query**.
3. Run the seven files in `supabase/migrations` in filename order, once each. On this project, 001-004 were already applied; apply 005 if still pending, then 006 and `202611040007_match_context_and_search_reuse.sql`. Never rerun successful earlier migrations. Migration 005 adds optional profile State/Country; 006 adds role-aware retrieval and a service-role-only demo provisioner; 007 makes qualified intent context visible consistently and reuses equivalent active searches. Do not deploy this source without all seven migrations. Each file is transactional; fix any reported error before proceeding.
4. Open **Project settings → API** (or the project's Connect/API keys panel). Copy the **Project URL** and **publishable key**. A legacy anon key is also compatible. Never use a secret or service-role key for `NEXT_PUBLIC_` variables.
5. In this workspace, copy the environment template:

```powershell
Copy-Item -LiteralPath .env.example -Destination .env.local
```

6. Edit `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

7. In **Authentication → URL Configuration**, use `http://localhost:3000` as the development Site URL. Add both `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/callback?next=/update-password` to the allowed redirect URLs. The second is for password recovery. Keep email confirmation enabled for public registration.
8. Follow [AUTH_SETUP.md](AUTH_SETUP.md) to set the **Confirm sign up** email template to a verification code and configure Google sign-in. Keep email confirmation enabled. For real-user email delivery, configure custom SMTP: Supabase's built-in mail service restricts recipients and is for testing.
9. Restart `npm.cmd run dev` after changing env variables. Register, verify your email code, and complete Settings, or continue with Google after enabling the provider. Nothing is automatically seeded into the live database. The hosted template and Google credentials must be saved in Supabase; local source changes do not configure these cloud settings.

## 2. Optional: enable AI

Private searches, social posts and keyword matching work without an AI key. Skip this section for your first two-user test if you want.

1. Visit [Google AI Studio](https://aistudio.google.com/apikey), use an eligible free-tier project, and create an API key. Do not enable paid billing just to run Telos.
2. Read [current model availability, free-tier eligibility, limits, and data terms](https://ai.google.dev/gemini-api/docs/pricing). Availability depends on region and account; this workspace has not verified your eligibility.
3. Add server-only variables to `.env.local`:

```dotenv
GEMINI_API_KEY=YOUR_PRIVATE_API_KEY
GEMINI_TEXT_MODEL=gemini-3.5-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
MATCH_MIN_SIMILARITY=0.55
```

4. Restart the server. Use **Find people** to save a private intent. When configured, the server extracts context and indexes its meaning. **Details** lets you set the fields yourself. Provider failures preserve the search and allow keyword retrieval.
5. Sign in with a second account in another browser and create a related intent. Results should show the person's profile and show the exact qualifying intent description for context. Profile display remains separately opt-in. Verify that Feed stays separate, and test teacher/learner and hiring/job-seeker direction. Semantic retrieval requires successful indexing for both searches.

Text and embedding models are configurable but must support the implemented Gemini REST methods. Changing embedding models requires reindexing intentions; vectors from different model names are never compared. The server's `POST /api/index` accepts an owned intent ID for explicit reindexing. Do not switch the embedding dimensionality: the schema is 768-dimensional.

## 3. Publish to Vercel without a GitHub repository

1. Create a free account at [vercel.com/signup](https://vercel.com/signup). Use the Hobby plan only if your usage fits its current eligibility and terms.
2. From this project directory, run:

```powershell
npx.cmd vercel login
npx.cmd vercel link
```

Choose your personal account, create a new project named `telos` (or an available name), and use `.` as the directory. Next.js should be detected automatically.

3. In the Vercel project, open **Settings → Environment Variables**. Add every variable from `.env.local` for **Production**. Keep `GEMINI_API_KEY` server-only. Do not paste secrets into terminal arguments, Git, source archives, or this chat.
4. Set `NEXT_PUBLIC_APP_URL` to the exact production origin shown under the project's Domains settings, such as `https://YOUR_PROJECT.vercel.app`, without a trailing slash. Add the two public Supabase values and the server-only AI values before the production build.
5. Deploy:

```powershell
npm.cmd run check
npx.cmd vercel deploy --prod
```

The CLI prints a production URL after a successful deployment. If it requests payment or a paid upgrade, stop and use only eligible free-tier options. No deployment success has been verified by this workspace yet.

6. In Supabase **Authentication → URL Configuration**, set the Site URL to that production origin and add both `https://YOUR_PROJECT.vercel.app/auth/callback` and `https://YOUR_PROJECT.vercel.app/auth/callback?next=/update-password` to redirect URLs. Retain localhost callbacks only if you still use local development.
7. Verify the public URL in a signed-out browser. Open `/api/health` to confirm Supabase and AI configuration booleans. Health reports configuration presence, not database connectivity or provider success.
8. Register and confirm two real test accounts. Verify private searches, profile opt-in, nearby matching, profile details, text/photo posts, likes/comments/saves and live chat in two browsers. Follow/unfollow from profiles and check all three Feed views. Test request cancellation, acceptance and removal: past messages must stay readable after removal, and new messages must be denied. Following alone must not reveal connections-only posts/photos. Check blocking, unblocking and password recovery. Signup, cloud storage, matching and realtime are not considered verified until this passes.

For preview deployments, add their exact allowed origins/callbacks and preview environment values intentionally; do not allow arbitrary redirect domains.

## Database checks

The migrations enable RLS on every exposed app table. Direct intent reads remain owner-only unless explicitly displayed on the profile. Matching includes the exact selected description only for a qualified result, regardless of the deprecated sharing flag. Coordinates, embeddings, other intent fields and invitation search context remain private. Anonymous discovery events reveal no intent contents. Post photos follow post access. Conversation membership controls messages. Triggers enforce ownership/timestamps and spam limits. Actual local PostgreSQL tests cover these boundaries; cloud Auth, Storage HTTP/signed URLs and Realtime still require live testing.

## Troubleshooting

- **“Live accounts are not connected”**: check both `NEXT_PUBLIC_SUPABASE_*` values and restart/rebuild. Public values are embedded at build time.
- **Signup succeeds but no profile**: confirm email and visit Settings. No professional information is required.
- **Confirmation link fails but password login works**: the email is confirmed; only the automatic session handoff failed. Continue by signing in. Email confirmation is separate from the browser session exchange. Opening the link in the signup browser helps preserve its verification cookie. Expired/used links, missing session verifiers and network failures now show distinct messages. Login and the signup success screen provide a rate-limited Resend confirmation action. Keep email confirmation enabled.
- **Database action fails**: confirm the entire migration ran on the same project as your public URL/key.
- **AI unavailable**: confirm the server-only key, selected models, region eligibility, quota, and Vercel environment. Saving searches and keyword retrieval still work. Reindex after the provider recovers.
- **No matches**: keyword retrieval requires a shared nontrivial token; semantic retrieval requires successful indexing with the same model. Explicit role, skill, time, mode, privacy, and location requirements also apply. Sparse communities can legitimately have zero results.
- **No nearby results**: users must attach location to their private intent; city-only entries work through city search and cannot have a verified radius. Distances are deliberately coarse.
- **Device location fails**: open Telos directly in a browser, allow Location for the site, and enable location services in the device/Windows settings. HTTPS or localhost is required. The app distinguishes denied permission, timeout and unavailable location. Manual city search remains available; profile location is optional and does not establish the search origin. Browser-reported coordinates are not proof of physical presence.
- **Chat does not open**: the recipient must accept the connection request first. Verify the realtime publication migration and check the live-delivery status in Messages.
- **Write origin rejected**: set `NEXT_PUBLIC_APP_URL` to the exact origin used in the browser, no trailing slash, and redeploy. No wildcard origins are accepted.

References: [Supabase SSR setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings), [Vercel CLI guide](https://vercel.com/docs/projects/deploy-from-cli).
