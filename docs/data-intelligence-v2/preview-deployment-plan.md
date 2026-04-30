# Data Intelligence V2 Preview Deployment Plan

This plan is for a controlled preview deployment sequence. No Vercel
deployment, push, pull request, or production-resource change was performed
while preparing or updating this document.

## Current State

- V2 remains feature-flagged and V1 remains the default `/data-intelligence`
  experience.
- V1 fallback is still available because the V1 route and component remain
  untouched.
- Local V2 tests, mock evals, and smoke checks are expected to pass before any
  preview deployment.
- Local migration readiness has no duplicate versions and includes the V2
  reveal-card and audit-event migrations.
- Preview Supabase migrations were applied in a controlled run on
  April 29, 2026 after the linked project was confirmed outside this shell as
  preview/staging/dev/non-production.
- Read-only migration verification matched local and remote versions through
  `20260430`; no local-only or remote-only migration versions remained in the
  safe verification path.
- The V2 reveal-card and audit-event migrations are applied to preview:
  `20260429_data_intelligence_v2_reveal_cards.sql` and
  `20260430_data_intelligence_v2_audit_events.sql`.
- Vercel Preview V2 env names were configured in a controlled Preview-only
  run for the current preview branch. Production and Development env vars were
  not modified.
- A Vercel Preview deployment completed for branch
  `codex/fix-supabase-migration-history`. The deployment target was Preview,
  not Production.
- Vercel Deployment Protection automation bypass is configured for automated
  Preview QA. The backend Preview-only QA endpoint passed with fake data only,
  and anonymous V2 chat/reveal requests remained protected by app-level auth.
  Production deployment and Production envs were not touched.
- The accidental local `20260426` duplicate guard has been removed after
  byte-identical/untracked verification. Supabase migration-history status
  should still be rechecked before preview migration apply; see
  `docs/data-intelligence-v2/supabase-migration-reconciliation-plan.md`.
- The local `20260426` content-mapping evidence is summarized in
  `docs/data-intelligence-v2/supabase-20260426-content-mapping.md`.

## Required Pre-Preview Checklist

- Work from a clean, reviewable branch and commit only the intended V2 changes.
- Run local readiness checks:

```bash
node scripts/check-supabase-migration-readiness.mjs --json
node scripts/preflight-data-intelligence-v2-deployment.mjs --json
node scripts/evaluate-data-intelligence-v2.mjs --json
node scripts/smoke-data-intelligence-v2.mjs
```

- Run read-only remote checks:

```bash
node scripts/preflight-data-intelligence-v2-deployment.mjs --json --with-supabase-cli
node scripts/preflight-data-intelligence-v2-deployment.mjs --json --with-vercel-cli
```

- Confirm Supabase migration status is aligned before applying anything.
- Verify Vercel Preview env names are configured, including V2 flags, durable
  reveal/audit backends, model configuration, auth, Google OAuth, encryption,
  and database connection names.
- Confirm the OpenAI fake-data eval passes in a local, fake-data-only run.
- Complete manual browser QA in dev mock mode.
- Confirm durable reveal and audit stores are configured for preview.
- Verify Vercel Preview env readiness with
  `docs/data-intelligence-v2/vercel-preview-env.md`.

## Supabase Preview Migration Status

Preview migration apply has been performed once for the expected pending
migrations:

- `20260427_unify_tax_document_type.sql`
- `20260428_tax_document_v2_facts.sql`
- `20260429_data_intelligence_v2_reveal_cards.sql`
- `20260430_data_intelligence_v2_audit_events.sql`

Post-apply read-only diagnostics verified matched migration history through
`20260430`, with no V2 reveal/audit migrations pending. One unsanitized direct
shell check showed a database-auth error after apply, while the safe-env
read-only migration list, migration-history diagnostic, and deployment
preflight all verified the applied state. Treat future unsanitized CLI auth
errors as a local shell-auth issue to diagnose before any new migration apply.

Do not run destructive commands such as database reset or migration repair
without a separate approved recovery plan. Do not apply these migrations to
production until preview is proven.

## Vercel Preview Deployment Plan

The first Preview deployment has completed. Remaining controlled steps:

1. Re-verify Preview env names with the read-only Vercel preflight.
   See `docs/data-intelligence-v2/vercel-preview-env.md` for the safe
   Preview-only env planner.
2. Confirm V2 preview flags are deliberately set for preview QA:

```bash
DATA_INTELLIGENCE_V2_ENABLED=true
DATA_INTELLIGENCE_V2_CHAT_API_ENABLED=true
DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED=true
DATA_INTELLIGENCE_V2_UI_ENABLED=true
DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL=true
DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND=postgres
DATA_INTELLIGENCE_V2_AUDIT_BACKEND=postgres
DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED=false
DATA_INTELLIGENCE_V2_OPENAI_ENABLED=true
```

3. Verify a dedicated V2 model env name is present through
   `DATA_INTELLIGENCE_V2_MODEL` or `DATA_INTELLIGENCE_MODEL`.
4. Open the Preview deployment with an authenticated test user and run manual
   browser QA.
5. Use the Preview-only QA endpoint only for backend deployed-runtime smoke.
   It is already configured for Preview and must remain unavailable in
   Production.
6. Review build logs and runtime logs for safe status signals only.
7. Do not enable production traffic during preview.

## Preview Smoke Test Plan

1. Visit `/data-intelligence` on the preview deployment.
2. Confirm V2 renders only when the global, chat API, and UI flags are enabled.
3. Ask a test-client-safe question appropriate for the preview data set.
4. Verify source-backed facts render separately from missing/unverified data.
5. Verify recommended steps and draft notes render without raw sensitive values.
6. Verify secure reveal cards appear for reveal-only fields.
7. Click reveal only with an authorized test account and confirm the value stays
   inside the reveal card component.
8. Confirm revealed values are not sent in follow-up chat payloads.
9. Confirm reveal-card rows are created and one-time cards are consumed.
10. Confirm audit rows are created for chat, tool, model, reveal, and safety
    events without raw prompts, raw model payloads, raw tool outputs, or raw
    reveal values.
11. For backend-only smoke, call the Preview-only QA endpoint with the QA
    secret and confirm it reports fake-data V2 chat/reveal/audit checks without
    returning raw values.
12. Disable V2 UI or chat flags and confirm `/data-intelligence` falls back to
    V1.

## Rollback Plan

- Disable `DATA_INTELLIGENCE_V2_UI_ENABLED` to return the page to V1.
- Disable `DATA_INTELLIGENCE_V2_CHAT_API_ENABLED` if the V2 chat route should
  stop accepting preview traffic.
- Disable `DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED` if the reveal path has an
  issue.
- Disable `DATA_INTELLIGENCE_V2_ENABLED` for a full V2 stop.
- Keep V1 routes and components untouched until preview is stable and rollback
  is tested.

## Production Candidate Criteria

- Preview deployment passes browser QA and smoke checks.
- Supabase migrations apply cleanly in preview and table presence is verified.
- Durable reveal-card and audit-event writes are verified.
- Mock eval and OpenAI fake-data eval pass with zero safety failures.
- Internal beta smoke testing with approved data shows no safety leaks.
- No raw sensitive values appear in logs, audit records, model payloads, chat
  payloads, or client history.
- Role/client authorization risks are accepted for preview or strengthened
  before broader rollout.
- V1 rollback is tested and documented.
