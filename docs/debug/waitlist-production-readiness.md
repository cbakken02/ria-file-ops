# Waitlist Production Readiness

## Deployment

- Production host: `https://ria-file-ops.vercel.app`
- Main commit deployed: `b5ac48f63edb7daf4bcb0644cb4dc8bcacddfde2`
- Production deployment: `dpl_FD3kmE9gc9K6svtLoiVTeuAtHx5o`
- Source PR: #44, `[codex] Restore guided demo and waitlist homepage`

## Supabase Status

- Required migration: `20260516025839_create_waitlist_signups.sql`
- Migration status: recorded in Supabase migration history.
- Required table: `public.waitlist_signups`
- Table status: exists.
- RLS status: enabled.
- Public/anon read check: anon role saw zero waitlist rows under RLS.

No waitlist row contents were printed during verification.

## Vercel Production Env Status

Required Production env names were present:

- `WAITLIST_ADMIN_EMAILS`
- `PERSISTENCE_BACKEND`
- `SUPABASE_DB_URL_POOLER`
- `SUPABASE_DB_URL`
- `APP_ENCRYPTION_KEY`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Values were not printed. `WAITLIST_ADMIN_EMAILS` is the configured admin
allowlist variable for the restored waitlist admin page.

## Production Smoke Test

Production smoke passed after deployment:

- `/` loaded the restored homepage.
- Hero rendered.
- Guided demo rendered.
- Guided demo edit/save/approve-file flow worked.
- FAQ rendered.
- `Join Waitlist` links routed to `/join-waitlist`.
- `/join-waitlist` loaded and rendered the expected form fields.
- Browser validation worked before submit.
- A clearly labeled production smoke signup was submitted with test-only data.
- Success state rendered after submit.
- `/admin/waitlist` was protected for public users and redirected to `/login`.
- Desktop and mobile viewports had no horizontal overflow.
- No obvious browser console errors or page errors were observed.

Admin view of the submitted smoke record still requires signing in as an
allowlisted admin user.

## Abuse Protection

- Public waitlist submissions now have basic server-side throttling by request
  IP and normalized email using the shared in-memory limiter.
- The form includes a visually hidden honeypot field. Legitimate users should
  not see or fill it; filled honeypot submissions receive a generic failure
  message and are not saved.
- This is private-MVP spam protection only. It is not a replacement for durable
  shared rate limiting, Vercel Firewall rules, or CAPTCHA/Cloudflare Turnstile
  if public spam appears.
- CAPTCHA/Turnstile remains intentionally deferred so the first public waitlist
  flow stays low-friction.

## Rollback Notes

If the landing or waitlist release needs rollback:

1. Use Vercel rollback to restore the previous production deployment from before
   PR #44, or roll back to a known-good production deployment in the Vercel
   dashboard.
2. Alternatively, revert merge commit
   `b5ac48f63edb7daf4bcb0644cb4dc8bcacddfde2` and let the normal `main`
   production deployment run.
3. Do not drop the `public.waitlist_signups` table as part of a UI rollback.
   Leave the additive migration in place unless a separate reviewed database
   rollback is explicitly required.
