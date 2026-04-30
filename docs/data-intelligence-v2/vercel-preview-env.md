# Vercel Preview Env Readiness For Data Intelligence V2

This guide covers Vercel Preview environment readiness for the V2 Data
Intelligence copilot. It does not authorize a deployment, does not modify
Production environment variables, and does not replace the V1 fallback.

## Current State

- Supabase preview migrations are applied and matched through `20260430`.
- V2 remains feature-flagged.
- V1 fallback remains intact.
- A Vercel Preview deployment has completed for branch
  `codex/fix-supabase-migration-history`.
- Production Vercel env vars must not be modified as part of Preview setup.
- The missing V2-specific Vercel Preview env names were configured in a
  controlled Preview-only run. The CLI required the additions to be scoped to
  the current Preview branch.
- Production and Development env vars were not modified.
- No Production deployment happened.

## Required V2 Preview Names

Feature flags:

- `DATA_INTELLIGENCE_V2_ENABLED`
- `DATA_INTELLIGENCE_V2_CHAT_API_ENABLED`
- `DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED`
- `DATA_INTELLIGENCE_V2_UI_ENABLED`
- `DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL`
- `DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED`

Durable storage:

- `DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND`
- `DATA_INTELLIGENCE_V2_AUDIT_BACKEND`
- `DATA_INTELLIGENCE_V2_REVEAL_EXPIRES_MS`

OpenAI adapter:

- `DATA_INTELLIGENCE_V2_OPENAI_ENABLED`
- `DATA_INTELLIGENCE_V2_MODEL` or `DATA_INTELLIGENCE_MODEL`
- `DATA_INTELLIGENCE_V2_OPENAI_API_KEY` or `OPENAI_API_KEY`
- `DATA_INTELLIGENCE_V2_OPENAI_TIMEOUT_MS`
- `DATA_INTELLIGENCE_V2_OPENAI_MAX_OUTPUT_TOKENS` is optional.

Preview-only backend QA endpoint:

- `DATA_INTELLIGENCE_V2_PREVIEW_QA_ENABLED`
- `DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET`

Core app names that must already be present for Preview:

- `PERSISTENCE_BACKEND`
- `SUPABASE_DB_URL_POOLER` or `SUPABASE_DB_URL`
- `APP_ENCRYPTION_KEY`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Optional parser/extraction names:

- `OPENAI_API_KEY`
- `AI_PRIMARY_PARSER_MODEL`
- `AI_PRIMARY_PARSER`
- `AI_PRIMARY_PARSER_TIMEOUT_MS`

## Conceptual Preview Values

The V2 Preview planner uses fixed non-secret values for V2 flags/settings:

- enable the global, chat API, reveal API, UI, and sensitive reveal flags
- keep dev mock disabled
- use Postgres-backed reveal and audit stores
- use a short reveal-card expiry window
- enable the V2 OpenAI adapter
- set a dedicated V2 model name
- set an OpenAI adapter timeout

Do not put secrets in documentation, command history, or source files.

## Read-Only Plan

Run:

```bash
node scripts/configure-vercel-v2-preview-env.mjs --json --with-vercel-cli
```

The script reports Preview env names as present or missing without printing
values. It also reports core app/database/auth names separately because those
must be verified independently.

## Applying V2 Preview Names

Only apply V2-specific Preview names after explicit approval:

```bash
CONFIRM_VERCEL_TARGET_IS_PREVIEW=true \
CONFIRM_DATA_INTELLIGENCE_V2_VERCEL_PREVIEW_ENV_APPLY=true \
node scripts/configure-vercel-v2-preview-env.mjs --apply-preview --with-vercel-cli --json
```

The apply path:

- targets Preview only
- does not modify Production or Development
- does not deploy
- adds missing V2-specific names only
- does not overwrite existing env vars
- does not remove env vars
- does not set core app/database/auth secrets
- does not print values

The Preview QA endpoint names are optional and should be added only for
automated Preview smoke testing. They must not be added to Production. The QA
secret value must come from a safe local secret source or the Vercel dashboard;
do not invent or print it in source-controlled files.

## OpenAI Key Handling

If Preview already has `DATA_INTELLIGENCE_V2_OPENAI_API_KEY` or
`OPENAI_API_KEY`, do not add another key.

If Preview is missing the OpenAI key group and a local key is available, adding
`DATA_INTELLIGENCE_V2_OPENAI_API_KEY` from local env requires an additional
confirmation:

```bash
ALLOW_SET_OPENAI_KEY_FROM_LOCAL_FOR_VERCEL_PREVIEW=true
```

The value must be passed through a safe non-echo path and must never be printed.

## Core Secrets

Do not set these in this task:

- database connection names
- auth secrets
- OAuth secrets
- encryption keys

If any core names are missing, configure them through a separate approved
Vercel Preview env task or the Vercel dashboard, then rerun the read-only plan.

## Rollback

V1 remains available. For Preview rollback:

- disable `DATA_INTELLIGENCE_V2_UI_ENABLED`
- disable `DATA_INTELLIGENCE_V2_CHAT_API_ENABLED`
- disable `DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED` if reveal has an issue
- disable `DATA_INTELLIGENCE_V2_ENABLED` for a full V2 stop

## Next Step

After Preview env readiness is clean, perform manual browser QA on the Preview
deployment. Re-run the read-only planner before any future deployment to confirm
the V2 Preview env names remain present by name.
