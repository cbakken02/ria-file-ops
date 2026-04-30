# Data Intelligence V2 Local QA

Use this path to test the V2 File Ops Copilot locally with fake mock data and no OpenAI calls.

Required local flags:

```bash
DATA_INTELLIGENCE_V2_ENABLED=true
DATA_INTELLIGENCE_V2_CHAT_API_ENABLED=true
DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED=true
DATA_INTELLIGENCE_V2_UI_ENABLED=true
DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL=true
DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED=true
```

Dev mock mode is disabled when `NODE_ENV=production`, even if the mock flag is set.
Dev mock mode uses the shared in-memory reveal store because it is local-only.
Production sensitive reveal should use `DATA_INTELLIGENCE_V2_REVEAL_STORE_BACKEND=postgres`
or the default `auto` backend with Supabase/Postgres configured. The memory
backend is not safe for Vercel/serverless or multi-instance production reveal
flows.
Production V2 chat/reveal endpoints should also use durable audit logging with
`DATA_INTELLIGENCE_V2_AUDIT_BACKEND=postgres` or the default `auto` backend with
Supabase/Postgres configured. Dev mock audit events are local/in-memory only.

Next.js loads local `.env*` files for the app runtime. Standalone V2 scripts can
opt into safe local-env loading with `--load-local-env`; they report only
booleans and missing variable names, never values. Dev mock mode still calls no
OpenAI. OpenAI fake-data eval mode uses fake data only and requires explicit
eval/network/OpenAI gates.

For deployment readiness checks, see
`docs/data-intelligence-v2/deployment-readiness.md`.

## Manual Check

1. Start the dev server.
2. Open `/data-intelligence`.
3. Ask: `Advisor task: For Alex Demo, get the latest Schwab statement and full account number for new account paperwork.`
4. Verify the V2 response renders source-backed facts, missing or verification items, recommended steps, draft-note content, and secure reveal-card metadata.
5. Verify a secure reveal card appears with a masked account value like `****2222`.
6. Click reveal.
7. Verify the sensitive value appears inside the reveal card only.
8. Send a follow-up: `Draft a note to the advisor.`
9. Verify the revealed value is not included in the follow-up request or assistant note.
10. Hide the revealed value.

## Negative Checks

- V2 UI calls `/api/data-intelligence/v2/chat`, not `/api/query-assistant`.
- Secure reveal cards call `/api/data-intelligence/v2/reveal`.
- Dev mock mode does not call OpenAI.
- Dev mock mode does not use real database records.
- Revealed values are not stored in localStorage or sessionStorage.
- Revealed values are not copied into chat history, conversation state, URL params, logs, analytics, or chat API payloads.
- Copy-to-clipboard is intentionally not implemented for revealed values.

## Real OpenAI Dev Testing

Real OpenAI testing should remain separate from dev mock mode. Do not use real client data until firm/client permissions, durable reveal-card persistence, and rollout policy are reviewed.
