# RIA File Ops Risk Register

Date: 2026-05-18

## How to Use This Register

This register is the single source of truth for known risks discovered in the `docs/security/` audits. It consolidates duplicate findings into one row per practical risk, keeps stable risk IDs for tracking, and should be updated whenever a risk is fixed, accepted, reopened, or newly discovered.

Status meanings:

- `Open`: known risk with no complete fix yet.
- `Partially mitigated`: some safeguards exist, but the risk is not production-ready.
- `Mitigated / monitor`: the immediate issue is addressed; keep it in release checks.
- `Needs review`: the repository does not contain enough evidence to judge the risk.

## Risk Summary

Counts by severity:

| Severity | Count |
| --- | ---: |
| Critical | 5 |
| High | 18 |
| Medium | 23 |
| Low | 7 |
| Unknown / Needs Review | 6 |

Counts by category:

| Category | Count |
| --- | ---: |
| Auth | 3 |
| Authorization / IDOR | 4 |
| RLS / Database | 4 |
| Google Drive / OAuth | 5 |
| File Upload / Document Processing | 7 |
| AI / Privacy / Prompt Injection | 4 |
| Logging / Sensitive Output | 4 |
| Secrets / Env / Git History | 4 |
| Production vs Development | 7 |
| Dependency / Supply Chain | 4 |
| Vendor / Subprocessor | 1 |
| Data Retention / Deletion | 2 |
| Incident Response | 1 |
| Admin / Internal Misuse | 1 |
| Abuse / Cost Control | 2 |
| Disaster Recovery | 1 |
| Legal / Marketing Claims | 1 |
| IP / Licensing | 1 |
| Accessibility / UX Safety | 1 |
| Other | 2 |

## Prioritized Risk Register

| Risk ID | Severity | Category | Risk | Why It Matters | Affected Area / Files | Evidence Source | Recommended Fix | Status | Owner | Target Timing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RLS-001 | Critical | RLS / Database | Supabase Data API exposure and grants are unverified while RLS policies are missing. | If `anon` or `authenticated` roles can reach app tables/views, users could bypass app owner checks and read/write private data. | Supabase dashboard; public app tables/views; migrations | `rls-audit.md`; `auth-security-audit.md`; `security-roadmap.md` | Verify Data API exposure and grants, revoke client-role access until policies are implemented and tested. | Open | Supabase admin, Engineering | Immediate |
| FILE-001 | Critical | File Upload / Document Processing | Arbitrary Drive/snapshot bytes can be served inline from the app origin. | Scriptable files such as HTML/SVG could execute same-origin and call authenticated APIs as the signed-in user. | `app/api/drive/files/[fileId]/route.ts`; `app/api/preview/files/[snapshotId]/route.ts`; preview iframes | `security-master-audit.md`; `security-roadmap.md` | Block inline rendering for unsupported types, add sandbox/CSP, and consider a separate cookieless preview origin. | Open | Engineering, Vercel admin | Immediate |
| AUTH-001 | Critical | Auth | OAuth access tokens can appear in the browser-visible NextAuth session contract. | Browser-visible Drive-scoped tokens can expose user Drive access and increase blast radius of XSS or client compromise. | `auth.ts`; `types/next-auth.d.ts`; session consumers | `auth-security-audit.md`; `security-remediation-roadmap.md`; `security-roadmap.md` | Remove provider access tokens from public session output; keep tokens server-only. | Open | Engineering | Immediate |
| PROD-001 | Critical | Production vs Development | Production can silently fall back to persistent local SQLite persistence. | SQLite stores OAuth tokens plaintext and local state is not a production multi-user boundary. | `lib/persistence/backend.ts`; `lib/runtime-environment.ts`; Vercel envs; local `data/` | `auth-security-audit.md`; `security-master-audit.md`; `security-roadmap.md` | Production-like runtimes now fail closed unless `PERSISTENCE_BACKEND=supabase`, a Supabase/Postgres URL, and `APP_ENCRYPTION_KEY` are configured. This mitigates persistent `data/*.sqlite` fallback; verify Vercel/Supabase envs before release. | Mitigated / monitor | Engineering, Vercel admin | Release check |
| AUTH-002 | Critical | Auth | No production sign-in admission or account-status gate exists. | Any Google account may sign in unless Google OAuth or app code restricts access, which is unsafe for real client documents. | NextAuth sign-in; Google OAuth app settings; future app-user table | `auth-security-audit.md`; `auth-session-drive-status-audit.md`; `security-roadmap.md` | Add allowlist/domain/firm membership and disabled/suspended account checks before production access. | Open | Engineering, Google Cloud admin | Immediate |
| IDOR-001 | High | Authorization / IDOR | Raw Drive file proxy accepts any file ID accessible to the active token. | A signed-in user can request files outside the app workspace if their Drive token can access them. | `app/api/drive/files/[fileId]/route.ts`; `lib/google-drive.ts` | `security-master-audit.md`; `auth-security-audit.md`; `security-roadmap.md` | Authorize downloads through owner-scoped preview/history/cleanup context or verified configured folders. | Open | Engineering | Before real users |
| IDOR-002 | High | Authorization / IDOR | Temporary raw preview snapshots are not owner-bound. | A leaked snapshot ID could let another authenticated user fetch raw temporary document bytes during the TTL window. | `lib/preview-file-snapshots.ts`; `app/api/preview/files/[snapshotId]/route.ts` | `security-master-audit.md`; `auth-security-audit.md`; `security-roadmap.md` | Store owner and storage connection metadata with snapshots and enforce it on reads. | Open | Engineering | Before real users |
| IDOR-003 | High | Authorization / IDOR | Cleanup and Drive flows trust raw client-supplied file/folder IDs too broadly. | Operations can reach any Drive resource the token can access, not only configured app roots or owner-scoped state. | `app/api/cleanup/*`; `lib/cleanup-preview.ts`; setup folder actions | `security-master-audit.md`; `rls-audit.md`; `security-roadmap.md` | Validate selected IDs against stored owner, connection, and configured folder context before list/preview/move actions. | Open | Engineering | Before real users |
| RLS-002 | High | RLS / Database | The app database role may bypass RLS. | RLS is ineffective if the runtime uses a table owner, admin, service, or `BYPASSRLS` role. | `SUPABASE_DB_URL*`; `lib/postgres/server.ts`; Supabase roles | `rls-audit.md`; `auth-security-audit.md`; `security-roadmap.md` | Create and use a least-privileged app role without owner/admin/bypass privileges. | Open | Supabase admin, Vercel admin | Before real users |
| RLS-003 | High | RLS / Database | Public-schema views may bypass underlying table policies. | Default definer views can expose data even when base-table RLS is correct. | `latest_account_snapshot_v`; `latest_account_document_v`; Supabase views | `rls-audit.md`; `security-remediation-roadmap.md`; `security-roadmap.md` | Convert to `security_invoker` where supported or revoke client-role access. | Open | Supabase admin | Before real users |
| RLS-004 | High | RLS / Database | Document child tables, reveal cards, and audit events need policy-compatible ownership checks. | Many sensitive child rows do not carry direct `owner_email`; policies must join through parent documents or trusted context. | Document fact tables; reveal/audit tables; migrations | `rls-audit.md`; `sensitive-logging-cleanup.md`; `security-roadmap.md` | Draft, test, and apply policies around owner/org/client membership and parent-document ownership. | Open | Engineering, Supabase admin | Before real users |
| DRIVE-001 | High | Google Drive / OAuth | Legacy Drive `signIn()` path can reintroduce browser-visible Drive tokens. | It can request Drive scope through NextAuth and flow tokens into the public session contract. | `components/google-drive-connect-button.tsx`; NextAuth provider flow | `auth-security-audit.md`; `security-remediation-roadmap.md`; `security-roadmap.md` | Remove or rewrite the component so Drive authorization only uses the server-side storage OAuth flow. | Open | Engineering | Before real users |
| DRIVE-002 | High | Google Drive / OAuth | Broad Drive scope and folder/file actions are not constrained enough by app-owned resources. | If a session is abused, broad Drive write access can affect files outside intended app folders. | Google Drive scopes; cleanup/browser routes; setup folder selection | `security-master-audit.md`; `security-roadmap.md` | Reassess scope, store account/folder context, and restrict actions to configured roots unless explicitly approved. | Open | Engineering, Google Cloud admin | Before real users |
| FILE-002 | High | File Upload / Document Processing | No central file type allowlist or magic-byte validation exists before parsing/preview. | MIME and extension spoofing could route unsupported or active files into parsers, caches, or inline previews. | `lib/processing-preview.ts`; `lib/document-intelligence.ts`; Drive download routes | `security-master-audit.md`; `security-roadmap.md` | Add server-side MIME, extension, and magic-byte policy before download, snapshot, parse, or preview. | Open | Engineering | Before real users |
| FILE-003 | High | File Upload / Document Processing | No file size limit exists before full-buffer Drive downloads. | Large files can exhaust Vercel memory/time or fill temp storage. | `lib/google-drive.ts`; `lib/processing-preview.ts`; preview snapshots | `security-master-audit.md`; `security-roadmap.md` | Enforce byte caps from Drive metadata and stream with hard limits where possible. | Open | Engineering, Vercel admin | Before real users |
| FILE-004 | High | File Upload / Document Processing | A live file mutation is reachable through a GET route. | Browser navigation or cross-site triggers can accidentally initiate destructive Drive operations. | `app/preview/auto-file/route.ts`; filing actions | `security-master-audit.md`; `security-roadmap.md` | Remove the GET mutation or convert it to POST with CSRF and user confirmation. | Open | Engineering | Before real users |
| AI-001 | High | AI / Privacy / Prompt Injection | AI Primary Parser can send extracted document text to an external model endpoint. | Account, tax, and identity documents may contain sensitive client data that should not leave the app without redaction and vendor controls. | `lib/ai-primary-parser.ts`; AI parser flags | `security-master-audit.md`; `security-roadmap.md` | Keep disabled for real data until pre-prompt redaction, privacy tests, and vendor review are complete. | Open | Engineering, Product | Before real users |
| AI-002 | High | AI / Privacy / Prompt Injection | Legacy Data Intelligence can send or return sensitive facts without V2 reveal boundaries. | Legacy prompts and browser JSON can include client-sensitive information such as direct sensitive-value answers. | `app/api/query-assistant/route.ts`; legacy assistant/orchestrator | `security-master-audit.md`; `security-roadmap.md` | Disable legacy AI for real client data or route sensitive requests through V2 reveal cards. | Open | Engineering | Before real users |
| AI-003 | High | AI / Privacy / Prompt Injection | V2 sensitive reveal is coarse and globally flag-driven. | Raw sensitive values can be returned to the browser before durable firm/client/role authorization exists. | V2 reveal route; V2 auth context; reveal token service | `auth-security-audit.md`; `security-master-audit.md`; `security-roadmap.md` | Keep reveal disabled in production until durable authorization, audit health, and tests are in place. | Open | Engineering, Product | Before real users |
| PRIV-001 | High | AI / Privacy / Prompt Injection | Diagnostic UI exposes extracted document content and parser metadata in the browser. | Sensitive text, PDF fields, file IDs, hashes, and AI raw summaries can leak through browser memory, screenshots, or support sessions. | Intake and Clean Up diagnostics | `security-master-audit.md`; `sensitive-logging-cleanup.md`; `security-roadmap.md` | Gate diagnostics behind production-off admin/debug flags and redact by default. | Open | Engineering, Product | Before real users |
| PROD-002 | High | Production vs Development | Preview tooling can enable V2, OpenAI, and sensitive reveal on Preview deployments. | A broadly accessible preview could expose real AI/reveal functionality against real data. | `scripts/configure-vercel-v2-preview-env.mjs`; Vercel Preview envs | `security-master-audit.md`; `security-roadmap.md` | Use branch-scoped Preview envs, Deployment Protection, non-production resources, and a rollback checklist. | Open | Vercel admin, Engineering | Before real-data previews |
| ABUSE-001 | High | Abuse / Cost Control | Auth/OAuth rate limiting is in-memory only. | Per-instance limits are weak under scale, cold starts, or distributed abuse. | `lib/rate-limit.ts`; auth and storage OAuth routes | `auth-security-audit.md`; `security-remediation-roadmap.md`; `security-roadmap.md` | Move to Vercel Firewall or a shared durable store for auth/OAuth endpoints. | Partially mitigated | Engineering, Vercel admin | Before real users |
| RET-001 | High | Data Retention / Deletion | Raw snapshots and preview caches retain sensitive extracted data without a complete retention policy. | Sensitive client data can persist longer than needed in temp files, local files, Supabase cache, audit events, or exports. | `os.tmpdir()` snapshots; preview cache; filing history; V2 audit/reveal records | `security-master-audit.md`; `security-roadmap.md`; `security-remediation-roadmap.md` | Define TTLs, deletion workflows, cache minimization, and audit retention before real client use. | Open | Engineering, Product, Compliance | Before real users |
| AUTH-003 | Medium | Auth | Session lifetime, inactivity, and disabled-account behavior are not explicit. | Sensitive apps need predictable session expiry and account status handling. | NextAuth config; app-user/account model | `auth-session-drive-status-audit.md`; `security-roadmap.md` | Decide and implement `maxAge`, `updateAge`, inactivity, and account status checks. | Open | Engineering, Product | Before production |
| IDOR-004 | Medium | Authorization / IDOR | Some sensitive mutation routes rely on lower-level shared auth helpers instead of route-local checks. | Protection exists today, but it is less obvious and easier to regress as routes change. | `/api/cleanup/run`; `/api/cleanup/apply`; `/api/intake/approve`; shared helpers | `auth-security-audit.md`; `rls-audit.md`; `security-remediation-roadmap.md` | Add route-local auth/ownership checks and route inventory tests. | Open | Engineering | Before production |
| DRIVE-003 | Medium | Google Drive / OAuth | Disconnect removes local records but does not revoke the Google grant. | A user may think access is revoked when the external OAuth grant still exists. | Storage disconnect/actions; Google token revocation | `auth-security-audit.md`; `security-roadmap.md` | Add provider revoke flow or clear product language for local disconnect vs provider revoke. | Open | Engineering, Google Cloud admin | Before production |
| DRIVE-004 | Medium | Google Drive / OAuth | Drive connection status is inconsistent across Intake, Clean Up, Dashboard, History, and Setup. | Users may confuse cached queues with live Drive access or miss reconnect states. | Intake refresh; cleanup browser; dashboard/setup status panels | `auth-session-drive-status-audit.md`; `security-roadmap.md` | Add shared Drive-status helper, visible refresh state, and stale-state tests. | Partially mitigated | Engineering, Product | Before production |
| FILE-005 | Medium | File Upload / Document Processing | PDF/OCR parsing lacks strong sandboxing, timeouts, and memory/page limits. | Malformed documents can cause crashes, hangs, resource exhaustion, or unsafe helper behavior. | `lib/document-intelligence.ts`; Python/Swift extractors | `security-master-audit.md`; `security-roadmap.md` | Add subprocess timeouts, max pages/text/fields, minimal env, and long-term parser isolation. | Open | Engineering, Infra | Before production |
| FILE-006 | Medium | File Upload / Document Processing | No malware scanning or quarantine workflow was found. | Client-supplied Drive files may contain malware or active content before preview/move/download. | Drive ingestion and preview pipeline | `security-master-audit.md`; `security-roadmap.md` | Add quarantine state and malware scanning plan; block unsupported inline previews now. | Open | Engineering, Infra | Before production |
| LOG-001 | Medium | Logging / Sensitive Output | Some routes can return raw error messages to the browser. | Parser, Drive, and database errors can expose file names, IDs, paths, or implementation details. | Cleanup/analyze/run/apply routes; parser/provider errors | `security-master-audit.md`; `sensitive-logging-cleanup.md` | Return generic errors to users and log safe metadata server-side. | Open | Engineering | Before production |
| LOG-002 | Medium | Logging / Sensitive Output | CLI and audit scripts can print JSON or database summaries. | Scripts are useful locally but risky in shared terminals, CI, or real client databases. | `scripts/inspect-firm-document-sqlite.mjs`; eval/deployment scripts | `sensitive-logging-cleanup.md`; `security-master-audit.md`; `security-roadmap.md` | Add local-only warnings or `--allow-sensitive-output`; keep production secrets out of CI logs. | Open | Engineering | Before production |
| LOG-003 | Medium | Logging / Sensitive Output | V2 audit persistence stores sensitive operational identifiers and metadata. | Audit events are not console logs, but they still need strict access control and retention. | V2 audit tables and sink | `sensitive-logging-cleanup.md`; `security-master-audit.md`; `rls-audit.md` | Protect audit tables with RLS/grants, retention limits, and admin-only access. | Open | Engineering, Supabase admin | Before production |
| SECRETS-001 | Medium | Secrets / Env / Git History | `SUPABASE_SERVICE_ROLE_KEY` is documented despite no runtime use. | Keeping a high-privilege key in templates increases the chance it gets provisioned or shared unnecessarily. | `.env.example`; Vercel/Supabase env posture | `auth-security-audit.md`; `secret-history-audit.md`; `security-roadmap.md` | Remove from templates/envs unless truly needed; rotate only if exposed or broadly shared. | Open | Engineering, Vercel admin | Before production |
| SECRETS-002 | Medium | Secrets / Env / Git History | Automated secret scanning and push protection are not documented as enabled. | Current history looked clean, but future leaks need automated prevention. | GitHub repo and CI | `secret-history-audit.md`; `security-roadmap.md` | Enable GitHub secret scanning/push protection and add `gitleaks` or `trufflehog` CI checks. | Open | GitHub admin | Before production |
| PROD-003 | Medium | Production vs Development | Production-like guards rely too much on `NODE_ENV`. | Public previews or unusual deployments can run real data without the intended production safety checks. | V2 config; service factory; eval/dev mock guards; `lib/runtime-environment.ts` | `security-master-audit.md`; `security-roadmap.md` | Central runtime helper now exists for persistence; follow-up is to adopt it across V2 config, service factory, eval, and dev-mock guards. | Partially mitigated | Engineering | Before production |
| PROD-004 | Medium | Production vs Development | Preview access controls are mostly manual Vercel settings. | Repo code does not enforce Deployment Protection, branch env scoping, or preview public access. | Vercel project settings; preview envs; proxy | `security-master-audit.md`; `security-roadmap.md` | Document and verify Deployment Protection, branch-scoped secrets, and real-data preview policy. | Open | Vercel admin | Before real-data previews |
| PROD-005 | Medium | Production vs Development | Dev mock and eval flags need stronger local-only controls. | Mock/eval paths should never run with production data credentials or public preview exposure. | V2 dev mock config; eval scripts; preview QA scripts | `security-master-audit.md`; `security-roadmap.md` | Refuse dev/eval modes when production env markers or real-data credentials are present. | Open | Engineering | Before production |
| PROD-007 | Medium | Production vs Development | Temporary projection SQLite bridge may process sensitive data in production-like runtimes. | The Supabase projection path writes canonical document/client/account facts to a request-scoped temp `projection.sqlite` before persisting to Postgres. It is not the persistent `data/*.sqlite` fallback, but temp-file controls still matter for real data. | `lib/persistence/supabase-document-projection-store.ts`; `os.tmpdir()` | PROD-001 review | Keep temp paths unpredictable, request/job scoped, permission-limited, and deleted in `finally`; monitor cleanup failures and replace the bridge with direct Postgres projection if needed. | Partially mitigated | Engineering | Before production |
| DEP-001 | Medium | Dependency / Supply Chain | Moderate npm audit findings remain around `postcss` via Next/NextAuth. | The force fix path is unsafe, but the advisory should stay visible until a normal framework patch resolves it. | `package.json`; `package-lock.json`; npm audit | `security-roadmap.md`; dependency audit work | Monitor Next/NextAuth releases and patch through normal semver-compatible updates. | Open | Engineering | Before production |
| DEP-002 | Medium | Dependency / Supply Chain | Native/install-script dependencies increase supply-chain risk. | `better-sqlite3`, `sharp`, and resolver packages execute install-time or native binary flows. | `package-lock.json`; native optional packages | `security-roadmap.md`; dependency audit work | Review lockfile diffs, pin trusted updates, and use separate audit/build install policies. | Open | Engineering | Before production |
| DEP-003 | Medium | Dependency / Supply Chain | PDF/parser/rendering dependencies process untrusted files and need tight patch cadence. | Parser vulnerabilities can become file-processing attacks. | `pdf-parse`; `pdfjs-dist`; native canvas; parser helpers | `security-master-audit.md`; `security-roadmap.md` | Run parser regression tests after updates and prioritize parser CVEs. | Open | Engineering | Before production |
| ADMIN-001 | Medium | Admin / Internal Misuse | Admin/support/debug access model is not defined. | Diagnostics, audit tables, logs, and inspection scripts can expose sensitive client data if internal access is too broad. | Diagnostics; audit data; scripts; future admin tools | `sensitive-logging-cleanup.md`; `security-master-audit.md`; `security-roadmap.md` | Define admin/support roles, least-privilege access, audit review, and debug approval workflow. | Open | Product, Engineering | Before production |
| ABUSE-002 | Medium | Abuse / Cost Control | Preview QA and external AI paths need cost/abuse controls. | A leaked QA secret or overbroad AI flag could drive model cost or expose test endpoints. | V2 preview QA endpoint; OpenAI flags; Vercel preview | `security-master-audit.md`; `security-roadmap.md` | Rate-limit preview QA, rotate QA secrets, and require separate real-OpenAI preview flag. | Open | Engineering, Vercel admin | Before real-data previews |
| RET-002 | Medium | Data Retention / Deletion | Formal disposal, deletion request, and retention SLAs are not documented. | Sensitive RIA/client records need predictable deletion and retention behavior beyond code-level TTLs. | Product policy; cache/audit/export/storage records | `security-master-audit.md`; `security-roadmap.md` | Define retention schedules, deletion workflows, and exceptions for audit/legal hold. | Open | Product, Compliance, Engineering | Before production |
| INFRA-001 | Medium | Other | Production log retention and access controls are not fully documented. | Vercel/Supabase logs can contain sensitive metadata even after log sanitization. | Vercel logs; Supabase logs; local support artifacts | `security-master-audit.md`; `security-roadmap.md` | Set retention, access controls, and log review policy for production and previews. | Open | Vercel admin, Supabase admin | Before production |
| UX-001 | Medium | Accessibility / UX Safety | Cached/stale state can mislead users about live Drive state. | Operational mistakes can happen if a user acts on stale queue or connection status. | Intake; Clean Up; Dashboard; Setup status UI | `auth-session-drive-status-audit.md`; `security-roadmap.md` | Show explicit live/cached/error states and provide manual refresh/reconnect actions. | Partially mitigated | Product, Engineering | Before production |
| SECRETS-003 | Low | Secrets / Env / Git History | No confirmed secret was found in git history, but secret-shaped names exist. | Variable-name references are not leaks, but they should remain in secret-scanning release checks. | Git history; code/docs/tests env-name references | `secret-history-audit.md`; `auth-security-audit.md` | Keep history scanning in CI and avoid adding real values to docs or tests. | Mitigated / monitor | GitHub admin, Engineering | Ongoing |
| SECRETS-004 | Low | Secrets / Env / Git History | Local ignored env/data files remain sensitive operational material. | Ignored files can still leak through screenshots, support logs, backups, or manual sharing. | `.env.local`; `.vercel/`; `data/`; local machine | `secret-history-audit.md`; `security-roadmap.md` | Treat ignored local files as secrets and never paste them into issues, logs, chats, or AI tools. | Open | All operators | Ongoing |
| LOG-004 | Low | Logging / Sensitive Output | Sensitive logging cleanup is partially complete but needs regression checks. | Future console/log additions can reintroduce token, session, or document data leaks. | `console.*` call sites; safe logging helper | `sensitive-logging-cleanup.md`; `security-roadmap.md` | Add periodic logging scans and tests around safe error metadata. | Partially mitigated | Engineering | Ongoing |
| PROD-006 | Low | Production vs Development | Hidden debug/admin/test routes were not found, but route drift remains possible. | New routes can accidentally expose tooling without review. | `app/` route inventory | `security-master-audit.md`; `security-roadmap.md` | Add route inventory CI checks for debug/test/admin/bypass/QA endpoints. | Mitigated / monitor | Engineering | Ongoing |
| DEP-004 | Low | Dependency / Supply Chain | Direct high-severity Next.js audit findings were patched, but patch cadence must continue. | Framework advisories move quickly, and a lagging framework is a recurring risk. | `next`; `eslint-config-next`; lockfile | `security-roadmap.md`; dependency audit work | Keep Dependabot/Renovate and audit gates active for high/critical advisories. | Mitigated / monitor | Engineering | Ongoing |
| FILE-007 | Low | File Upload / Document Processing | Supabase Storage is not used now, but future buckets could drift public. | Client documents must never land in public buckets if storage is added later. | Future Supabase Storage buckets/policies | `security-master-audit.md`; `security-roadmap.md` | If added, create private bucket policies in migrations and test signed URL/owner access. | Needs review | Engineering, Supabase admin | Future feature |
| DRIVE-005 | Low | Google Drive / OAuth | Shared-drive support assumptions are not intentionally modeled. | Inconsistent shared-drive behavior can cause missing data, stale state, or overbroad access. | Drive listing/search/move helpers | `security-master-audit.md`; `security-roadmap.md` | Either consistently support shared drives or block them with clear UX. | Needs review | Product, Engineering | Future hardening |
| VENDOR-001 | Unknown / Needs Review | Vendor / Subprocessor | Vendor/subprocessor inventory and contracts are not documented in existing audits. | The app can involve Google, Vercel, Supabase, OpenAI-compatible providers, and local tooling; obligations depend on data handling and contracts. | Vendor list; DPAs; subprocessors; data-use settings | `security-roadmap.md`; absent `vendor-subprocessor-audit.md` | Create vendor/subprocessor audit covering data types, retention, DPAs, data-use settings, and support access. | Needs review | Product, Legal/Compliance | Before production |
| IR-001 | Unknown / Needs Review | Incident Response | No incident response plan document exists in `docs/security/`. | The team needs a tested path for secret leaks, OAuth token exposure, data incidents, and model/log exposure. | Incident response process | Absent `incident-response-plan.md`; `secret-history-audit.md` cleanup guidance | Create incident response plan with roles, severity, evidence handling, customer notice triggers, and key rotation playbooks. | Needs review | Product, Engineering, Legal/Compliance | Before production |
| DR-001 | Unknown / Needs Review | Disaster Recovery | Disaster recovery, backup, and restore posture is not documented. | Sensitive workflows need tested recovery for Supabase data, local artifacts, Vercel deploys, and Google Drive state assumptions. | Supabase backups; Vercel deployments; app data recovery | Absent `disaster-recovery-audit.md`; `security-roadmap.md` | Create DR audit covering RPO/RTO, backup access, restore tests, and rollback procedures. | Needs review | Engineering, Supabase admin, Vercel admin | Before production |
| LEGAL-001 | Unknown / Needs Review | Legal / Marketing Claims | Legal and marketing security/privacy claims have not been audited. | Overstating security, AI privacy, compliance, or data retention can create legal and trust risk. | Website copy; demos; docs; user-facing promises | Absent `legal-marketing-claims-audit.md`; `security-roadmap.md` | Review all claims against implemented controls and remove/qualify anything not true today. | Needs review | Product, Legal/Compliance | Before public demos |
| IP-001 | Unknown / Needs Review | IP / Licensing | IP and licensing posture has not been audited. | Native packages, generated assets, parser tooling, and third-party licenses need review before commercial use. | npm licenses; generated corpora; scripts; assets | Absent `ip-licensing-audit.md`; dependency/license notes | Create IP/licensing audit and SBOM; verify package, corpus, and generated asset usage rights. | Needs review | Legal/Compliance, Engineering | Before production |
| A11Y-001 | Unknown / Needs Review | Accessibility / UX Safety | Accessibility and UX safety have not been audited. | Security workflows such as warnings, reconnect states, destructive confirmations, and reveal cards must be clear and usable. | Product UI; warnings; confirmations; reveal UX | `auth-session-drive-status-audit.md`; absent dedicated accessibility audit | Audit critical security UX for accessibility, clear state, and destructive-action confirmations. | Needs review | Product, Engineering | Before production |
| OTHER-001 | Unknown / Needs Review | Other | RIA/client-document compliance obligations are not mapped to implemented controls. | The repo cannot prove whether retention, privacy, supervision, audit, or notice obligations are met. | Product policy; compliance controls; audit evidence | `security-roadmap.md`; missing legal/compliance audit docs | Map realistic regulatory/compliance obligations to product controls before real client data. | Needs review | Product, Legal/Compliance | Before real users |

## Immediate Top 10 Risks

1. `RLS-001` - Supabase Data API exposure and grants are unverified while RLS policies are missing.
   Why it matters: direct Supabase access could bypass the app entirely if exposed roles can reach private tables.
   First step: inspect Supabase Data API exposure and revoke `anon`/`authenticated` access until policies are tested.

2. `FILE-001` - Arbitrary Drive/snapshot bytes can be served inline from the app origin.
   Why it matters: a scriptable document could become same-origin execution against a signed-in user.
   First step: block unsupported inline MIME types and add sandbox/CSP around previews.

3. `AUTH-001` - OAuth access tokens can appear in the browser-visible NextAuth session contract.
   Why it matters: browser-visible Drive-scoped tokens create a direct credential exposure path.
   First step: remove `accessToken` from public session output and keep provider tokens server-only.

4. `PROD-001` - Production can silently fall back to persistent local SQLite persistence.
   Why it matters: plaintext token storage and single-host local state are not safe for production.
   Current state: code now fails closed in production-like runtimes unless Supabase/Postgres encrypted persistence is configured. This covers persistent `data/*.sqlite` fallback, not the separate temp projection SQLite bridge tracked as `PROD-007`. Release check: verify Vercel Production and any real-data Preview have `PERSISTENCE_BACKEND=supabase`, a Supabase/Postgres URL, and `APP_ENCRYPTION_KEY`.

5. `AUTH-002` - No production sign-in admission or account-status gate exists.
   Why it matters: any Google account may enter a sensitive client-document app.
   First step: add app-level allowlist, domain, firm membership, or invite checks in sign-in.

6. `IDOR-001` - Raw Drive file proxy accepts any file ID accessible to the active token.
   Why it matters: Drive access is broader than app resource ownership.
   First step: require file IDs to resolve through owner-scoped queue, history, cleanup, or configured folder context.

7. `IDOR-002` - Temporary raw preview snapshots are not owner-bound.
   Why it matters: leaked snapshot IDs can expose raw documents to other authenticated users.
   First step: add owner/storage connection metadata to snapshot records and enforce it on read.

8. `FILE-002` - No central file type allowlist or magic-byte validation exists.
   Why it matters: spoofed or active files can enter parsing, cache, or preview paths.
   First step: implement a central file policy for MIME, extension, and magic bytes.

9. `FILE-003` - No file size limit exists before full-buffer Drive downloads.
   Why it matters: oversized files can exhaust memory, function time, or temp storage.
   First step: enforce byte caps from Drive metadata before download.

10. `AI-001` - AI Primary Parser can send extracted document text to an external model endpoint.
    Why it matters: sensitive client document content can leave the app without redaction and vendor controls.
    First step: keep the flag disabled for real data until redaction and vendor review are complete.

## Risks That Block Real Users

These should block onboarding real RIA/client users:

- `RLS-001`, `RLS-002`, `RLS-003`, `RLS-004`: database access and RLS are not a verified production boundary.
- `AUTH-001`, `AUTH-002`, `AUTH-003`: token exposure, open sign-in, and unclear session/account policy.
- `PROD-001`: mitigated in code for persistent `data/*.sqlite` fallback; keep production and real-data preview env verification as a release check.
- `PROD-007`: temporary projection SQLite bridge still processes sensitive canonical data and needs temp-file hardening/monitoring or replacement before production.
- `FILE-001`, `FILE-002`, `FILE-003`, `FILE-004`, `FILE-005`, `FILE-006`: unsafe file preview, validation, size, mutation, parser, and malware posture.
- `IDOR-001`, `IDOR-002`, `IDOR-003`: Drive and snapshot resource authorization gaps.
- `AI-001`, `AI-002`, `AI-003`, `PRIV-001`: AI/data leakage and sensitive reveal controls are not ready.
- `RET-001`, `RET-002`: retention and disposal are not defined enough for client data.
- `VENDOR-001`, `IR-001`, `DR-001`, `LEGAL-001`, `OTHER-001`: required operational/legal/compliance reviews are missing.

## Risks That Are Acceptable for Private MVP/Demo Only

These are acceptable only for trusted private demos or synthetic/low-risk data, not real client production:

- `ABUSE-001`: in-memory rate limiting, while traffic is very limited and trusted.
- `DRIVE-004`: partial stale-state handling, if users understand cached vs live status.
- `LOG-004`: sensitive logging cleanup is improved, while logs remain private and low-volume.
- `PROD-006`: no hidden debug routes found, while route additions are reviewed manually.
- `DEP-004`: patched high Next.js findings, while dependency monitoring continues.
- `SECRETS-003`: no confirmed git secret leak, while secret scans stay part of release checks.
- Owner-email-only isolation can support a single trusted operator demo, but it is not enough for real multi-user firms.

## Manual Actions Needed

Supabase:

- Verify Data API exposure for every app table and view.
- Confirm grants for `anon`, `authenticated`, service/admin, and app roles.
- Revoke client-role access to server-only tables, especially token, preview cache, document fact, reveal, and audit tables.
- Create a least-privileged app role without `BYPASSRLS`.
- Decide whether the current direct-Postgres architecture will enforce RLS through trusted DB settings or keep Data API access revoked.
- Convert public views to `security_invoker` or revoke direct access.
- Run Supabase security advisors after grants/RLS changes.
- Confirm encrypted token storage uses `APP_ENCRYPTION_KEY`.
- Remove unused service-role keys from environments if present.

Vercel:

- Set `PERSISTENCE_BACKEND=supabase` for production and any real-data preview.
- Keep database URLs, Google secrets, auth secrets, encryption keys, AI keys, preview QA secrets, and bypass secrets server-only.
- Confirm no secret is in `NEXT_PUBLIC_*`.
- Enable Deployment Protection for real-data previews.
- Branch-scope V2 preview env vars and QA secrets.
- Keep external AI and sensitive reveal flags disabled for production until controls are ready.
- Add Vercel Firewall or shared-store rate limits for auth/OAuth endpoints.
- Review log retention and production log access.
- Ensure runtime Node versions satisfy current dependency engine requirements.

Google Cloud / OAuth:

- Restrict OAuth app access to approved users/domains while private.
- Use separate OAuth clients for production and preview/staging if real data is used.
- Review and document Drive scopes.
- Revoke grants for accounts exposed through browser-visible Drive-scoped session tokens or plaintext non-local SQLite.
- Implement or document disconnect behavior: local disconnect, Google revoke, or both.
- Verify redirect URIs and OAuth app publishing/verification status.

GitHub:

- Enable secret scanning and push protection.
- Add `gitleaks` or `trufflehog` to CI.
- Add Dependabot/Renovate.
- Add CI jobs for lint, build, npm audit, route inventory, secret scan, owner-isolation tests, and RLS tests.
- Protect branches that deploy to production or real-data previews.
- Add review ownership for auth, storage, Supabase migrations, Vercel env docs, lockfile changes, and security docs.

OpenAI / AI vendors:

- Verify provider retention, training/data-use settings, and contract posture.
- Keep external AI off for real client documents until prompt redaction and tests exist.
- Keep OpenAI `store: false` for V2 and equivalent settings for any provider used by legacy paths.
- Define cost limits and alerting for preview QA and production AI routes.
- Document approved fields that may be sent to AI systems.

Other vendors:

- Create vendor/subprocessor inventory for Vercel, Supabase, Google, OpenAI-compatible providers, GitHub, and any future logging/analytics/error reporting vendor.
- Record what data each vendor receives, where it is stored, retention/deletion options, and contract/DPA status.

## Key Rotation / Secret Handling Checklist

Rotate or revoke only when exposure is suspected or confirmed:

- Supabase service role key: rotate if it was stored unnecessarily, shared, logged, committed elsewhere, pasted into tools, or exposed in preview output.
- Supabase/Postgres database URL: rotate when moving to a least-privileged app role, or if logs/shared files exposed it.
- Google OAuth client secret: rotate if committed, logged, shared, or used in an untrusted environment.
- Google OAuth refresh tokens/grants: revoke if Drive-scoped tokens reached browser sessions, logs, plaintext non-local SQLite, or shared artifacts.
- `NEXTAUTH_SECRET` or auth signing secret: rotate if shared, logged, committed, or used in an untrusted preview.
- `APP_ENCRYPTION_KEY`: rotate only with a re-encryption or forced reconnect plan if exposed or reused across untrusted environments.
- OpenAI/API keys: rotate if logs, CI output, local files, support artifacts, or shared docs exposed them.
- Vercel bypass and preview QA secrets: rotate if used in URLs, shared broadly, logged, or exposed in CI.

Standing secret-handling rules:

- Do not paste `.env.local`, Vercel env exports, tokens, database URLs, OAuth responses, raw logs, or extracted client text into issues, chats, screenshots, or AI tools.
- Keep `.env.local`, `.vercel/`, `supabase/.temp/`, and `data/` ignored.
- Treat local ignored files as sensitive even though they are not tracked.

## Open Questions

- Are any Supabase public tables/views currently exposed through Data API grants to `anon` or `authenticated`?
- Which Postgres role does production actually use, and does it bypass RLS?
- Will the final tenancy model be owner email only, firm/org based, or client/account based?
- Which file types and maximum sizes should production officially support?
- Should raw document previews be available in production, or should users open originals in Drive?
- Are Vercel Preview deployments ever connected to real client data or production-like OAuth/Supabase resources?
- What is the required session inactivity period and account disable/suspension behavior?
- Can Google Drive scopes be narrowed, or is broad write access a product requirement?
- Which vendors/subprocessors are approved for real client data, and what retention/training settings are required?
- What are the retention and deletion SLAs for preview caches, temp files, audit events, extracted metadata, and exports?
- What incident response, disaster recovery, legal/marketing claims, and IP/licensing reviews are required before public demos or production?
- Who owns ongoing review of logs, audit events, dependency advisories, and preview environment drift?
