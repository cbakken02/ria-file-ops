# Data Intelligence V2 Deployment Readiness

V2 is feature-flagged and has been rolled out to Production with V1 rollback
intact. The normal V1 route and V1 chatbot files remain in the repository and
must not be removed until the V2 rollout is stable and rollback has been tested.

For the next controlled remote-readiness and preview rollout sequence, see
`docs/data-intelligence-v2/preview-deployment-plan.md`.
For the migration-history mismatch investigation, see
`docs/data-intelligence-v2/supabase-migration-reconciliation-plan.md`.
For Preview env planning, see
`docs/data-intelligence-v2/vercel-preview-env.md`.
For automated Preview backend smoke checks, see
`docs/data-intelligence-v2/preview-qa.md`.
For the Production rollout record, see
`docs/data-intelligence-v2/production-rollout.md`.

## Production Rollout Status

Production V2 rollout completed on April 30, 2026.

- Production deployment completed for `https://ria-file-ops.vercel.app`.
- V2 Production env names are present by name.
- Supabase migration history is matched through `20260430`.
- V2 reveal-card and audit-event migrations are applied.
- Unauthenticated Production smoke checks passed.
- `/data-intelligence` redirects unauthenticated users to `/login`.
- Google OAuth provider is present and the callback path is
  `/api/auth/callback/google`.
- Manual authenticated browser QA is still required with a safe signed-in
  session.
- No GitHub push or pull request was performed as part of the rollout.

## Required Before Preview

- Local Supabase migration readiness is clean.
- V2 reveal-card and audit-event migrations are applied in the controlled
  preview Supabase environment.
- Vercel Preview V2 environment variable names are configured for the current
  preview branch.
- A Vercel Preview deployment completed for the current preview branch.
- Vercel Deployment Protection automation bypass is configured for automated
  Preview QA, and the Preview-only backend QA endpoint has passed with fake
  data only.
- V2 mock eval passes.
- OpenAI fake-data eval passes.
- V2 smoke script passes.
- Manual browser QA passes against a preview deployment.
- V2 rollback flags are understood before enabling any preview traffic.

## Readiness Scripts

These scripts are read-only by default. They do not deploy, push, apply
migrations, repair migration history, or call OpenAI.

```bash
node scripts/check-supabase-migration-readiness.mjs
node scripts/check-supabase-migration-readiness.mjs --json
node scripts/preflight-data-intelligence-v2-deployment.mjs
node scripts/preflight-data-intelligence-v2-deployment.mjs --json
```

Optional read-only CLI checks:

```bash
node scripts/check-supabase-migration-readiness.mjs --with-supabase-cli
node scripts/preflight-data-intelligence-v2-deployment.mjs --with-supabase-cli
node scripts/preflight-data-intelligence-v2-deployment.mjs --with-vercel-cli
```

Local-only eval/smoke checks can be requested explicitly:

```bash
node scripts/preflight-data-intelligence-v2-deployment.mjs --run-local-checks
```

## Production Flags

V2 remains off unless explicitly enabled:

```bash
DATA_INTELLIGENCE_V2_ENABLED=true
DATA_INTELLIGENCE_V2_CHAT_API_ENABLED=true
DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED=true
DATA_INTELLIGENCE_V2_UI_ENABLED=true
DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL=true
```

Production must not enable dev mock mode:

```bash
DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED=false
```

Production reveal and audit persistence should use durable Postgres-backed
storage:

```bash
DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND=postgres
DATA_INTELLIGENCE_V2_AUDIT_BACKEND=postgres
```

The default `auto` backend is acceptable only when Supabase/Postgres persistence
is configured and verified for the deployment target.

## Migration Apply Plan

Preview Supabase migrations were applied in a controlled run on
April 29, 2026 after the linked project was confirmed outside this shell as
preview/staging/dev/non-production.
A Vercel Preview deployment has completed for this V2 preview sequence. No
Production deployment happened.

Applied preview migration versions:

- `20260427`
- `20260428`
- `20260429`
- `20260430`

Read-only verification matched local and remote migration history through
`20260430` in the safe verification path. The V2 reveal-card and audit-event
migrations are applied to preview.

Remaining preview readiness steps:

1. Re-verify Vercel Preview env names and V2 flags.
   Use `node scripts/configure-vercel-v2-preview-env.mjs --json --with-vercel-cli`
   for a read-only name check.
2. Run manual browser QA against the Preview deployment with a test account.
3. Verify table presence and RLS state with safe read-only checks if an
   established schema-only verifier is available.
4. Re-run the V2 smoke script after any follow-up changes.

Do not run destructive database commands as part of routine readiness checks.
Do not repair migration history without a separate, explicit plan.

## Rollback

V1 remains available as the fallback path. To roll back the V2 UI without code
changes, disable one of:

```bash
DATA_INTELLIGENCE_V2_UI_ENABLED=false
DATA_INTELLIGENCE_V2_CHAT_API_ENABLED=false
DATA_INTELLIGENCE_V2_ENABLED=false
```

Disabling the V2 UI flag should return `/data-intelligence` to the V1 chat
experience while leaving the V2 code present but unused.

## Suggested Validation

```bash
node scripts/check-supabase-migration-readiness.mjs --json
node scripts/preflight-data-intelligence-v2-deployment.mjs --json
node scripts/evaluate-data-intelligence-v2.mjs --json
node scripts/smoke-data-intelligence-v2.mjs
```

For OpenAI fake-data evals, use fake data only and explicit eval/network gates.
Do not paste real client data into eval cases or logs.
