# Security Remediation Roadmap

Date: 2026-05-18

This roadmap consolidates the current security audits in `docs/security/`. It is prioritized for this specific app: a Next.js/Vercel app using NextAuth, Google Drive OAuth, direct Postgres/Supabase persistence, and sensitive RIA/client document workflows.

No confirmed committed production secret was found in git history. The highest risk is not a known leaked key; it is that app authorization, Supabase/RLS boundaries, Drive token handling, and production environment posture are not yet strong enough for real client users or broadly shared demos.

Post-PROD-001 status: commit `6ca6753` (`fix(persistence): fail closed for production SQLite fallback`) mitigated the persistent production SQLite fallback. Keep release verification for Supabase/Postgres envs. The temporary projection SQLite bridge remains a separate follow-up in PROD-007, and the canonical current status lives in `docs/security/risk-register.md` plus `docs/security/security-roadmap.md`.

## 1. Critical fixes to do immediately

Critical here means "fix or verify before real client data, public demos, or additional users." The audits did not confirm an active critical exploit, but these items are production blockers.

| Priority | Task | Why it matters | Required change |
| --- | --- | --- | --- |
| Critical | Verify Supabase Data API exposure for all app tables and views. Revoke public access or keep exposed roles unusable until RLS policies are implemented and tested. | Migrations enable RLS but define no policies. If tables/views are exposed to Supabase `anon` or `authenticated` roles, private client data could be readable or writable outside app authorization. | Supabase dashboard/SQL. Possible code changes later for policy-compatible DB access. |
| Critical | Remove Google provider access tokens from the browser-visible NextAuth session. | `auth.ts` currently places an OAuth access token on the public session object. If any Drive-scoped NextAuth flow is used, browser code can receive a privileged token. | Code change. Rotate/revoke affected Google grants if Drive-scoped tokens were exposed in production. |
| Mitigated / monitor | Keep production SQLite fallback blocked and verify production envs before release. | SQLite stores OAuth tokens locally and is not a production multi-user boundary. Commit `6ca6753` now blocks persistent `data/*.sqlite` fallback in production-like runtimes. | Code done; verify Vercel/Supabase envs before release. Rotate Google OAuth grants only if plaintext production tokens were stored or copied. |
| Critical | Add an explicit sign-in admission gate. | Any Google account can currently sign in unless the OAuth app or app code restricts access. That is not acceptable once demos or users expand. | Code change plus optional Google OAuth app restriction. |

## 2. High-priority fixes before more demos/users

| Priority | Task | Why it matters | Required change |
| --- | --- | --- | --- |
| High | Define and implement the Supabase/RLS access model around owner, firm, org, account, or client ownership. | Current isolation is mostly app-layer `owner_email`. RLS is not an effective boundary with the current direct Postgres runtime assumptions. | Code plus Supabase SQL policies. |
| High | Use a least-privileged Postgres role for the app, without `BYPASSRLS` or table-owner privileges. | RLS cannot protect data if the runtime role bypasses it. | Supabase/database role change and Vercel database URL update. |
| High | Convert public views to `security_invoker` or revoke client-readable access to them. | Views can bypass underlying table RLS if left with default definer behavior. | Supabase migration/dashboard change. |
| High | Remove or rewrite the legacy Drive `signIn()` component path so Drive OAuth only uses the server-side storage OAuth flow. | It can reintroduce browser-visible Drive tokens through the NextAuth session. | Code change. |
| High | Restrict `/api/drive/files/[fileId]` to files known to belong to the active user's configured Drive folders or current app state. | The route can fetch any Drive file accessible to the active token, which is too broad for least-privilege file access. | Code change and route tests. |
| High | Bind preview snapshots and cached intake queues to owner/session identity. | Intake can read stale cached queue state; cached previews need explicit owner isolation. | Code change and tests. |
| High | Add route-local auth/ownership checks to sensitive mutation routes, especially cleanup and intake approval paths. | Some routes rely on lower-level helpers instead of obvious route-level guards. | Code change and tests. |
| High | Keep Data Intelligence V2 sensitive reveal disabled until durable authorization exists. | Reveal cards and audit events contain sensitive extracted client data and currently use coarse owner-email authorization. | Vercel flag plus code/RLS work before enabling. |
| High | Move auth/OAuth rate limiting from in-memory runtime state to Vercel Firewall or a shared store. | Current limits are useful but per-instance only, so they are weak under scale or cold starts. | Vercel Firewall/shared storage configuration. |
| High | Normalize Drive connection status across Intake, Clean Up, Dashboard, History, and Setup. | Intake can show cached/stale state while Clean Up live-checks Drive. Users need consistent connected/needs-reauth/error states. | Code change and tests. |
| High | Add visible Intake refresh/error handling and a manual refresh action. | The current fix refreshes on mount and failure, but users still need to distinguish cached state from failed live Drive refresh. | Code change. |
| High | Decide and enforce session lifetime/inactivity policy. | No one-hour inactivity handling or explicit session `maxAge`/`updateAge` policy was found. | Code change and product decision. |

## 3. Medium-priority improvements

| Priority | Task | Why it matters | Required change |
| --- | --- | --- | --- |
| Medium | Add protected-route and protected-API coverage tests. | Prevents auth regressions as routes are added. | Tests. |
| Medium | Add owner-isolation tests for core tables, preview snapshots, cleanup state, and Drive file access. | Directly tests the main IDOR risk. | Tests. |
| Medium | Add Google token revocation on disconnect. | Current disconnect removes local records but does not revoke the Google grant. | Code change. |
| Medium | Return safe connection status metadata from `/api/storage/connections` or a shared `/api/storage/status` route. | UI should not imply stale or `needs_reauth` connections are healthy. | Code change. |
| Medium | Add local-only guard or `--allow-sensitive-output` confirmation to database inspection scripts. | Some scripts intentionally print query results that may include client data. | Code change. |
| Medium | Keep provider-facing errors useful but sanitize user-visible and log-visible details. | Third-party errors can include identifiers or implementation details. | Code/logging change. |
| Medium | Minimize environment passed to Swift/helper subprocesses. | Full process env inheritance increases blast radius if a helper logs or crashes. | Code change. |
| Medium | Add automated secret scanning to CI and local pre-push workflow. | Git history looked clean, but automated scanning reduces future leak risk. | GitHub/CI configuration. |
| Medium | Define retention for preview snapshots, reveal-card audit events, extracted metadata, and temporary artifacts. | Sensitive extracted client data should not live longer than needed. | Code, database, and operational policy. |

## 4. Manual actions required in Supabase

1. Confirm whether the Supabase Data API is enabled for the schemas containing app tables and views.
2. Confirm grants for `anon`, `authenticated`, and any service/admin roles on all app tables and views.
3. Revoke `anon`/`authenticated` access to tables that are not intentionally client-readable.
4. Create a least-privileged app database role that cannot bypass RLS.
5. Plan RLS policies from `docs/security/rls-audit.md` around the real ownership model. Do not apply generic `auth.uid()` policies unless the app also moves to Supabase Auth or sets equivalent trusted context.
6. Convert public views to `security_invoker = true` where supported, or revoke direct access to those views.
7. Verify that document child tables are protected through parent-document ownership checks.
8. Verify `data_intelligence_v2_reveal_cards` and `data_intelligence_v2_audit_events` are admin/server-only until role-based access is implemented.
9. Remove unused `SUPABASE_SERVICE_ROLE_KEY` from project environments if it exists. Rotate it if it was exposed outside trusted server configuration.
10. Run Supabase security advisors after RLS/grant changes and archive the results with the audit docs.

## 5. Manual actions required in Vercel

1. Ensure production and real-data previews keep the intended Supabase/Postgres persistence backend and do not regress the PROD-001 fail-closed behavior.
2. Remove unused `SUPABASE_SERVICE_ROLE_KEY` from Vercel environments if present.
3. Confirm no secret is stored in a `NEXT_PUBLIC_*` variable.
4. Keep database URLs, Google OAuth secrets, NextAuth secrets, and encryption keys server-only.
5. Ensure `APP_ENCRYPTION_KEY` is set anywhere Supabase/Postgres token persistence is used.
6. Keep `DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL=false` until durable authorization and RLS are in place.
7. Add Vercel Firewall or equivalent shared-store rate limits for:
   - `/api/auth/signin*`
   - `/api/auth/callback/*`
   - `/api/storage/google/start`
   - `/api/storage/google/callback`
8. Review preview deployment access. Do not expose previews containing real client data through public preview URLs.
9. After production build, scan the client bundle for secret-looking env names and privileged credentials.
10. Confirm log retention and access controls are appropriate for sensitive RIA/client document metadata.

## 6. Keys that likely need rotation

No key rotation is required based on git history alone. Rotate keys if any of the conditions below are true.

| Key or credential | Rotate when | Current basis |
| --- | --- | --- |
| Supabase service role key | It exists in Vercel unnecessarily, was shared with developers broadly, was logged, or was ever exposed outside trusted server-only configuration. | Runtime does not use it, but `.env.example` documents it. |
| Supabase/Postgres database URL | The runtime URL uses an overprivileged role, was copied into local/shared systems, or appears in logs. | RLS audit recommends a least-privileged app role. |
| Google OAuth client secret | It was committed, logged, shared outside server env, or used in a compromised environment. | No git-history leak found. |
| Google OAuth refresh tokens/grants | Drive-scoped tokens were exposed through public session, logs, plaintext production SQLite, or broad local artifacts. | Public session token exposure and SQLite fallback are high-risk patterns. |
| `NEXTAUTH_SECRET` / auth signing secret | It was shared, committed, logged, or present in an untrusted preview/development environment. | No git-history leak found. |
| `APP_ENCRYPTION_KEY` | It was shared, committed, logged, or reused across untrusted environments. | Required to protect persisted OAuth tokens. |
| OpenAI/API provider keys | Any AI/debug logs, local files, or CI output exposed them. | No confirmed leak in current reports. |

## 7. Tests/checks to run before production

1. `npx tsc --noEmit`
2. `npm run lint`
3. Auth rate-limit tests for signin, callback, Drive OAuth start, and Drive OAuth callback.
4. Unauthenticated access matrix for every protected page and API route.
5. Cross-user/IDOR tests for preview snapshots, cleanup state, Drive file proxy, review decisions, storage connections, and filing events.
6. Supabase Data API tests using `anon` and `authenticated` keys to verify private tables are not readable or writable.
7. RLS tests using the final app role and at least two distinct owners/firms.
8. View tests proving `latest_account_snapshot_v` and `latest_account_document_v` do not bypass table policies.
9. Intake stale-state tests: expired Drive token should mark `needs_reauth`, refresh UI, and avoid showing stale data as live.
10. Google disconnect/reconnect tests, including old-token invalidation expectations.
11. Production-build client bundle scan for service-role keys, database URLs, OAuth secrets, auth tokens, and non-public env names.
12. Secret scan with `gitleaks` or `trufflehog` against current tree and history.
13. Logging scan for passwords, tokens, sessions, cookies, authorization headers, JWTs, service keys, user emails, and raw Supabase/Drive auth objects.
14. Data Intelligence V2 tests proving sensitive reveal cannot be accessed without the correct owner/role.
15. Manual Drive file authorization test with a file ID outside the configured app folders.

## 8. What is already safe enough for private MVP usage

These are acceptable for a tightly controlled private MVP with trusted operators, limited access, and preferably synthetic or low-volume pilot data. They are not enough by themselves for real client production.

1. No confirmed real secrets or `.env` files are tracked in the current tree.
2. Git history audit did not find confirmed committed production secrets.
3. `.env.local`, `.vercel/`, Supabase temp files, and local data directories are ignored.
4. No runtime Supabase service-role client or browser-side Supabase client was found.
5. No `NEXT_PUBLIC_*` secrets were found in the codebase.
6. Google storage tokens are encrypted when the Supabase/Postgres persistence backend is used with `APP_ENCRYPTION_KEY`.
7. Most pages and API paths already perform session checks directly or through shared helpers.
8. Basic in-memory rate limiting now protects the main auth and Drive OAuth endpoints.
9. Sensitive debug logging has been reduced to safer metadata in the reviewed code paths.
10. Intake now attempts refresh on normal navigation and refreshes server state after failed Drive refresh.

## 9. What is not safe enough for real users yet

1. Public/session-visible OAuth access token handling must be removed.
2. Sign-in is not restricted to an approved user, firm, domain, or account status model.
3. Supabase RLS and grants are not yet a verified production authorization boundary.
4. The app database role may bypass RLS unless a least-privileged role is created and used.
5. Public views may bypass RLS unless converted or access is revoked.
6. Persistent production SQLite fallback is mitigated, but plaintext local SQLite must remain local-dev/test only and the PROD-007 temporary projection SQLite bridge still needs follow-up.
7. Drive file access is not constrained tightly enough to app-owned folders/resources.
8. Preview snapshots and cached queues need stronger owner binding and tests.
9. Data Intelligence V2 sensitive reveal needs durable role/client authorization before enabling.
10. Auth/OAuth rate limiting is still in-memory and should be moved to Vercel Firewall or a shared store.
11. There is no explicit one-hour inactivity or account-disable enforcement.
12. Some local scripts can still print sensitive database contents if run on real data.
13. Production log retention, AI-data minimization, and extracted-data retention policies still need to be finalized.
