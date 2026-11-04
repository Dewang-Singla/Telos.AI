# Remaining integration work

Current next action: run only new migration 007 after successfully applied 006, then refresh Telos. Real users and bots should show exact matching intent text. Reopen a saved search repeatedly and edit its text; its saved ID/count must stay stable. Do not reseed or rerun earlier successful migrations for this change.

The user reports working signup-code email after fixing Gmail SMTP. Verify Google sign-in and university-address mail delivery using the specific Auth logs; setup reference is [AUTH_SETUP.md](AUTH_SETUP.md). No additional migration is needed for auth. Keep email confirmation enabled.

1. Supabase is connected and the user reports signup/login/profile creation working with migrations 001-004. Apply 005 if pending for optional State/Country, then 006 for direction-aware matching and demonstration data. Verify saving/reloading any combination of City/State/Country, including clearing all three. Do not rerun earlier migrations.
2. Run the cloud suite on a disposable project and two confirmed accounts. Verify search privacy and profile opt-in through direct APIs as well as the UI.
3. Test real uploads/signed URLs, private post access, follow/unfollow and all Feed views. Test request cancellation, acceptance, removal, retained chat history, forbidden writes after removal, reconnecting, blocking/unblocking and password recovery in two browsers.
4. Run desktop/mobile browser checks and inspect screenshots. Local PostgreSQL integration does not verify browser rendering or Supabase websocket delivery.
5. Optionally configure an eligible AI key and evaluate semantic results. Keyword retrieval remains usable without it.
6. Deploy to Vercel and verify the public URL, redirects, registration and the two-user workflow. Do not report deployment before it succeeds.
7. Add upload retention/report-review tooling before wider launch. Resolve remaining development-tool advisories without unnecessary major upgrades.
