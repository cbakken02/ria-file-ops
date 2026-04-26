# Local Development

This project supports two persistence modes:

- `sqlite` for normal local development
- `supabase` for Vercel or explicit integration testing against a separate hosted Supabase dev/staging project

Use SQLite by default. Do not point local tests or exploratory local development at the production Supabase database.

## Recommended Setup

1. Install dependencies.

```bash
npm install
```

2. Create local environment variables.

```bash
cp .env.example .env.local
```

3. Keep the local default persistence backend.

```bash
PERSISTENCE_BACKEND=sqlite
NEXTAUTH_URL=http://localhost:3000
```

4. Start the app.

```bash
npm run dev
```

5. Open the local app.

```text
http://localhost:3000
```

## Local Google OAuth Testing

Google sign-in and the separate Google Drive connection flow require these local redirect URIs in the Google OAuth web client:

```text
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/storage/google/callback
```

The production redirect URIs are:

```text
https://ria-file-ops.vercel.app/api/auth/callback/google
https://ria-file-ops.vercel.app/api/storage/google/callback
```

Do not add random Vercel deployment URLs unless you are intentionally debugging a preview deployment.

## SQLite Mode

SQLite mode is the safe default for local work:

```bash
PERSISTENCE_BACKEND=sqlite
```

Local SQLite files and preview caches are written under `data/` by default and are gitignored.

Optional local overrides:

```bash
RIA_FIRM_DOCUMENT_DB_PATH=/absolute/path/to/firm-documents.sqlite
RIA_FIRM_DOCUMENT_DB_DIR=/absolute/path/to/firm-document-dbs
RIA_PREVIEW_ANALYSIS_CACHE_DIR=/absolute/path/to/preview-analysis-cache
```

Use `RIA_PREVIEW_ANALYSIS_CACHE_DIR` if local cache files are slow to read, offloaded by macOS/iCloud, or if a test needs an isolated cache directory.

## Supabase Mode

Use Supabase mode only for Vercel or targeted integration testing:

```bash
PERSISTENCE_BACKEND=supabase
SUPABASE_DB_URL_POOLER=postgresql://...
SUPABASE_DB_URL=postgresql://...
APP_ENCRYPTION_KEY=...
```

For local Supabase integration testing, use a separate hosted dev/staging Supabase project. Do not use the production Supabase database for local tests because local actions can write app state, storage connection records, encrypted tokens, preview cache rows, document projections, filing events, and review decisions.

The app currently uses direct server-side Postgres access through `pg`. It does not use Supabase Auth in the browser.

## Test Commands

Run these before committing most changes:

```bash
npm run build
npm run lint
npm run eval:data-intelligence-conversations
node --experimental-strip-types --loader ./tests/ts-alias-loader.mjs --test tests/data-intelligence-config.test.mjs tests/data-intelligence-source-ui.test.mjs tests/query-assistant.test.mjs
```

For persistence/query work, also run focused tests:

```bash
node --experimental-strip-types --loader ./tests/ts-alias-loader.mjs --test tests/firm-document-sqlite-query.test.mjs
node --experimental-strip-types --loader ./tests/ts-alias-loader.mjs --test tests/canonical-persistence.test.mjs
node --experimental-strip-types --loader ./tests/ts-alias-loader.mjs --test tests/firm-document-sqlite.test.mjs
```

## Intake Refresh Rule

Page navigation should be fast and should read cached app state only.

Page loads should not:

- scan Google Drive
- list Drive folders
- download PDFs
- parse files
- refresh intake

For now, intake processing should happen only through the explicit Refresh Intake button. Future webhook or folder-monitoring work should keep the same separation between navigation and processing.

## Safe Commit Workflow

Use feature branches and Vercel previews:

```bash
git status -sb
git switch -c codex/<short-task-name>
npm run build
npm run eval:data-intelligence-conversations
git add <specific files>
git commit -m "<clear message>"
git push -u origin codex/<short-task-name>
```

Verify the Vercel preview deployment before merging to `main`.
