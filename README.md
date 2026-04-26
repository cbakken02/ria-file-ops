# RIA File Ops

RIA File Ops is a private staging application for advisory-firm document intake,
preview, cleanup, and Data Intelligence experiments.

## Current Architecture

- Next.js App Router application deployed on Vercel
- GitHub-backed source control and deployments
- NextAuth Google sign-in
- Separate Google Drive connection flow for storage access
- SQLite persistence for normal local development
- Supabase Postgres persistence for Vercel/staging/production
- Server-only Supabase/Postgres access through `pg`
- Optional OpenAI-backed parser and Data Intelligence paths

The app does not currently use Supabase Auth in the browser.

## Local Development

Use SQLite for normal local development. Do not use the production Supabase
database for local tests.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

Common validation commands:

```bash
npm run build
npm run lint
npm run eval:data-intelligence-conversations
```

For the full local workflow, persistence modes, and safety notes, see
[LOCAL_DEV.md](./LOCAL_DEV.md).

## Environment Variables

Start from [.env.example](./.env.example). It groups variables by:

- app/auth
- Google OAuth / Drive
- persistence backend
- SQLite
- Supabase Postgres
- encryption
- OpenAI / AI parser
- Vercel/deployment

Production `NEXTAUTH_URL` should be the canonical domain:

```text
https://ria-file-ops.vercel.app
```

## Google OAuth Redirect URIs

Local development:

```text
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/storage/google/callback
```

Production:

```text
https://ria-file-ops.vercel.app/api/auth/callback/google
https://ria-file-ops.vercel.app/api/storage/google/callback
```

## Persistence Modes

Normal local development:

```bash
PERSISTENCE_BACKEND=sqlite
```

Supabase-backed staging or integration testing:

```bash
PERSISTENCE_BACKEND=supabase
SUPABASE_DB_URL_POOLER=postgresql://...
APP_ENCRYPTION_KEY=...
```

Use a separate hosted Supabase dev/staging project for local Supabase testing.
Do not point local testing at production Supabase.

## Intake Processing Rule

Page navigation should read cached state only. It should not scan Drive,
download PDFs, parse files, or refresh intake.

For now, intake processing is intentionally explicit through the Refresh Intake
button. Future folder monitoring or webhook work should preserve that separation.

## AI Parser Local Testing

AI parser local testing notes will be documented separately.

The Vercel-safe PDF path supports JavaScript-based text extraction and a clear
metadata-only fallback. Local macOS development may also use Python/PDFKit/Vision
helpers for richer extraction, but those native helpers are not assumed to be
available in Vercel serverless runtime.
