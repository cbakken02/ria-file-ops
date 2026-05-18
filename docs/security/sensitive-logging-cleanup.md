# Sensitive Logging Cleanup

Date: 2026-05-18

## Scope

Searched the codebase for sensitive debug logging around passwords, tokens, access tokens, refresh tokens, sessions, cookies, authorization headers, bearer tokens, JWTs, secrets, service role keys, Supabase usage, users, emails, and `console.log` / `console.error` / `console.warn` / `console.info` call sites.

No secret values were printed during the audit.

## Changed files

| File | Change | Risk reduced |
| --- | --- | --- |
| `lib/safe-logging.ts` | Added shared helpers for log-safe error metadata, sensitive text redaction, message length caps, and stable hashed identifiers. | Reduces repeated ad hoc error logging and lowers the chance that tokens, emails, JWTs, DB URLs, service keys, cookies, sessions, passwords, or long bearer-like values are emitted. |
| `app/api/query-assistant/route.ts` | Replaced raw hybrid AI debug payload logging with metadata-only shape/count logging. Sanitized request failure errors. | Prevents dev logs from dumping user questions, retrieval details, source snippets, client data, or internal AI debug payloads. |
| `lib/file-approval.ts` | Removed raw `fileId`, `sourceName`, and raw error message fields from approval failure logs. Logs error type, hashed file id, and presence flags only. | Prevents logs from exposing Drive file IDs, client document filenames, and sensitive file operation error text. |
| `lib/processing-preview.ts` | Replaced raw `Error` object logging during canonical document writes with sanitized error metadata plus document type/backend. | Prevents stack traces or driver errors from carrying document metadata, paths, or sensitive values into logs. |
| `lib/db.ts` | Sanitized Supabase app-state read fallback warning metadata. | Reduces risk of DB/client errors leaking emails, tokens, DB URLs, or session-like values. |
| `lib/storage-connections.ts` | Sanitized storage connection persistence warnings. | Reduces risk of token refresh or storage persistence errors leaking OAuth/session details. |
| `lib/preview-snapshot.ts` | Sanitized preview snapshot read warnings. | Reduces risk of database/read errors leaking owner or document context. |
| `app/dashboard/page.tsx` | Sanitized optional dashboard data-read warnings. | Reduces risk of server component logs leaking owner, dashboard, or DB context. |
| `scripts/qa-data-intelligence-v2-preview.mjs` | Strips URL credentials, query strings, and fragments before storing or printing preview QA target URLs in human and JSON output. | Prevents preview bypass tokens or other query credentials from being printed in terminal logs. |

## Remaining concerns

| Area | Concern | Recommended follow-up |
| --- | --- | --- |
| `scripts/inspect-firm-document-sqlite.mjs` | This is an intentional local inspection tool that prints database query results and JSON. It can expose sensitive client/document data if run on real data in shared terminals or CI. | Add a required `--allow-sensitive-output` flag, a local-only guard, or move it behind a clearer operator warning before broader team use. |
| CLI audit/deployment scripts | Several scripts still print JSON summaries. Reviewed console call sites are metadata-oriented, but JSON output can become risky if future fields include env values or raw external command output. | Keep secret-redaction helpers close to all JSON summary paths and avoid running these scripts with production credentials in CI unless logs are private. |
| V2 audit persistence | V2 audit records intentionally store user/owner identifiers and event metadata. This is not console logging, but it remains sensitive operational data. | Protect audit tables with strict RLS, retention limits, and admin-only access. |
| User-facing file errors | Some file approval flows still return operation error messages to the authenticated browser. This was not debug logging, but those messages may contain provider details. | Consider sanitizing browser-visible provider errors separately while keeping actionable UX notices. |

## Verification

- `rg` search for `console.log`, `console.error`, `console.warn`, and `console.info` was rerun after cleanup.
- A metadata-only scan checked remaining `console.*` call sites for sensitive auth/token/session terms without printing matched source values.
- `node --experimental-strip-types --loader ./tests/ts-alias-loader.mjs --test tests/data-intelligence-v2/preview-qa.test.mjs` passed.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with 9 pre-existing warnings and no errors.
