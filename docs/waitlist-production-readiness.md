# Waitlist Production Readiness

RIA File Ops uses a server-side waitlist flow for `/join-waitlist`. Public users submit the form through a Next.js server action; they do not get a client-side database key or a public read path for waitlist submissions.

## Production Setup

1. Apply the Supabase migration:

   ```bash
   supabase db push
   ```

   The waitlist table migration is:

   ```text
   supabase/migrations/20260516025839_create_waitlist_signups.sql
   ```

2. Configure the existing production persistence environment to use Supabase Postgres:

   ```text
   PERSISTENCE_BACKEND=supabase
   SUPABASE_DB_URL_POOLER=postgresql://...
   ```

3. Configure admin access with a comma-separated allowlist:

   ```text
   WAITLIST_ADMIN_EMAILS=admin@example.com
   ```

   `WAITLIST_ADMIN_EMAILS` is preferred for the waitlist admin page. `ADMIN_EMAILS` remains available as the shared fallback if `WAITLIST_ADMIN_EMAILS` is not set.

## Access Model

- Public users can submit waitlist entries from `/join-waitlist`.
- Public users cannot read waitlist submissions through the app.
- Waitlist submissions are viewed internally at `/admin/waitlist`.
- `/admin/waitlist` and `/admin/waitlist/export` require an authenticated user whose email is in `WAITLIST_ADMIN_EMAILS` or the `ADMIN_EMAILS` fallback.
- The migration enables row level security on `public.waitlist_signups`. The app runtime writes and reads waitlist data server-side through the configured persistence layer.
