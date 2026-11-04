# Enable email codes and Google sign-in

The app implements signup verification codes, resend, password login, and Google OAuth with the existing secure session callback. These are email verification and sign-in methods, not a second MFA factor. Authenticator-app MFA is not implemented. No new database migration is needed for this auth change.

The user reports signup-code email now works after correcting the Gmail SMTP username to the full sender address. Resend confirmation is only for an existing unconfirmed signup, not a passwordless login code. The login page now offers that link only after Supabase reports email_not_confirmed. For university mail that is still awaiting verification, check Junk/Other and the specific Auth resend log before assuming delivery; an accepted SMTP message may still be quarantined by the university. A confirmed account can simply log in and does not need another signup code.

## 1. Email verification codes

1. Open [your Supabase project](https://supabase.com/dashboard/project/rrrnfolbmqbhamvgnhqy/auth/templates).
2. In **Authentication → Sign In / Providers → Email**, keep email signup and **Confirm email** enabled.
3. Open **Authentication → Email → Templates** (some dashboard layouts call this **Email Templates**). Choose **Confirm sign up**.
4. Set the subject to `Your Telos verification code`.
5. Replace the template body with the contents of [supabase/templates/confirm-signup.html](supabase/templates/confirm-signup.html), then **Save**:

```html
<h2>Verify your Telos email</h2>
<p>Enter this code in Telos:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>If you did not create a Telos account, you can ignore this email.</p>
```

6. Change only **Confirm sign up**. Keep **Reset password** as a link email; the recovery flow still needs that link. Do not put a fixed code in the template. Supabase generates and checks `{{ .Token }}`.
7. In **Authentication → URL Configuration**, keep development Site URL `http://localhost:3000`. Allow `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/callback?next=/update-password`.
8. Refresh Telos, create a new account, and enter the email code on **Verify your email**. Resend becomes available after 60 seconds, subject to Supabase's server limits. Supabase sets code expiration and attempt limits. An invalid/expired code never grants access.
9. If the page was closed, go to **Sign in → Resend confirmation**. Request a code or choose **Enter a code**, fill the signup email and the code, and verify. Existing confirmed accounts continue signing in with their password; they do not need to re-register.

Old confirmation-link emails still use the existing callback. Newly sent emails show codes only after saving this template in the hosted dashboard. The local file alone does not update hosted Supabase.

### Sending to real users

Supabase's built-in email service is for testing, restricts recipients to authorized project-team addresses, and has tight limits (currently two email sends per hour). For other users, open **Authentication → Email → SMTP Settings** and configure a custom SMTP provider. Enter the provider's SMTP host, port, username, password, verified sender address and sender name `Telos` directly in Supabase. Verify any domain records required by that provider. Keep SMTP passwords out of chat, source code and public environment variables. Test signup, resend and password-reset delivery before inviting users.

Reference: [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), [SMTP delivery restrictions](https://supabase.com/docs/guides/auth/auth-smtp).

## 2. Continue with Google

1. Open [Google Cloud Console](https://console.cloud.google.com/). Select or create a project named **Telos**.
2. Open **Google Auth Platform → Branding → Get started** if prompted. Use app name **Telos**, your support email and your contact email.
3. In **Audience**, choose **External**. During **Testing**, add your own Google address and any testers under **Test users**. Publish the audience to production when you are ready for public sign-in, completing any requirements Google shows.
4. In **Data Access**, configure only the basic `openid`, `https://www.googleapis.com/auth/userinfo.email`, and `https://www.googleapis.com/auth/userinfo.profile` scopes. Telos does not need Gmail, Drive or offline access.
5. Open **Clients → Create client → Web application**. Name it **Telos Web**.
6. Under **Authorized JavaScript origins**, add:

```text
http://localhost:3000
```

7. Under **Authorized redirect URIs**, add exactly:

```text
https://rrrnfolbmqbhamvgnhqy.supabase.co/auth/v1/callback
```

This is the hosted Supabase callback, even while Telos runs on localhost. Do not substitute Telos's `/auth/callback` here.

8. Click **Create**. Keep the **Client ID** and **Client secret** in your own account/password manager.
9. Open Supabase **Authentication → Sign In / Providers → Google**. Enable Google, paste the Client ID and Client secret, and **Save**. Keep nonce checking enabled. Do not enable skipping email verification. No Google secret belongs in `.env.local`, `NEXT_PUBLIC_` variables, GitHub or chat.
10. Confirm the Supabase redirect URLs from step 1.7 are saved. Refresh Telos and choose **Continue with Google** on Sign in or Create account. Select a test account. New users finish their profile in Settings; existing profiles are preserved. The app checks public provider availability on click, so enabling Google needs no new environment flag or app rebuild.
11. After deployment, add the exact production origin to Google's JavaScript origins and the exact production `/auth/callback` URL to Supabase's redirect allowlist. Set Supabase Site URL and `NEXT_PUBLIC_APP_URL` to that production origin and redeploy. The Google redirect URI above stays the same while using this Supabase project.

The app uses Supabase's PKCE flow and cookie sessions for Google. Provider cancellation and missing/expired verifier state show a retry message. Telos does not use Google tokens to access Google APIs. Google sign-in is not operational until the provider credentials are saved, and must be tested with a real Google account.

Reference: [Supabase Google provider setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
