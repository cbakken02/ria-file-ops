# Security Roadmap

Date: 2026-05-18

This roadmap consolidates the security audits in `docs/security/` for the current app: a Next.js/Vercel application using NextAuth, Google Drive OAuth, direct Supabase/Postgres persistence, local SQLite development storage, document parsing, and AI-assisted RIA/client document workflows.

For the complete consolidated list of known risks, see [docs/security/risk-register.md](risk-register.md).

## Current Risk Summary

What is currently safe:

- No confirmed real secret values or `.env` files were found tracked in the current tree or git history.
- `.env.local`, `.vercel/`, `supabase/.temp/`, and `data/` are ignored.
- No runtime Supabase service-role client, browser Supabase client, `@supabase/supabase-js`, or `NEXT_PUBLIC_*` secret usage was found.
- Supabase/Postgres persistence encrypts stored Google access and refresh tokens when `APP_ENCRYPTION_KEY` is configured.
- Most protected pages, API routes, and Server Actions already use `auth()` or `requireSession()` directly or through a shared helper.
- Basic in-memory rate limiting now protects NextAuth sign-in/callback and Google Drive OAuth start/callback routes.
- Browser-visible NextAuth session output no longer includes provider access/refresh tokens or Drive token-derived fields.
- The legacy Drive connect component now routes to the server-side storage OAuth flow instead of `next-auth/react` Drive-scope sign-in.
- Sensitive debug logging has been reduced in reviewed paths, with shared safe-logging helpers now available.
- Data Intelligence V2 is safer than the legacy AI path: it uses model-bound safety checks, `store: false`, and reveal cards for raw sensitive values.
- Current dependency posture no longer has the direct high-severity Next.js audit findings after the patch to `next@16.2.6`; remaining npm audit findings are moderate.

What is unsafe:

- Any Google account can sign in unless Google OAuth app settings or app code restrict access.
- Supabase RLS is not currently a verified production authorization boundary because the app uses direct Postgres credentials and migrations define RLS without policies.
- Raw Drive file IDs and temporary snapshot IDs are accepted in sensitive routes without enough app-level ownership/resource checks.
- Arbitrary Drive/snapshot content can be served inline from the app origin, which is dangerous for untrusted HTML/SVG/scriptable files.
- Production-like runtimes now fail closed if `PERSISTENCE_BACKEND` is missing, set to `sqlite`, or missing Supabase/Postgres URL/encryption config. Persistent `data/*.sqlite` storage remains local-dev/test only.
- The document pipeline lacks central MIME/magic-byte validation, byte limits, parser sandboxing, and malware/quarantine controls.
- AI and diagnostics paths can expose or persist extracted text, PDF fields, raw summaries, file IDs, client data, and sensitive facts.
- Preview deployments and V2 feature flags rely heavily on manual Vercel configuration.

What blocks production readiness:

- Verified owner/org/client authorization for every file, queue, table, and AI/reveal action.
- Supabase grants/RLS/least-privileged DB role decisions and tests.
- Vercel/Supabase production env verification for fail-closed persistence.
- Safe file preview/download architecture for untrusted documents.
- Data minimization for AI prompts, caches, diagnostics, logs, and generated artifacts.
- Vercel/Google/GitHub manual controls for preview access, secrets, OAuth restrictions, and CI scanning.

## Critical Fixes

Immediate business-threatening issues for real client data or public demos:

| Priority | Fix | Why it matters | Type |
| --- | --- | --- | --- |
| Critical | Verify Supabase Data API exposure and revoke public access until RLS policies and grants are tested. | If `anon` or `authenticated` can access public tables/views without policies, users can bypass app owner checks. | Supabase |
| Critical | Stop serving arbitrary Drive/snapshot bytes inline from the app origin. | A scriptable Drive file rendered same-origin could call authenticated APIs as the signed-in user. | Code, Vercel |
| Mitigated / monitor | Keep OAuth access tokens out of the browser-visible NextAuth session and keep the legacy Drive `signIn()` path disabled. | A Drive-scoped token in the browser can expose the user's Drive access; code now keeps the public session token-free and routes Drive authorization through server-side storage OAuth. | Code done, Google Cloud rotation only if prior exposure is suspected |
| Mitigated / monitor | Keep production fail-closed persistence checks in release verification. | Accidental SQLite in production would mean plaintext OAuth tokens and non-multi-user local state; code now blocks this when production-like env markers are present. | Code done, Vercel env verification |
| Critical | Add a production admission gate for allowed users/firms/domains/account status. | Public Google sign-in is not acceptable for sensitive RIA/client documents. | Code, Google Cloud |

## High Priority Fixes

Needed before real client usage:

| Priority | Fix | Why it matters | Type |
| --- | --- | --- | --- |
| High | Implement the final owner/org/client authorization model and test it across routes, server actions, and DB queries. | Current owner-email scoping is a private-MVP shortcut. | Code, Supabase |
| High | Use a least-privileged app Postgres role without `BYPASSRLS` or table-owner privileges. | RLS cannot protect data if the app role bypasses it. | Supabase, Vercel |
| High | Convert public views to `security_invoker` or revoke client-readable access. | Default views can bypass table RLS. | Supabase |
| High | Restrict `/api/drive/files/[fileId]` to files proven to belong to the user's configured folders, current queue, cleanup state, or history. | Raw Drive file ID access is the main IDOR vector. | Code |
| High | Bind preview snapshots and cached queues to owner, active storage connection, and source/destination folders. | Leaked/stale IDs and connection switches can expose wrong documents. | Code |
| High | Add central file policy: allowed MIME/extensions, magic-byte checks, dangerous extension blocking, and byte limits before download. | Prevents hostile or oversized documents from being parsed, cached, or previewed. | Code, Vercel |
| High | Convert destructive file-moving GET routes to POST with CSRF/confirmation. | GET-based mutations can be triggered accidentally or by cross-site navigation. | Code |
| High | Hide diagnostics and raw extraction artifacts behind a production-off admin/debug flag. | Browser-visible diagnostics expose sensitive document/client details. | Code, Vercel |
| High | Keep `AI_PRIMARY_PARSER`, legacy `DATA_INTELLIGENCE_AI_ENABLED`, and V2 sensitive reveal off for real data until redaction and durable authorization are complete. | Current AI paths can send or return client-sensitive data too broadly. | Vercel, Code |
| High | Move auth and OAuth rate limits to Vercel Firewall or a shared store. | Current in-memory limits are per-instance and not production durable. | Vercel, Code |
| High | Require Deployment Protection and branch-scoped env vars for previews with real or production-like resources. | Public previews can otherwise expose sensitive workflows and feature flags. | Vercel |

## Medium Priority Fixes

Operational hardening:

| Priority | Fix | Why it matters | Type |
| --- | --- | --- | --- |
| Medium | Normalize Drive status checks across Intake, Clean Up, Dashboard, History, and Setup. | Users need to distinguish cached state from live Drive health. | Code, Tests |
| Medium | Add visible Intake refresh/error state and manual refresh. | Prevents stale queue confusion after token expiry or reconnect. | Code |
| Medium | Decide and enforce session max age, update age, and one-hour inactivity behavior if required. | No explicit inactivity policy is currently implemented. | Code, Product |
| Medium | Add Google token revocation on disconnect. | Deleting local records does not revoke provider grants. | Code, Google Cloud |
| Medium | Add parser limits: timeouts, max pages, max extracted text, max field count/value length, and constrained subprocess env. | Malformed PDFs/images can cause CPU, memory, timeout, or secret-env exposure issues. | Code, Infra |
| Medium | Add malware/quarantine handling before preview/download/move for untrusted client-supplied files. | The app handles sensitive and potentially hostile documents. | Code, Infra |
| Medium | Define retention for preview snapshots, analysis cache, audit events, reveal cards, extracted metadata, temp files, and exports. | Sensitive data should not live longer than workflow value requires. | Code, Supabase, Policy |
| Medium | Replace raw user-facing `Error.message` responses in cleanup/parser routes with generic errors and safe server logs. | Third-party/parser errors may include file names, IDs, or internals. | Code |
| Medium | Add local-only guards to database inspection and eval scripts that can print sensitive data. | Useful dev tools should not leak client data in shared terminals or CI logs. | Code, GitHub |
| Medium | Add secret scanning and dependency scanning to CI. | Git history was clean, but future leaks/dependency regressions need automated checks. | GitHub |
| Medium | Monitor remaining moderate npm audit findings around `postcss` via Next/NextAuth and patch when the framework path is safe. | `npm audit fix --force` suggests an unsafe major downgrade path; do not use it blindly. | Dependency management |

## Low Priority Improvements

Future enhancements:

- Add route inventory checks that fail on new `/debug`, `/test`, `/seed`, `/admin`, `/bypass`, or QA endpoints without documented guards.
- Remove `SUPABASE_SERVICE_ROLE_KEY` from `.env.example` unless a real server-only runtime need is introduced.
- Add SBOM generation and license review for native packages and optional binary packages.
- Add Dependabot or Renovate grouping for framework, auth, database, parser, and dev-tooling updates.
- Add support-process guidance: never paste raw client documents, extracted text, OAuth responses, logs, or `.env` contents into tickets, chats, or AI tools.
- Add a periodic review cadence for Vercel preview envs, Google OAuth clients, Supabase grants, and GitHub secrets.

## Data Privacy Risks

- Preview analysis cache can persist `DocumentInsight` fields including extracted text, PDF fields, AI debug data, file IDs, client names, and metadata.
- Preview snapshots intentionally drop full diagnostic text, but still include excerpts, PDF fields, hashes, file IDs, and classification output.
- Intake and Clean Up diagnostics expose raw extracted content in browser memory and screenshots.
- Filing history persists classifier excerpts and sensitive metadata such as detected clients, account last4, tax year, document dates, and source paths.
- Temporary raw snapshots live in `os.tmpdir()` for up to 24 hours and are not owner-bound today.
- The Supabase projection path still uses a request-scoped temp `projection.sqlite` bridge under `os.tmpdir()` that can contain sensitive canonical document/client/account data before it is copied to Postgres. It is deleted in `finally`, but should be permission-hardened, monitored for cleanup failure, and eventually replaced with direct Postgres projection if needed.
- Follow-up: resolve the legacy canonical cache contract. `tests/canonical-persistence.test.mjs` expects `analysisProfile="legacy"` to produce no canonical payload, but current tax-document analysis returns canonical tax documents before cache persistence. Decide whether legacy mode should suppress canonical persistence or the test/docs should reflect the current tax canonical behavior.
- Supabase logs, Vercel logs, and local scripts should be treated as sensitive even when app logs are metadata-only.

Minimum production stance:

1. Store only structured fields required for workflow value.
2. Encrypt or omit raw sensitive values.
3. Hide diagnostics by default.
4. Add retention/deletion for all caches and artifacts.
5. Use audited reveal flows for raw sensitive values instead of normal API responses.

## Auth Risks

- Public NextAuth session output and types no longer include provider access/refresh tokens or Drive token-derived fields.
- Any Google account can sign in unless admission is restricted.
- Rate limiting is in-memory and per runtime instance.
- There is no explicit disabled/suspended account gate.
- There is no explicit inactivity/session-expiration policy beyond default NextAuth behavior.
- `proxy.ts` canonicalizes hosts only; it is not an auth guard.

Auth direction:

1. Keep login identity separate from Drive storage authorization.
2. Keep tokens server-only.
3. Add app-user/firm membership/admission checks.
4. Add a route inventory test so every new route is explicitly public or protected.

## Authorization Risks

- The practical authorization model is `session.user.email` mapped to `ownerEmail`.
- This is acceptable only for a private MVP with trusted users.
- Drive routes accept raw IDs and rely too much on Google Drive token access rather than app resource ownership.
- Cleanup and intake mutations sometimes rely on lower-level shared helpers instead of obvious route-local checks.
- Temporary preview snapshots lack owner binding.
- Data Intelligence V2 reveal authorization is coarse and owner-email scoped.

Required model:

1. Owner now: all reads/writes must derive owner from the authenticated session, never the client.
2. Firm/org next: model advisors, CSAs, admins, clients, and account ownership in durable server-side tables.
3. Resource authorization: every Drive file, queue item, cleanup action, history event, and reveal card must bind to owner plus active storage connection and, where relevant, client/account.
4. Tests: use two or more owners/firms and prove cross-user access fails.

## OAuth Risks

- Google Drive storage tokens are encrypted only in Supabase/Postgres mode; SQLite stores them plaintext.
- Disconnect removes local records but does not revoke the Google grant.
- The older Drive `signIn()` component has been rewritten to use the server-side storage OAuth route; keep regression tests so it cannot reintroduce Drive-scoped NextAuth sign-in.
- Broad Drive write scope increases blast radius if route authorization is weak.
- Cached Drive state differs across Intake, Clean Up, Dashboard, and Setup.

Hardening steps:

- Keep the legacy Drive sign-in path removed and route Drive authorization through `/api/storage/google/start`.
- Revoke Google grants on disconnect where product behavior allows.
- Separate production and preview OAuth clients.
- Review whether Drive scopes can be narrowed or folder access can be constrained by product flow.
- Bind cached state to Google account identity and storage connection ID.

## AI/Data Leakage Risks

- AI Primary Parser can send up to a large extracted text window to an OpenAI-compatible endpoint when enabled.
- Legacy Data Intelligence can send user questions, history, deterministic results, and sensitive facts to an OpenAI-compatible endpoint.
- Legacy query assistant can return sensitive values directly in browser JSON.
- V2 is safer but still sends some client-confidential context to the model.
- V2 reveal endpoint intentionally returns raw sensitive values to the browser.
- Preview QA uses fake data, but real OpenAI preview QA can create cost/abuse risk if its secret leaks.

AI production rule:

1. Use V2 as the only client-specific AI path.
2. Keep OpenAI `store: false`.
3. Redact before prompts.
4. Keep raw SSNs, full account numbers, DOBs, addresses, identity numbers, OAuth tokens, Drive links, file IDs, and source paths out of prompts.
5. Use reveal cards for raw sensitive values.
6. Add regression tests around model-bound payloads, browser JSON, logs, and cache rows.

## Infrastructure Risks

- Vercel preview protection and branch-scoped envs are manual controls, not enforced by repo config.
- `PERSISTENCE_BACKEND=sqlite` persistent storage is local-dev/test only and is blocked by code in production-like runtimes.
- Some production-like safety checks outside persistence still rely on `NODE_ENV` instead of the central runtime classifier.
- Local data files are acceptable for development but not for shared previews or production. A separate temp projection SQLite bridge remains in the Supabase projection path and must stay unpredictable, short-lived, permission-limited, and cleaned up.
- Parser subprocesses and Postgres sync workers temporarily handle raw document bytes or DB rows.
- Supabase Storage is not currently used; if added later, buckets must be private with owner/org path checks.

Infrastructure direction:

- `isProductionLikeRuntime()` now uses `VERCEL_ENV`, `NODE_ENV`, explicit `APP_ENV`, and real-data preview markers.
- Fail closed for production-like runtime unless the intended Supabase/Postgres backend and encryption envs are present.
- Use `APP_ENV=real-data-preview` as the canonical real-data Preview marker. Never use `APP_ENV=local` or `APP_ENV=test` in deployed or real-data environments.
- Require Deployment Protection for previews with real data.
- Set conservative log retention and access controls.

## Dependency Risks

Current dependency state:

- Runtime dependencies are small: `next`, `next-auth`, `react`, `react-dom`, `pg`, `better-sqlite3`, `pdf-parse`, and `pdfjs-dist`.
- The dependency tree is still sizable because Next, ESLint, native parser/rendering packages, and optional platform binaries pull many transitive packages.
- The direct high-severity Next.js audit findings were addressed by updating `next` and `eslint-config-next` to `16.2.6`.
- `npm audit` still reports three moderate findings involving `postcss` through Next/NextAuth. The automated force fix path is not appropriate because it suggests a major downgrade; monitor and patch through normal framework updates.
- `next-auth@4.24.13` is close to latest patch but remains on the older v4 line; plan an Auth.js/NextAuth upgrade path after token/session shape is fixed.
- File parsing depends on `pdf-parse`, `pdfjs-dist`, and native canvas/rendering packages. These need faster patch cadence and sandboxing because they process untrusted files.
- Native/install-script packages include `better-sqlite3`, `sharp`, and `unrs-resolver`. Treat install scripts and prebuilt binaries as higher supply-chain risk.
- `better-sqlite3` is useful for local development but would be risky as a production dependency if the PROD-001 fail-closed guard regresses.

Dependency hardening:

1. Add CI `npm audit --omit=dev` and full `npm audit` review gates for high/critical findings.
2. Add Dependabot/Renovate with grouped updates for Next/React, auth, database, and parser dependencies.
3. Pin or review native packages with install scripts.
4. Keep `package-lock.json` committed and review lockfile diffs.
5. Consider `npm ci --ignore-scripts` in audit-only CI jobs, with a separate trusted install/build job for native packages.
6. Add SBOM generation before production.
7. Run parser regression tests after every `pdf-parse`, `pdfjs-dist`, `sharp`, or native dependency update.

## Manual Actions Required

Supabase:

- Verify Data API exposure for every app table and view.
- Confirm grants for `anon`, `authenticated`, app roles, admin roles, and service roles.
- Revoke client-role access to tables that should be server-only, especially token, preview cache, document fact, reveal, and audit tables.
- Create a least-privileged app DB role without `BYPASSRLS`.
- Decide whether to enforce RLS via trusted DB settings for the current NextAuth/direct-Postgres architecture or move more fully toward Supabase Auth-aware policies.
- Convert public views to `security_invoker` where supported or revoke direct access.
- Run Supabase security advisors after grants/RLS changes and save results.
- Confirm `APP_ENCRYPTION_KEY` is present anywhere Supabase token persistence is enabled.
- Remove unused `SUPABASE_SERVICE_ROLE_KEY` from environments if present.

Vercel:

- Set `PERSISTENCE_BACKEND=supabase` for production and real-data previews.
- Keep `APP_ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, Google OAuth secrets, database URLs, and AI keys server-only.
- Confirm no secret is in a `NEXT_PUBLIC_*` variable.
- Remove unused service-role keys from Vercel envs.
- Keep production `DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL=false` until authorization, RLS, audit, and privacy controls are complete.
- Keep external AI flags disabled for real client documents until redaction/tests exist.
- Enable Deployment Protection on previews that contain real data or production-like secrets.
- Branch-scope preview V2 env vars and preview QA secrets.
- Add Vercel Firewall or shared-store rate limits for auth and OAuth endpoints.
- Review log retention and access controls.
- Ensure the runtime Node version satisfies current dependency engine requirements, such as Node `^20.19.0`, `^22.13.0`, or `>=24` for current ESLint transitive tooling.

Google Cloud:

- Restrict OAuth app access to approved users/domains while the product is private.
- Use separate OAuth clients for production and preview/staging if real data is used.
- Review Drive scopes and document why full write access is required if it remains.
- Revoke Google grants for any account that used the legacy Drive `signIn()` path or plaintext SQLite in a non-local environment.
- Add a disconnect/revoke behavior decision: local disconnect only, Google revoke, or both.
- Monitor OAuth app publishing/verification status before broad use.

GitHub:

- Enable secret scanning and push protection.
- Add `gitleaks` or `trufflehog` to CI/history checks.
- Add Dependabot/Renovate for npm dependencies.
- Add CI jobs for lint, build, npm audit, route auth inventory, secret scan, and owner-isolation tests.
- Protect branches that deploy to production or real-data previews.
- Add CODEOWNERS/review requirements for auth, storage, Supabase migrations, Vercel env docs, package lockfile, and security docs.

## Key Rotation Checklist

No key rotation is required based on git history alone. Rotate when exposure is suspected or confirmed.

| Credential | Rotate when | Also do |
| --- | --- | --- |
| Supabase service role key | It was stored in Vercel unnecessarily, shared, logged, committed elsewhere, pasted into tooling, or exposed in preview output. | Remove unused env entries and audit Supabase logs/access. |
| Supabase/Postgres database URL | The current role is overprivileged, credentials were shared, or logs may contain the URL. | Create least-privileged app role and update Vercel envs. |
| Google OAuth client secret | It was committed, logged, shared, or present in an untrusted environment. | Reissue OAuth client secret and verify redirect URIs. |
| Google OAuth refresh tokens/grants | Drive-scoped tokens were exposed in browser sessions, logs, plaintext SQLite outside local dev, or shared artifacts. | Revoke affected user grants from Google and force reconnect. |
| `NEXTAUTH_SECRET` or auth signing secret | It was shared, logged, committed, or used in an untrusted preview. | Rotate and force session invalidation. |
| `APP_ENCRYPTION_KEY` | It was shared, logged, committed, reused across untrusted envs, or stored with compromised data. | Plan data re-encryption or token reconnect strategy. |
| OpenAI/API provider keys | Any logs, CI output, `.env` copy, support artifact, or local file exposed them. | Rotate provider keys and review usage logs. |
| Vercel deployment bypass and preview QA secrets | Shared broadly, used in URLs, logged, or exposed in CI. | Rotate and update branch-scoped preview envs. |

## Production Readiness Checklist

- Supabase Data API exposure reviewed and documented.
- Least-privileged app DB role created and used in production.
- RLS/grants/policies tested with at least two owners/firms.
- Public views protected by `security_invoker` or revoked access.
- Browser-visible OAuth access token removed.
- Production sign-in admission gate implemented.
- Production SQLite fallback blocked in code; Vercel/Supabase env names verified before release.
- Drive file proxy restricted to owner-scoped app resources.
- Preview snapshots owner/connection bound.
- Destructive file operations use POST/action plus confirmation.
- File type, extension, magic-byte, and byte-size limits enforced.
- Parser timeouts and resource limits implemented.
- Diagnostics hidden/redacted in production.
- External AI and V2 sensitive reveal disabled until privacy/authorization tests pass.
- AI prompt/browser/log/cache privacy regression tests added.
- Vercel Deployment Protection enabled for real-data previews.
- Distributed auth/OAuth rate limiting configured.
- Google disconnect/revoke behavior implemented.
- Secret scanning and dependency scanning enabled in CI.
- `npm audit` has no high/critical findings.
- Build, lint, route auth inventory, IDOR tests, RLS tests, and Drive authorization tests pass.
- Log retention and access controls approved for sensitive RIA/client metadata.
- Key rotation decisions documented for any exposed or overprivileged secrets.

## Recommended Security Architecture Direction

Use a staged architecture rather than trying to bolt every control onto the current private-MVP model.

1. Identity and tenancy: keep NextAuth for login if desired, but add durable app users, firms, roles, account status, and memberships in Postgres. Do not authorize from editable client/session claims alone.
2. Database boundary: use a least-privileged app DB role and either enforce RLS with trusted per-request DB settings or keep direct Postgres server-only while making Supabase Data API roles unable to access private tables. The long-term goal should be tested database-level isolation plus app-level checks.
3. Storage boundary: store Google tokens only server-side and encrypted. Every Drive action should resolve through an owner/connection/folder/file record owned by the app, not a raw client-provided Drive ID.
4. Document processing: treat every Drive file as untrusted. Validate type and size before download, quarantine unsupported files, sandbox parsers, and serve raw previews from a sandboxed or cookieless path.
5. AI boundary: make V2 the only client-specific AI path. Redact before prompts, send minimum necessary context, use reveal cards for raw sensitive values, and retain only structured outputs with clear TTLs.
6. Environment boundary: separate local, preview, staging, and production with explicit `APP_ENV` plus Vercel `VERCEL_ENV`. Fail closed in production-like runtimes when persistence, encryption, rate limiting, or feature flags are unsafe.
7. Operations: keep GitHub/Vercel/Supabase/Google controls as part of the release checklist, not tribal knowledge. Security-sensitive config changes should be reviewed and recorded.
