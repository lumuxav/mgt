# MGT owner authentication and approved app icon

The supplied artwork (orange growth bars, rising arrow, MGT lettering on dark square) is the sole approved source for the next icon release. Retain its original proportions; do not substitute the existing blue/teal lettermark. Update all PWA PNGs, favicon, app icon, Android Capacitor asset inputs, desktop packaging icons and offline branding from that exact image.

## Verified signup issue

Supabase Auth logs on 18 October 2026 show successful signup and login requests but multiple HTTP 429 `over_email_send_rate_limit` responses. A confirmation link opened Vercel's login, indicating a wrong URL configuration or email-template link. Existing authentication security and business-access logic is preserved.

## External Supabase configuration required

For **only** MGT Supabase project `mehuiivevjqmwvaapbgz`:
1. Authentication → URL Configuration: Site URL `https://mgt-lake.vercel.app`.
2. Allow exact redirect URLs `https://mgt-lake.vercel.app/login` and `https://mgt-lake.vercel.app/reset-password`.
3. Authentication → Email Templates → Confirm signup: use the correct `{{ .ConfirmationURL }}` token and remove direct Vercel login destinations.
4. Configure a verified custom SMTP sender for production volumes (and DNS and provider verification). Do not disable email verification or weaken rate limits.
5. Test one new account end-to-end through the email link and existing business bootstrap. Avoid retrying registration repeatedly while email limits are in effect.

The app code cannot alter dashboard URLs, email templates or SMTP quotas. No database schema or permissions changes are involved. Publish new signed packages only after source asset and CI verification.
