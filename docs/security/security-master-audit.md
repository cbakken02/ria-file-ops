# Security Master Audit

Date: 2026-05-18

## File Upload & Document Processing Audit

### Scope reviewed

This app does not currently expose a normal browser file-upload endpoint. I found no `request.formData()` file ingestion route, no `<input type="file">`, no Supabase Storage bucket API usage, no signed URL generation, and no direct browser-to-Supabase-storage upload flow in the reviewed code.

The effective upload/storage source is Google Drive:

1. Users connect Drive through the storage OAuth flow.
2. Users choose Drive folders in setup.
3. Intake and Clean Up list Drive files, download document bytes server-side, parse PDFs/images, cache extracted metadata, and sometimes cache raw preview bytes locally.
4. Browser previews are rendered through same-origin app routes that proxy Drive files or temporary preview snapshots.

### Data flow inventory

| Flow | Entry point | Storage/parsing path | Notes |
| --- | --- | --- | --- |
| Intake refresh | `app/api/preview/refresh/route.ts` | `lib/intake-refresh.ts` -> `lib/processing-preview.ts` -> `lib/document-intelligence.ts` | Lists configured Drive source folder, downloads candidate files, parses PDFs/images, writes preview snapshot/cache. |
| Intake preview file | `app/api/preview/files/[snapshotId]/route.ts` | `lib/preview-file-snapshots.ts` | Serves temporary raw file bytes from `os.tmpdir()`. |
| Drive file preview/download | `app/api/drive/files/[fileId]/route.ts` | `lib/google-drive.ts` | Downloads arbitrary Drive file by ID using active storage token and returns bytes inline. |
| Clean Up browser | `app/api/cleanup/browser/route.ts` | `lib/google-drive.ts`, cleanup state stores | Lists arbitrary Drive folder IDs accessible to the active token. |
| Clean Up preview/analyze/run/apply | `app/api/cleanup/*` | `lib/cleanup-preview.ts`, `lib/processing-preview.ts`, `lib/file-approval.ts`, `lib/filing.ts` | Downloads selected files/folders, builds filing candidates, and may move/rename Drive files. |
| Filing history preview/export | `app/history/history-events.tsx`, `app/api/history/export/route.ts` | `app/api/drive/files/[fileId]/route.ts`, filing event store | History can iframe original Drive file IDs and export sensitive file metadata. |
| Extracted metadata persistence | `lib/preview-snapshot.ts`, `lib/preview-analysis-cache.ts`, `lib/firm-document-store.ts` | SQLite or Supabase/Postgres tables | Stores document metadata, excerpts, PDF fields, debug data, and canonical projections. |

### Findings

| Finding | Severity | Impact | Affected files/routes/services | Recommended fixes | Type |
| --- | --- | --- | --- | --- | --- |
| Arbitrary Drive and snapshot content is served inline from the app origin. | Critical for untrusted client-uploaded files; High otherwise | A malicious HTML/SVG/scriptable document stored in Drive could be proxied from the app origin and rendered in an iframe without a sandbox. That can become same-origin script execution against the signed-in user, allowing app API calls and data access under that user session. `X-Content-Type-Options: nosniff` does not make inline HTML/SVG safe. | `app/api/drive/files/[fileId]/route.ts:30`, `app/api/preview/files/[snapshotId]/route.ts:25`, `app/preview/intake-queue.tsx:1266`, `app/cleanup/cleanup-planner.tsx:1803`, `app/history/history-events.tsx:365` | Do not serve arbitrary Drive MIME types inline. Add a strict preview allowlist, force unsupported types to a non-inline path, add sandboxed iframes, and consider serving previews from a separate cookieless origin. Add a response CSP for preview routes, such as a sandboxed/default-deny policy tested with PDF/image rendering. | Code, Vercel |
| Drive file proxy is authenticated but not resource-authorized. | High | Any signed-in user with a connected Drive token can request any Drive file ID that token can access, not only files in the configured intake/destination folders, preview queue, cleanup selection, or owner-scoped filing history. This is an IDOR-style issue at the app resource layer. | `app/api/drive/files/[fileId]/route.ts:22`, `lib/google-drive.ts:282`, `app/history/history-events.tsx:367`, `app/preview/intake-queue.tsx:1269`, `app/cleanup/cleanup-planner.tsx:1814` | Require a trusted context for file downloads: preview snapshot owned by the session, filing event owned by the session, cleanup state owned by the session, or verified parent folder under configured owner folders. Avoid accepting a raw `fileId` URL parameter as sufficient authorization. | Code |
| No file type allowlist or magic-byte validation before download, parsing, snapshotting, or inline preview. | High | The pipeline filters out folders but accepts every non-folder Drive item. Non-PDF/non-image files are still downloaded by preview artifact creation and may be cached or proxied. MIME type and extension come from Drive metadata/name and can be wrong or unsafe. | `lib/processing-preview.ts:332`, `lib/processing-preview.ts:568`, `lib/processing-preview.ts:604`, `lib/document-intelligence.ts:285`, `lib/document-intelligence.ts:406`, `app/api/drive/files/[fileId]/route.ts:36` | Add a central server-side file policy with allowed MIME types/extensions, magic-byte checks, and explicit unsupported-file handling. Start with `application/pdf`, `image/png`, `image/jpeg`, and any known safe image formats the parser actually supports. Treat SVG, HTML, Office macros, archives, executables, and unknown binary types as unsupported for inline preview and parsing. | Code |
| No file size limit before full-buffer downloads. | High | The app downloads Drive files into memory with `arrayBuffer()` and writes raw snapshots to temp storage. A large file can exhaust Vercel function memory/time, slow parsing, or fill local temp storage. File count caps exist, but byte caps do not. | `lib/google-drive.ts:300`, `lib/processing-preview.ts:604`, `lib/preview-file-snapshots.ts:66`, `app/api/drive/files/[fileId]/route.ts:25` | Enforce maximum bytes from Drive metadata before download. Stream downloads with a hard cap where possible. Add different limits for PDFs and images, return a clear review-only error for oversized files, and configure Vercel function limits accordingly. | Code, Vercel |
| PDF/OCR parsing runs on untrusted documents without strong sandboxing, timeouts, or memory caps. | Medium | Malformed or hostile PDFs/images can trigger parser crashes, CPU spikes, memory pressure, or subprocess hangs. The code cleans up temp files, but parsing still runs in the app/server runtime or local subprocesses. | `lib/document-intelligence.ts:449`, `lib/document-intelligence.ts:590`, `lib/document-intelligence.ts:602`, `lib/document-intelligence.ts:1076`, `lib/document-intelligence.ts:1106`, `lib/document-intelligence.ts:1132`, `scripts/extract_pdf_content.py`, `scripts/extract_visual_text.swift`, `scripts/extract_pdf_form_fields.swift` | Add parser timeouts, max pages, max extracted text length, max field count/value length, `execFile` timeout/maxBuffer options, and a minimal environment for subprocesses. Long-term, isolate parsing/OCR in a separate worker/sandbox with constrained CPU/memory and a queue. | Code, Infra, Vercel |
| Temporary raw preview snapshots lack owner binding. | High | Snapshot IDs are random and validated for path safety, but metadata does not include `ownerEmail`, and the route only checks that a user is signed in. If a snapshot ID leaks, another authenticated user could fetch the raw temporary file within the 24-hour TTL. | `lib/preview-file-snapshots.ts:5`, `lib/preview-file-snapshots.ts:14`, `lib/preview-file-snapshots.ts:66`, `lib/preview-file-snapshots.ts:118`, `app/api/preview/files/[snapshotId]/route.ts:12` | Store `ownerEmail` in snapshot metadata, require the session owner to match on reads, chmod/private the temp directory where applicable, and consider disabling raw temp snapshots in multi-user production. | Code, Infra |
| Local preview/cache storage is not multi-user safe. | Medium | Non-Supabase mode writes a single `data/latest-preview.json` and local analysis cache files. This is acceptable for local development but not for shared production or multi-user preview deployments. The stored payload intentionally drops full diagnostic text from snapshots, but still includes sensitive excerpts, PDF fields, file IDs, client names, and debug metadata. | `lib/preview-snapshot.ts:50`, `lib/preview-snapshot.ts:215`, `lib/preview-snapshot.ts:349`, `lib/preview-analysis-cache.ts:60`, `lib/preview-analysis-cache.ts:188` | Fail closed in production unless Supabase/Postgres persistence is enabled. If local persistence remains for private demos, make it per-owner, encrypt sensitive cache files, and set clear retention/deletion behavior. | Code, Vercel |
| Diagnostic UI exposes extracted document content and PDF fields to the browser. | Medium | Intake and Clean Up diagnostic panels show extracted text, PDF fields, AI raw summaries, file IDs, and hashes. This is useful for debugging but too broad for least-privilege operation with sensitive RIA/client documents. | `app/preview/intake-queue.tsx:1168`, `app/preview/intake-queue.tsx:1218`, `app/preview/intake-queue.tsx:1231`, `app/cleanup/cleanup-planner.tsx:1721`, `app/cleanup/cleanup-planner.tsx:1747`, `app/cleanup/cleanup-planner.tsx:1760` | Gate diagnostics behind an admin/debug flag, redact values by default, hide raw extracted text in production, and require an explicit reveal/audit flow for sensitive fields. | Code, Vercel |
| Live file mutation is reachable through a GET route. | High | `GET /preview/auto-file` can move/rename high-confidence Drive files for the current session. Because browsers can navigate to GET URLs with cookies, this creates CSRF/accidental-trigger risk for a destructive file operation. | `app/preview/auto-file/route.ts:4`, `app/preview/actions.ts:30`, `app/preview/actions.ts:98` | Remove the GET mutation route or convert it to POST with CSRF protection and a user confirmation step. Keep destructive Drive operations in Server Actions or POST APIs only. | Code |
| No malware scanning or quarantine step was found. | Medium | Client-uploaded files from Drive may contain malware or active content. The app can download, cache, preview, and move these files without scanning or quarantine status. | Drive ingestion and preview pipeline: `lib/intake-refresh.ts`, `lib/processing-preview.ts`, `lib/google-drive.ts`, preview routes | Add a quarantine state for newly discovered files. At minimum, do not inline-preview unsupported types. Long-term, integrate malware scanning before previewing, filing, or allowing downloads. | Infra, Code |
| Drive folder and cleanup selections trust any folder/file IDs accessible to the connected token. | Medium | The app uses broad Google Drive write scope and lets the user choose or submit Drive folder/file IDs. This is functional, but it increases blast radius if a session is abused or if a user selects the wrong shared drive folder. | `app/setup/actions.ts:51`, `app/api/cleanup/browser/route.ts:32`, `lib/cleanup-preview.ts:176`, `lib/cleanup-preview.ts:230` | Validate selected folders server-side, store the connected Drive account/folder ownership context, and restrict cleanup/file actions to configured roots unless an explicit admin override is added. Long-term, consider narrower Drive authorization patterns such as app-selected folders or Google Picker-based grants if the product model allows it. | Code, Google Cloud |
| Supabase Storage bucket permissions are not currently used or defined in the repo. | Low | No bucket policies or signed URLs were found because raw files live in Google Drive and temporary local snapshots, not Supabase Storage. The risk is mostly configuration drift if buckets are later added outside code. | No `storage.objects`, bucket policy, `createSignedUrl`, or Supabase Storage client usage found in `app/`, `lib/`, or `supabase/`. | If Supabase Storage is added, create private buckets only, require owner/org path checks, disable public buckets for client docs, and document bucket policies in migrations. | Supabase, Infra |

### Severity summary

| Severity | Count | Summary |
| --- | ---: | --- |
| Critical | 1 conditional | Inline same-origin rendering of arbitrary Drive/snapshot content is critical if untrusted clients can place files in watched Drive folders. |
| High | 5 | Resource authorization, file type validation, file size limits, owner binding for temp snapshots, and GET-based destructive file mutation need fixes before real users. |
| Medium | 5 | Parser isolation, local cache posture, diagnostics exposure, malware scanning, and broad Drive folder/file selection need hardening. |
| Low | 1 | Supabase Storage is not in use; keep it private if added later. |

### Quick wins

1. Add a central file policy helper and block inline preview for anything outside the allowed MIME/extension/magic-byte set.
2. Add a download size limit before `downloadDriveFile()` reads the response into memory.
3. Add owner binding to preview file snapshot metadata and enforce it in `/api/preview/files/[snapshotId]`.
4. Remove or disable `GET /preview/auto-file`; require POST plus confirmation for file-moving actions.
5. Hide raw extracted text, PDF field values, file IDs, and AI raw summaries behind a production-off diagnostics flag.
6. Add iframe sandboxing and a restrictive preview response CSP after testing PDF/image rendering.
7. Return a clear unsupported-file status in Intake/Clean Up rather than downloading and snapshotting unsupported file types.

### Long-term improvements

1. Move parsing/OCR into an isolated worker or sandboxed job with CPU, memory, file size, page count, and execution time limits.
2. Add malware scanning or a quarantine workflow before raw previews, downloads, or file moves.
3. Replace broad raw file ID download routes with context-specific routes, such as `history event -> owner check -> file ID`, `preview item -> owner check -> file ID`, or `cleanup state -> owner check -> file ID`.
4. Keep raw document previews on a separate cookieless origin if inline rendering remains necessary.
5. Define a retention policy for raw temp snapshots, preview analysis cache, extracted text, PDF fields, canonical projections, and filing exports.
6. Revisit Google Drive OAuth scope and folder selection model to reduce blast radius where product requirements allow.
7. If Supabase Storage is introduced later, add private bucket migrations, RLS-compatible object ownership rules, and signed URL expiration tests before storing client documents there.

### Remaining questions before applying fixes

1. What file types should the product officially support for Intake and Clean Up in production: PDF only, PDF plus PNG/JPEG, or additional formats?
2. What maximum document size is acceptable for RIA/client workflows?
3. Should client-uploaded files be considered untrusted by default? The safe answer is yes, but it affects preview UX and malware-scanning priority.
4. Should raw document previews be available in production, or should the app show extracted metadata only until documents are opened directly in Drive?
5. Are Vercel preview deployments ever used with real client documents? If yes, local/preview raw snapshot behavior needs the same controls as production.

### Code changes made in this audit

No code changes were made. The recommended fixes touch preview rendering, file download authorization, and destructive file operations, so they should be implemented deliberately with regression tests rather than patched casually during the audit.

## Authorization & Access Control Audit

Date: 2026-05-18

### Scope reviewed

This pass reviewed App Router pages, API routes, server actions, middleware/proxy behavior, Google Drive resource access, owner-scoped database access helpers, Data Intelligence V2 reveal flows, local/Supabase preview persistence, and direct Postgres/Supabase assumptions. No database policies or production settings were changed.

### Current authorization model observed

The app currently uses authenticated NextAuth/Google sessions as the principal and uses `session.user.email` as the effective tenant boundary (`ownerEmail`). Most app-state reads and writes go through owner-scoped helpers such as `getFilingEventsByOwnerEmail`, `getFilingEventByOwnerAndId`, `getStorageConnectionByOwnerAndId`, `getCleanupFileStatesByOwnerAndFileIds`, and owner-scoped preview snapshot reads.

Drive authorization is looser: once a user has an active connected Drive token, several routes accept raw Drive file or folder IDs and rely on Google Drive access as the authorization check. That is acceptable for a private single-user demo, but it is not a strong app-level authorization model for shared drives, multi-user firms, client-uploaded folders, leaked IDs, or future org/account permissions.

No runtime Supabase service-role client or `SUPABASE_SERVICE_ROLE_KEY` usage was found during this pass. Supabase/Postgres access is server-side through `lib/postgres/server.ts`, which is guarded by `server-only` and a runtime browser check. However, because the runtime uses direct Postgres credentials, app code and/or a least-privileged DB role are the practical authorization boundary unless RLS is separately enforced and tested.

### 1. Critical risks

| Risk | Severity | Evidence | Impact | Required follow-up |
| --- | --- | --- | --- | --- |
| Supabase table access is conditionally critical if public Data API grants exist without RLS policies. | Critical if exposed; High otherwise | Direct Postgres helpers filter by `owner_email`, for example `lib/persistence/supabase-app-state-store.ts:349`, `lib/persistence/supabase-app-state-store.ts:648`, and `lib/persistence/supabase-app-state-store.ts:842`. The RLS audit already notes that RLS is not the primary runtime boundary. | If `anon` or `authenticated` Supabase roles can read/write these `public` tables directly, users could bypass app owner checks and access other owners' app state, tokens metadata, filing history, preview data, or document projections. | Supabase dashboard/schema change: verify grants, enable/force RLS where appropriate, use least-privileged DB credentials, and add policy tests before real users. |
| Same-origin arbitrary Drive/snapshot preview can become an authorization bypass if untrusted files execute in the app origin. | Critical for untrusted client-uploaded files; High otherwise | `app/api/drive/files/[fileId]/route.ts:30` and `app/api/preview/files/[snapshotId]/route.ts:25` return attacker-controlled bytes inline from the app origin. | A scriptable document that renders in a same-origin iframe could call authenticated same-origin APIs as the signed-in user. That is not a classic IDOR, but it can defeat every route-level auth check. | Code/Vercel change: restrict inline MIME types, sandbox previews, add preview CSP, and preferably serve untrusted file previews from a cookieless origin. |

No unconditional unauthenticated cross-user data leak was confirmed in the reviewed API routes. The highest concrete IDOR risks are authenticated resource access gaps around raw Drive IDs and temporary snapshot IDs.

### 2. Potential cross-user access vectors

| Vector | Severity | Details | Affected files/routes |
| --- | --- | --- | --- |
| Temporary raw preview snapshots are not owner-bound. | High | Snapshot metadata stores `sourceFileId`, name, MIME type, size, and timestamp, but not `ownerEmail`. The route only checks that a user is signed in before serving the bytes. A leaked snapshot ID would let another authenticated user fetch the raw temporary file until TTL expiry. | `lib/preview-file-snapshots.ts:5`, `lib/preview-file-snapshots.ts:66`, `lib/preview-file-snapshots.ts:118`, `app/api/preview/files/[snapshotId]/route.ts:12` |
| Raw Drive file proxy accepts any file ID accessible to the active Drive token. | High | The route authenticates and verifies an active connection, then downloads `fileId` directly from the URL. It does not prove the file belongs to the user's intake queue, cleanup state, configured folders, or owner-scoped filing history. | `app/api/drive/files/[fileId]/route.ts:13`, `app/api/drive/files/[fileId]/route.ts:22`, `app/api/drive/files/[fileId]/route.ts:25` |
| Clean Up browse/preview/analyze/run paths trust raw Drive folder/file IDs. | Medium to High | Browser and cleanup operations accept `folderId` or `selectedIds` from the client and operate on whatever the connected Drive token can access. This can reach files outside the configured app workspace, including shared drive content, if the token has access. | `app/api/cleanup/browser/route.ts:29`, `app/api/cleanup/browser/route.ts:35`, `app/api/cleanup/preview/route.ts:30`, `app/api/cleanup/analyze/route.ts:55`, `lib/cleanup-preview.ts:185`, `lib/cleanup-preview.ts:230`, `lib/cleanup-preview.ts:252` |
| Clean Up mutation route lacks route-local auth, relying on a helper. | Medium | `POST /api/cleanup/run` parses client IDs before calling `runCleanupPlanForIds`; the helper does authenticate through `approveFileItems`, but the route itself does not make that boundary obvious or testable. | `app/api/cleanup/run/route.ts:12`, `lib/cleanup-approval.ts:66`, `lib/file-approval.ts:84` |
| Clean Up apply and Intake approve routes lack route-local auth, relying on helpers. | Low to Medium | These are safer than `run` because helpers fetch owner-scoped cleanup states or preview snapshots before mutating files. Still, the route files themselves have no explicit auth guard, which increases regression risk when helpers change. | `app/api/cleanup/apply/route.ts:7`, `app/api/intake/approve/route.ts:8`, `lib/cleanup-approval.ts:25`, `lib/intake-approval.ts:118`, `lib/file-approval.ts:84` |
| Review decision action trusts hidden/client-submitted file metadata. | Medium | The action owner-scopes saved decisions, but it accepts `fileId`, `sourceName`, `mimeType`, detected client, folders, and filenames from form data without proving the file exists in the current owner snapshot or configured source folder before saving a decision/event. | `app/review/actions.ts:33`, `app/review/actions.ts:41`, `app/review/actions.ts:51`, `app/review/actions.ts:105` |
| Destructive auto-file operation is reachable through GET. | High | `GET /preview/auto-file` calls a server action path that can move/rename Drive files for the current session. This is more CSRF/unsafe-method than IDOR, but it weakens action authorization because a navigation can trigger file mutations. | `app/preview/auto-file/route.ts:4`, `app/preview/actions.ts:30`, `app/preview/actions.ts:98` |
| Local preview snapshot mode is not multi-user safe. | Medium | Non-Supabase persistence reads and writes one shared `data/latest-preview.json` regardless of owner. That should remain local-only/private-demo behavior. | `lib/preview-snapshot.ts:50`, `lib/preview-snapshot.ts:215` |
| Data Intelligence V2 uses owner-email scoping but no durable firm/client permission model. | Medium | V2 auth context sets `ownerEmail` and `allowedOwnerEmails` to the signed-in email and has a comment requiring replacement before broad production rollout. Reveal cards check same user/admin and owner scope, but role is session-derived/defaulted and global reveal enablement is config-based. | `lib/data-intelligence-v2/auth-context.ts:31`, `lib/data-intelligence-v2/auth-context.ts:33`, `lib/data-intelligence-v2/reveal-token-service.ts:377`, `lib/data-intelligence-v2/reveal-token-service.ts:392` |
| Reveal-card store retrieves by card ID before owner/user checks. | Low to Medium | Service-layer checks deny non-creator/non-owner access, but the Postgres store lookup is `reveal_card_id` only. If future code calls the store directly or RLS is absent, this weakens defense in depth. | `lib/data-intelligence-v2/postgres-reveal-token-store.ts:72`, `lib/data-intelligence-v2/reveal-token-service.ts:320` |
| Document projection cleanup deletes by `document_id` only. | Low to Medium | Current document IDs appear owner-derived and this is an internal ingestion path, not a public route. Still, destructive deletes should include `owner_email` or verify document ownership inside the transaction for defense in depth. | `lib/persistence/supabase-document-projection-store.ts:240`, `lib/persistence/supabase-document-projection-store.ts:272` |

### 3. APIs/routes missing ownership checks

| Route/action | Current auth check | Missing or weak authorization check | Severity | Recommended task |
| --- | --- | --- | --- | --- |
| `app/api/drive/files/[fileId]/route.ts` | Requires `auth()` and active storage connection. | Does not check owner-scoped app resource context for `fileId`. | High | Replace raw file ID access with context-specific download routes, or require proof that the file ID is present in an owner-scoped filing event, preview snapshot, cleanup state, or configured folder tree. |
| `app/api/preview/files/[snapshotId]/route.ts` | Requires `auth()`. | Snapshot is not bound to `ownerEmail`. | High | Add `ownerEmail` to snapshot metadata and require it to match the signed-in user before serving bytes. |
| `app/api/cleanup/browser/route.ts` | Requires `auth()` and connected storage. | Accepts arbitrary `folderId`, with no configured-root or allowed-tree validation. | Medium to High | Restrict browsing to configured destination/source roots by default, or add an explicit user-visible "browse all Drive" mode with separate confirmation and audit. |
| `app/api/cleanup/preview/route.ts` | Requires `auth()` and verified storage. | Accepts arbitrary `selectedIds` and passes them into Drive traversal. | Medium to High | Validate all selected IDs against allowed roots or a server-created selection context. |
| `app/api/cleanup/analyze/route.ts` | Requires `auth()` and verified storage. | Accepts arbitrary selected file/folder IDs; writes owner-scoped cleanup state for whatever Drive objects are accessible. | Medium to High | Validate selected IDs against allowed roots/current browser context before analysis and state writes. |
| `app/api/cleanup/run/route.ts` | Relies on `runCleanupPlanForIds` -> `approveFileItems` for auth. | No route-local guard; raw IDs are accepted and then used to build a Drive mutation plan. | Medium to High | Add route-local `auth()`/storage checks and root validation before planning/moving files. |
| `app/api/cleanup/apply/route.ts` | Relies on `applyCleanupSuggestionsForIds` -> `approveFileItems`. | No route-local guard. Resource access is mostly owner-scoped by cleanup state. | Low to Medium | Add route-local auth wrapper for consistency and tests that cross-owner file IDs are ignored/denied. |
| `app/api/intake/approve/route.ts` | Relies on `approvePreviewItemsForIds` -> `approveFileItems`. | No route-local guard. Resource access is mostly owner-scoped by preview snapshot. | Low to Medium | Add route-local auth wrapper and tests that file IDs outside the owner's snapshot cannot be approved. |
| `app/preview/auto-file/route.ts` | `prepareReadyItemsFilingRedirect` requires session and storage. | Uses GET for a destructive Drive mutation path. | High | Remove the GET mutation route or convert it to POST with CSRF protection and explicit confirmation. |
| `app/review/actions.ts` (`saveReviewDecisionAction`) | Requires session and writes under `ownerEmail`. | Does not verify submitted `fileId`/metadata against the owner's current snapshot/source folder before saving. | Medium | Re-read the file from the owner snapshot or Drive source folder and derive server-trusted metadata before saving decisions/events. |
| `app/setup/actions.ts` (`saveFirmSettings`) | Requires session and writes under `ownerEmail`. | Folder IDs/names are submitted from the client and not re-validated against Drive before save. | Medium | Verify selected folders server-side with the active Drive token, persist canonical folder metadata from Drive, and reject inaccessible/non-folder IDs. |
| `app/api/data-intelligence/v2/qa/preview-smoke/route.ts` | Preview-environment and shared-secret gated. | Not session-bound. | Low to Medium | Keep preview-only, ensure it never touches real owner data, rotate the QA secret if shared, and add a rate limit. |

Routes with stronger owner checks observed:

| Route/action | Why it looks safer |
| --- | --- |
| `app/api/history/paths/[eventId]/route.ts` | Looks up `eventId` with `getFilingEventByOwnerAndId(session.user.email, eventId)` before returning paths. |
| `app/api/history/export/route.ts` | Exports events from `getFilingEventsByOwnerEmail(session.user.email)` and active storage provider. |
| `app/api/storage/connections/route.ts` | Returns safe connection fields from `getSafeStorageConnectionsByOwnerEmail(ownerEmail)`. |
| `app/setup/google-drive/actions.ts` and `app/actions/set-active-storage.ts` | Validate connection ID with `getStorageConnectionByOwnerAndId(ownerEmail, connectionId)` before switching active storage. |
| `app/api/query-assistant/route.ts` | Requires session and passes only `ownerEmail: session.user.email` into the assistant path. |
| `app/api/data-intelligence/v2/chat/route.ts` and `app/api/data-intelligence/v2/reveal/route.ts` | Build auth context from the session and enforce owner/reveal service checks; still need a durable firm/client role model before production. |

### 4. Middleware weaknesses

| Weakness | Severity | Evidence | Recommended task |
| --- | --- | --- | --- |
| No central protected-route allowlist/denylist exists. | Medium | `proxy.ts:8` only performs canonical host redirect and otherwise returns `NextResponse.next()`. | Add a route manifest or middleware/proxy-level default auth guard for protected pages/APIs, with explicit public routes (`/`, `/login`, NextAuth callbacks, health/static assets). |
| Auth is enforced ad hoc in each route/page/helper. | Medium | Some routes call `auth()` directly; others rely on helper functions that call `auth()` later. | Add a shared `requireApiSession()`/`requireOwnerContext()` wrapper and tests that every non-public API returns 401 when unauthenticated. |
| Unsafe HTTP method is allowed for file mutation. | High | `GET /preview/auto-file` triggers `executeFilingBatch`. | Block state-changing operations from GET, add CSRF protection/confirmation for Drive mutations, and add tests for method handling. |
| No central resource authorization helper exists for Drive IDs. | High | Drive file/folder IDs are validated by Google token access, not app ownership context. | Create a Drive resource authorization service that accepts `{ownerEmail, connectionId, fileId/folderId, purpose}` and verifies configured root, snapshot, cleanup state, or filing event membership. |

### 5. Recommended authorization model

1. Define a durable principal and tenant model:
   - MVP/private mode: `ownerEmail` remains the tenant boundary.
   - Production mode: introduce `firm_id`/`org_id`, membership, roles, and per-client/account permissions.
   - Do not derive admin/advisor/readonly roles from mutable client-visible session fields alone.

2. Require every protected API route and server action to start from an explicit server context:
   - `userId`
   - `userEmail`
   - `ownerEmail` or `firmId`
   - active storage connection ID
   - role and capability set

3. Treat Drive IDs as untrusted object references:
   - A Drive file/folder ID is authorized only if it is in an owner-scoped preview snapshot, owner-scoped cleanup state, owner-scoped filing event, or verified descendant of a configured root for the requested operation.
   - Browsing all Drive should be an explicit elevated mode with clear UX and audit trail, not the default authorization boundary.

4. Make file download routes context-specific:
   - `history event ID -> owner check -> Drive file ID`
   - `preview item/snapshot ID -> owner check -> raw preview bytes`
   - `cleanup state ID -> owner check -> Drive file ID`
   - Avoid public-shaped routes where possession of a raw `fileId` or `snapshotId` is enough.

5. Add database defense in depth:
   - Use least-privileged Postgres credentials from Vercel.
   - Enable and test RLS for every owner-scoped table before exposing Supabase Data API access.
   - Include `owner_email`/`firm_id` predicates in destructive internal writes where practical, even if identifiers are currently owner-derived.
   - Use `security_invoker` views for any views that should honor RLS.

6. Add tests for authorization invariants:
   - unauthenticated route matrix
   - cross-owner filing event ID denied
   - cross-owner preview snapshot ID denied
   - cleanup/Drive selected ID outside configured root denied
   - review decision cannot be saved for a file outside the owner snapshot/source folder
   - destructive endpoints reject GET

### 6. Immediate fixes vs architectural fixes

#### Immediate fixes

| Task | Severity | Change type |
| --- | --- | --- |
| Add `ownerEmail` to `lib/preview-file-snapshots.ts` metadata and enforce it in `app/api/preview/files/[snapshotId]/route.ts`. | High | Code |
| Replace or constrain `app/api/drive/files/[fileId]/route.ts` so raw file IDs are only served through owner-verified contexts. | High | Code |
| Restrict Clean Up browse/preview/analyze/run selections to configured owner roots or a server-created selection context. | High | Code |
| Remove/disable `GET /preview/auto-file`; require POST plus CSRF/confirmation for file-moving actions. | High | Code |
| Add route-local auth wrappers to `cleanup/run`, `cleanup/apply`, and `intake/approve`, even though helpers currently enforce auth. | Medium | Code |
| Re-validate setup folder IDs with Drive metadata before saving source/destination folders. | Medium | Code |
| Verify Supabase table grants and RLS status in the Supabase dashboard before using this with real users. | Critical/High | Supabase |
| Ensure production/preview deployments do not use local `data/latest-preview.json` mode with real client documents. | Medium | Vercel/code |

#### Architectural fixes

| Task | Severity | Change type |
| --- | --- | --- |
| Introduce a firm/org membership and role model instead of treating `ownerEmail` as the long-term tenant model. | High | Code, Supabase |
| Build a central authorization service for app resources: Drive files, folders, preview snapshots, cleanup states, filing events, clients, accounts, and documents. | High | Code |
| Move Data Intelligence reveal authorization to durable firm/client/account permissions, not global config and session-defaulted role. | High | Code, Supabase |
| Add RLS policies and policy tests for app-state tables, document projection tables, preview/cache tables, storage connection metadata, and reveal/audit tables. | High | Supabase |
| Put raw file previews on a separate cookieless origin or a hardened preview service. | High | Code, Vercel |
| Add a production authorization test suite to CI that uses two test users/owners and intentionally tries cross-owner IDs. | Medium | Code, CI |

### Code changes made in this audit

No application code changes were made. This was kept to a documentation update because the remaining fixes affect route contracts, Drive authorization semantics, and Supabase policy assumptions and should be implemented with regression tests.

## Google Drive OAuth & Token Audit

Date: 2026-05-18

### Scope reviewed

This pass reviewed Google OAuth login/storage connection routes, NextAuth session callbacks, persisted storage-connection stores, token refresh paths, disconnect/remove behavior, Drive API helpers, setup/intake/cleanup/dashboard/history access checks, cached queue logic, shared-drive handling, and token logging/exposure paths. No OAuth scopes, env vars, tokens, or production settings were changed.

### 1. OAuth scope review

| Area | Finding | Severity | Evidence | Recommended follow-up |
| --- | --- | --- | --- | --- |
| Base sign-in scope | Normal Google sign-in requests only `openid email profile`, which is appropriate for login. | Low | `auth.ts:81` | Keep login and storage consent separate. |
| Storage connection scope | The dedicated storage OAuth flow requests full Google Drive scope, plus identity scopes and offline access. | High | `app/api/storage/google/start/route.ts:33`, `app/api/storage/google/start/route.ts:40`, `lib/google-drive.ts:3` | Before real users, decide whether the product truly needs `https://www.googleapis.com/auth/drive`. If possible, move toward narrower access such as selected-file/folder workflows, `drive.file`, or a Google Picker/app-folder model. If full Drive remains required, document it clearly and add stricter in-app resource authorization. |
| Legacy/unused Drive connect button | `GoogleDriveConnectButton` also requests full Drive scope through NextAuth client `signIn`, but no current import usage was found. | Medium | `components/google-drive-connect-button.tsx:19`, `components/google-drive-connect-button.tsx:27` | Remove the unused component or ensure it cannot be reintroduced without the same server-side storage-token handling and review as `/api/storage/google/start`. |
| OAuth state protection | Storage OAuth uses a random state cookie, `httpOnly`, `sameSite=lax`, 10-minute TTL, and secure cookies in production. | Low | `app/api/storage/google/start/route.ts:31`, `app/api/storage/google/start/route.ts:45`, `app/api/storage/google/callback/route.ts:39`, `app/api/storage/google/callback/route.ts:51` | Keep this. Consider binding state to the signed-in user ID/email or adding PKCE for defense in depth, even though this is a server-side confidential-client flow. |
| Multi-account consent | `prompt=consent select_account` allows connecting a Google Drive account different from the app login email. This is a product feature, but also an authorization assumption. | Medium | `app/api/storage/google/start/route.ts:37`, `app/api/storage/google/callback/route.ts:100` | Keep only if intentional. Add UI/audit language that storage account and app account may differ, and consider firm/domain allowlists for production. |

### 2. Token handling risks

| Risk | Severity | Evidence | Impact | Recommended follow-up |
| --- | --- | --- | --- | --- |
| OAuth access token is exposed on the browser-visible NextAuth session object. | High | `auth.ts:115`, `auth.ts:116`, `types/next-auth.d.ts:4`, `types/next-auth.d.ts:5` | NextAuth session JSON is intended for browser consumption. Even though current app components mostly pass only safe user fields to client components, any future `useSession()` call or `/api/auth/session` fetch could expose the Google OAuth access token to browser JavaScript. | Remove `session.accessToken` from the session callback. Keep provider tokens in the JWT/server-only callback or persisted encrypted storage-connection records, and expose only booleans/scopes/status needed by UI. |
| Refresh token is stored in the NextAuth JWT cookie when Google returns one. | Medium | `auth.ts:91`, `auth.ts:92`, `types/next-auth.d.ts:16`, `types/next-auth.d.ts:22` | NextAuth JWT cookies are HTTP-only, but a refresh token in a session cookie still increases blast radius if cookie/session encryption secrets are compromised. | Avoid using NextAuth login as the Drive token store. Prefer the dedicated server-side storage-connection flow and keep refresh tokens out of browser-session-shaped data. |
| Supabase/Postgres storage tokens are encrypted at rest, but depend on one app encryption key. | Medium | `lib/persistence/supabase-app-state-store.ts:201`, `lib/persistence/supabase-app-state-store.ts:1157`, `lib/persistence/supabase-app-state-store.ts:1158`, `lib/crypto/server-encryption.ts:25` | This is the safer production path, but compromise or loss of `APP_ENCRYPTION_KEY` affects every stored Drive token. There is no key versioning or rotation path in code. | Confirm `APP_ENCRYPTION_KEY` is set only in server environments, back it up safely, and add a key-rotation plan with versioned ciphertext before real users. |
| SQLite/local persistence stores Drive access and refresh tokens in plaintext. | High if used outside local development; Low for isolated local dev | `lib/persistence/sqlite-app-state-store.ts:167`, `lib/persistence/sqlite-app-state-store.ts:176`, `lib/persistence/sqlite-app-state-store.ts:177`, `lib/persistence/sqlite-app-state-store.ts:1696` | If SQLite persistence is used on a shared machine, preview deployment, or production-like host, Drive tokens are readable from the database file. | Fail closed in production/preview unless Supabase encrypted persistence is enabled. Do not use SQLite persistence with real client documents or real Drive tokens outside a locked local dev environment. |
| Storage connection removal deletes local token records but does not revoke Google OAuth grants. | High | `app/setup/actions.ts:120`, `app/setup/actions.ts:139`, `lib/persistence/supabase-app-state-store.ts:1307`, `lib/persistence/sqlite-app-state-store.ts:1743` | Removing storage from the app does not invalidate the token at Google. A still-valid refresh token could remain active outside the app, and user expectations may not match reality. | Add a server-side revoke/disconnect flow that calls Google's token revoke endpoint before deleting local records, handles failure safely, and tells users when manual Google Account revocation is still required. |
| Removing storage may be undone by a still-Drive-scoped NextAuth session. | Medium to High | `lib/storage-connections.ts:132`, `lib/storage-connections.ts:293`, `lib/storage-connections.ts:327`, `lib/storage-connections.ts:334` | If the user's NextAuth session still contains Drive-scoped access, `syncSessionGoogleConnection` can recreate a removed connection. This is most relevant to the legacy NextAuth Drive consent path. | Stop syncing Drive access from browser-visible NextAuth sessions, or add an explicit tombstone/revoked state so user-removed connections are not recreated from an existing session token. |
| Token refresh failure marks a connection `needs_reauth` but preserves old token material. | Medium | `lib/storage-connections.ts:238`, `lib/storage-connections.ts:239`, `lib/storage-connections.ts:275`, `lib/storage-connections.ts:359` | Keeping old encrypted tokens may help recovery, but stale tokens remain in storage after invalidation and can create confusing state. | On confirmed invalid-grant/revocation responses, clear token ciphertext or store a revocation marker while preserving non-sensitive account metadata. |

### 3. Storage/security findings

| Finding | Severity | Evidence | Notes / impact | Recommended follow-up |
| --- | --- | --- | --- | --- |
| Browser-facing storage connection API returns safe fields only. | Low | `app/api/storage/connections/route.ts:18`, `app/api/storage/connections/route.ts:28` | It returns account labels, IDs, provider, and primary status, not access or refresh tokens. | Keep this pattern and add a test that token fields never appear in JSON. |
| Current UI passes safe session-derived identity fields to client components, but the underlying session object includes token fields. | Medium | `components/product-shell.tsx:21`, `components/product-shell.tsx:26`, `components/account-menu.tsx:10` | `ProductShell` is a server component and passes only display name/email/image-derived values to `AccountMenu`, which is good. The problem is the NextAuth session API shape, not current prop usage. | Sanitize the session callback and add a lint/test guard against passing full `Session` objects to client components. |
| OAuth callback does not log token responses. | Low | `app/api/storage/google/callback/route.ts:65`, `app/api/storage/google/callback/route.ts:79`, `app/api/storage/google/callback/route.ts:100` | No token JSON logging was found in the callback route. | Keep it that way. Continue redacting Google error text before logging or returning it. |
| Safe logging helper redacts bearer tokens, JWTs, secrets, cookies, and emails. | Low | `lib/safe-logging.ts:5`, `lib/safe-logging.ts:12`, `lib/safe-logging.ts:15` | Useful defense, but some API routes still return raw Google error messages to the browser. | Return generic user-facing errors for Drive API failures and log only safe metadata server-side. |
| Drive file/folder IDs are treated as stable app identifiers across account switches. | Medium | Cleanup/file state and filing history are owner/provider scoped more than connection scoped: `app/history/page.tsx:53`, `app/history/page.tsx:62`, `lib/persistence/supabase-app-state-store.ts:648`, `lib/persistence/supabase-app-state-store.ts:831` | Multiple Google accounts under one app owner can share one provider namespace. Old queue/history/cleanup state can appear under a newly active Google account. | Store `storage_connection_id` or external account identity on settings, snapshots, cleanup states, filing events, and cache rows, then filter by active connection. |
| Setup stores folder IDs/names from client-submitted form values without re-validating the selected folder server-side. | Medium | `app/setup/actions.ts:51`, `app/setup/actions.ts:72` | A stale or forged folder ID can be saved for the owner and later fail or target an unintended accessible folder. | Re-load folder metadata with the active token in `saveFirmSettings`, verify MIME type is folder, and persist canonical Drive metadata from Google. |

### 4. Session consistency issues

| Area | Current behavior | Risk | Severity | Recommended follow-up |
| --- | --- | --- | --- | --- |
| Dashboard | Uses cached storage connection status and shows cached preview/history if status is `connected`. | A revoked/expired Drive token can still leave Dashboard showing stale Drive-derived app state until a live route verifies access. | Medium | Show cached data explicitly as cached, include last verified time, and trigger a lightweight server verification when status is uncertain/stale. |
| Intake page | Uses cached connection status to enable auto-refresh and reads the owner preview snapshot directly. Live refresh does verify Drive access. | Intake can appear stale: old queue snapshot stays visible while refresh fails or marks storage as needing reconnect. | Medium | Tie preview snapshots to storage connection ID and last successful refresh. If refresh fails auth, clear or label the queue as stale rather than leaving it looking live. |
| Cleanup page | Uses cached status to show the planner; browser/preview/analyze APIs perform live access checks. | UI can show an interactive planner even when the token is revoked; the first API action then fails. | Medium | Have the page use verified status or a lightweight health endpoint before enabling live browser controls. |
| Cleanup browser API | Uses `getActiveStorageConnectionForSession`, then catches Google access errors, but does not mark the connection `needs_reauth` on list failure. | A revoked token can repeatedly fail without updating persisted connection status. | Medium | Use `getVerifiedActiveStorageConnectionForSession` or call `markStorageConnectionNeedsReauth` on Google auth failures. |
| History/export | Page uses cached status; export and path APIs use verified storage when needed. | History can show stale provider-scoped events for a previous active Google account. | Low to Medium | Filter by active storage connection/account, not only provider. |
| Reconnect flow | Reconnect refreshes/saves tokens and preserves an existing refresh token if Google does not return a new one. | This helps continuity, but does not explicitly invalidate old session-derived tokens or stale local UI state. | Medium | After reconnect/remove/switch, revalidate all Drive-backed pages and invalidate owner/connection-specific caches. |
| Session expiration | NextAuth refreshes provider access token when `expiresAt` is close, if a refresh token exists. Storage connections refresh persisted tokens separately. | Two refresh mechanisms can disagree, especially when one path has no refresh token. | Medium | Choose one canonical Drive token source for storage operations. Prefer persisted encrypted storage connections and keep NextAuth session tokens out of storage authorization. |

### 5. Cached auth/state risks

| Risk | Severity | Evidence | Recommended follow-up |
| --- | --- | --- | --- |
| Local preview snapshot is global and not connection scoped. | Medium | `lib/preview-snapshot.ts:50`, `lib/preview-snapshot.ts:215` | Do not use local snapshot mode with real client data. In Supabase mode, add `storage_connection_id` and source/destination folder IDs to the snapshot row and enforce them on reads. |
| Owner-scoped snapshots and cleanup states are not active-connection scoped. | Medium | `app/preview/intake-workspace-page.tsx:47`, `lib/intake-refresh.ts:122`, `lib/persistence/supabase-app-state-store.ts:648` | Persist and filter queue/state by active storage connection, source folder, and destination root. Clear or archive stale state on connection switch/removal. |
| Session-storage guard can suppress repeated Intake refresh attempts in one browser page lifetime. | Low | `app/preview/intake-auto-refresh.tsx:20`, `app/preview/intake-auto-refresh.tsx:47`, `app/preview/intake-auto-refresh.tsx:50` | This prevents loops, but after auth failure the UI should show an explicit stale/reconnect state and offer a retry after reconnect. |
| Storage connection status is updated mostly by live API paths, not by page loads. | Medium | Cached page checks: `app/dashboard/page.tsx:24`, `app/preview/intake-workspace-page.tsx:35`, `app/cleanup/clean-up-workspace-page.tsx:21`, `app/setup/page.tsx:63` | Add a central `last_verified_at`/`verification_status` and verify on a safe cadence, not only when a user initiates a live operation. |
| Shared-drive support is partial and inconsistent. | Medium | Folder children list includes all drives: `lib/google-drive.ts:151`. Setup folder listing does not: `lib/google-drive.ts:107`. Folder details/path helpers vary: `lib/google-drive.ts:504`, `lib/google-drive.ts:427`. | Decide whether shared drives are supported. If yes, add `supportsAllDrives`/`includeItemsFromAllDrives` consistently for list/get/move/create/path operations and store `driveId` context. If no, explicitly block shared-drive IDs. |
| No detached background sync was found. | Low | No Vercel cron config was found; current auto-refresh is client-initiated and current auto-file uses the signed-in user's session path. | If background sync is added, require an explicit per-owner connection authorization model, token refresh policy, audit trail, and kill switch. |

### 6. Recommended hardening steps

#### Immediate code hardening

1. Remove `accessToken` from the browser-visible NextAuth session callback in `auth.ts`; expose only `driveConnected`, `driveWritable`, safe status, and non-sensitive scope labels if needed.
2. Make the dedicated `/api/storage/google/start` flow the only supported Drive consent path; remove or quarantine the unused `GoogleDriveConnectButton`.
3. Add a real disconnect/revoke flow: call Google's token revoke endpoint, then delete local encrypted tokens, then revalidate Drive-backed pages.
4. Prevent `syncSessionGoogleConnection` from recreating user-removed connections from a still-scoped NextAuth session.
5. Fail closed in preview/production if `PERSISTENCE_BACKEND` is not Supabase/Postgres encrypted persistence and real Drive tokens are present.
6. Revalidate setup folder IDs server-side before saving settings.
7. Mark connections `needs_reauth` whenever any Drive API route receives a confirmed Google auth failure.

#### Product/security hardening

1. Reassess full Drive scope before real client usage. If full Drive remains necessary, document why and compensate with strict app-level file/folder authorization.
2. Add `storage_connection_id`, Google account identity, source folder ID, and destination folder ID to preview snapshots, cleanup state, filing events, caches, and history filters.
3. Add a connection switch/removal cleanup policy: archive or hide stale queue/cleanup state for the old connection unless the user switches back.
4. Add `last_verified_at` and `last_auth_failure_at` to storage connections and use those fields in Dashboard, Intake, Cleanup, and Setup UI.
5. Add shared-drive support intentionally: either consistently support it with `driveId` and `supportsAllDrives`, or block shared-drive folders/files with clear UX.
6. Add tests that assert browser JSON never includes `accessToken`, `refreshToken`, bearer tokens, OAuth responses, or token ciphertext.
7. Add integration tests for revoke/reconnect/account-switch scenarios:
   - revoked token moves connection to `needs_reauth`
   - removed connection is not recreated from session
   - reconnect updates encrypted token material and revalidates pages
   - switching Google accounts hides prior account queue/history/cleanup state unless explicitly selected

### Code changes made in this audit

No application code changes were made. The recommended Drive/OAuth fixes affect session shape, token storage, and disconnect behavior and should be implemented with regression tests to avoid breaking legitimate auth and storage flows.

## AI Privacy & Sensitive Data Exposure Audit

Date: 2026-05-18

### Scope reviewed

This pass reviewed AI/model call sites, prompt construction, structured output handling, document extraction artifacts, preview/cache persistence, browser-visible state, debug tooling, logging, analytics/error-reporting dependencies, temporary files, and generated artifacts. I did not inspect raw client documents or print sensitive values.

### 1. Data exposure vectors

| Vector | Severity | Evidence | Impact | Recommended follow-up |
| --- | --- | --- | --- | --- |
| AI Primary Parser sends extracted document text to an OpenAI-compatible endpoint when enabled. | High | `lib/ai-primary-parser.ts:338`, `lib/ai-primary-parser.ts:374`, `lib/ai-primary-parser.ts:381`, `lib/ai-primary-parser.ts:584` | Raw file bytes are not sent, but up to 14,000 characters of extracted/normalized document text are included in the model prompt. Account statements, tax documents, and identity documents can contain names, addresses, account numbers, tax IDs, DOBs, balances, and other regulated client data. | Keep `AI_PRIMARY_PARSER` disabled for real client documents until a model-bound redaction layer runs before the prompt. If retained, send only bounded field-specific excerpts, redact identifiers first, and document the external processor/privacy posture. |
| Legacy Data Intelligence hybrid assistant can send user questions, history, conversation state, and deterministic retrieval results to an OpenAI-compatible endpoint. | High | `lib/data-intelligence-assistant.ts:145`, `lib/data-intelligence-assistant.ts:210`, `lib/data-intelligence-model-orchestrator.ts:185`, `lib/data-intelligence-model-orchestrator.ts:225`, `lib/data-intelligence-model-orchestrator.ts:352` | User prompts and retrieved results may include client names and, for some intents, sensitive returned facts. There is some account-number policy logic, but this legacy flow does not have the same broad model-bound sanitizer/reveal-card boundary as V2. | Disable `DATA_INTELLIGENCE_AI_ENABLED` for real client use or migrate all client-specific AI interactions to the V2 tool/reveal architecture. Add explicit redaction before both interpretation and composition prompts. |
| Data Intelligence V2 is safer but still intentionally sends client-confidential context to the model. | Medium | `lib/data-intelligence-v2/openai-model-adapter.ts:79`, `lib/data-intelligence-v2/openai-model-adapter.ts:145`, `lib/data-intelligence-v2/openai-model-adapter.ts:147`, `lib/data-intelligence-v2/tool-loop.ts:271`, `lib/data-intelligence-v2/field-catalog.ts:7` | V2 uses `store: false`, sanitizes model-bound payloads, and routes raw sensitive values through reveal cards. It still treats some client names, client IDs, document IDs, account last4, and operational context as model-eligible. That may be acceptable for private MVP usage, but it is still third-party data sharing. | Decide which fields are acceptable for model exposure. Consider pseudonymous client labels and server-side ID mapping for production. Add tests proving raw SSNs, full account numbers, DOBs, addresses, tax IDs, raw file IDs, OAuth tokens, and keys cannot enter model payloads. |
| Preview analysis cache persists extracted text/debug artifacts. | High | `lib/preview-analysis-cache.ts:17`, `lib/preview-analysis-cache.ts:25`, `lib/preview-analysis-cache.ts:127`, `lib/preview-analysis-cache.ts:270`, `lib/document-intelligence.ts:1369` | `insight_json` stores `DocumentInsight`, including `diagnosticText`, `textExcerpt`, PDF field values, AI debug, file IDs, and extracted metadata. Supabase canonical JSON is redacted, but the insight cache is still high-sensitivity. Local cache also stores fuller artifacts under `data/preview-analysis-cache`. | Do not persist `diagnosticText`, full PDF field values, or AI raw summaries in production caches. Add TTL/cleanup, owner/connection scoping, and encryption where retention is required. Keep only structured, minimally necessary fields. |
| Preview snapshots reduce but do not eliminate sensitive browser/persistence exposure. | Medium | `lib/preview-snapshot.ts:19`, `lib/preview-snapshot.ts:50`, `lib/preview-snapshot.ts:384`, `lib/preview-snapshot.ts:385` | Snapshot payloads intentionally drop `diagnosticText`, which is good. They still include excerpts, PDF field arrays, debug metadata, client names, file IDs, hashes, and classification output. | Keep the `diagnosticText: null` pattern. Also redact or omit PDF field values, hashes, file IDs, and AI raw/debug fields from production snapshots unless an admin debug flag is active. |
| Intake and Clean Up diagnostics expose extracted text and PDF fields to browser-visible UI. | High | `app/preview/intake-queue.tsx:1168`, `app/preview/intake-queue.tsx:1218`, `app/preview/intake-queue.tsx:1231`, `app/cleanup/cleanup-planner.tsx:1747`, `app/cleanup/cleanup-planner.tsx:1760` | Authenticated users can view raw extracted text, PDF fields, file IDs, hashes, model names, AI raw summaries, and raw detected values in diagnostics. This increases exposure through browser memory, screenshots, support recordings, extensions, and any future client-side logging. | Hide diagnostic panels in production by default. Add an admin/debug-only gate and redact values by default. Prefer field-level reveal/audit for sensitive facts instead of raw text panels. |
| Legacy query assistant can return sensitive facts directly in browser JSON. | High | `lib/query-assistant.ts:881`, `lib/query-assistant.ts:1020`, `lib/query-assistant.ts:1060`, `app/api/query-assistant/route.ts:67` | The legacy assistant can answer with full account numbers, DOBs, and addresses and include them in API responses. This may be intended for a trusted private tool, but it bypasses the V2 reveal-card model and makes sensitive values visible in browser/network responses. | Move sensitive-value queries to V2 reveal cards. In the legacy route, block or mask full account number, DOB, address, raw ID, and contact-value intents unless an audited server-side reveal flow is used. |
| V2 reveal endpoint intentionally returns raw sensitive values to the browser. | Medium to High | `lib/data-intelligence-v2/reveal-api-handler.ts:63`, `lib/data-intelligence-v2/reveal-api-handler.ts:68`, `lib/data-intelligence-v2/reveal-token-service.ts:27`, `lib/data-intelligence-v2/reveal-token-service.ts:517` | This is outside the model path and time-limited, which is good, but it still places raw values in browser/network memory. Browser-visible reveal is appropriate only with strong auth, audit, one-time use, no-store, short expiry, and clear UX. | Keep reveal values out of model payloads and logs. Add rate limits, ownership tests, short expiry, one-time use, copy-prevention UX where practical, and audit review before enabling for real users. |
| Temporary raw files and query-result artifacts exist briefly on disk. | Medium | `lib/document-intelligence.ts:449`, `lib/document-intelligence.ts:586`, `lib/document-intelligence.ts:1132`, `lib/document-intelligence.ts:1154`, `lib/postgres/server.ts:125`, `lib/postgres/server.ts:269`, `lib/postgres/server.ts:181` | PDF/OCR temp files and Postgres sync result files are cleaned up in `finally` paths, which is good. They still briefly contain raw document bytes or database rows on local/server temp storage. | Keep temp cleanup, add parser subprocess timeouts, restrict temp directory permissions where possible, and avoid sync worker temp result files for sensitive rows if an async query path can be used. |
| Raw preview file snapshots are retained in temp storage for 24 hours. | High | `lib/preview-file-snapshots.ts:14`, `lib/preview-file-snapshots.ts:15`, `lib/preview-file-snapshots.ts:66`, `app/api/preview/files/[snapshotId]/route.ts:18` | Raw document bytes are written to `os.tmpdir()` and can be served later by snapshot ID. The separate file-upload audit already notes missing owner binding. This is also a privacy-retention issue. | Bind snapshots to owner and active storage connection, reduce TTL for production, or disable raw temp snapshots when real client documents are used. |
| Filing/review history persists extracted classifier excerpts and metadata. | Medium | `app/preview/actions.ts:105`, `app/preview/actions.ts:136`, `app/review/actions.ts:257`, `app/review/actions.ts:302`, `lib/intake-approval.ts:73`, `lib/intake-approval.ts:114` | Filing events preserve excerpts, reasons, hashes, detected clients, account last4, tax year, document dates, and source metadata. This improves auditability but increases retention scope. | Define retention for filing events and keep excerpts minimal or redacted. Avoid persisting raw text excerpts unless they are necessary for operational review. |

### 2. External AI/data-sharing risks

| External system | Current behavior | Severity | Recommended follow-up |
| --- | --- | --- | --- |
| OpenAI-compatible Chat Completions for AI Primary Parser | Sends schema, file metadata, content source, and extracted/normalized text to `AI_PRIMARY_PARSER_API_URL` or the OpenAI default when `OPENAI_API_KEY`, `AI_PRIMARY_PARSER_MODEL`, and `AI_PRIMARY_PARSER` are configured. | High | Disable for real data until pre-prompt redaction exists. Document provider retention, DPA/BAA-style requirements as applicable, and tenant consent. |
| OpenAI-compatible Chat Completions for legacy Data Intelligence | Sends current question, recent history, conversation state, deterministic fallback plan, and sanitized deterministic result only partially. | High | Prefer V2 for real client data. If legacy remains, add `safe-memory` style redaction and block sensitive intents from model composition. |
| OpenAI Responses API for Data Intelligence V2 | Uses `store: false`, structured outputs, safe-memory validation, tool result sanitization, and reveal cards. | Medium | Keep as the preferred model path, but treat it as external data sharing. Review field catalog classifications before production and add regression tests around model-bound payload safety. |
| Google Drive APIs | Raw documents and metadata move through Google Drive by product design. The app downloads files server-side and writes/moves them through the user's Drive token. | Medium | This is expected, but needs stronger app-level resource authorization, narrower scopes where possible, and clear user-facing consent. |
| Supabase/Postgres | Stores app state, preview/cache data, audit events, reveal-card metadata, and document projections. Raw token values are encrypted in Supabase persistence, and selected raw identifiers are encrypted. | Medium | Verify RLS/grants, retention, backups, logs, and encryption-key rotation. Treat preview cache JSON as high-sensitivity until minimized. |
| Analytics/error reporting | No Sentry, PostHog, Vercel Analytics, or Speed Insights package/import usage was found in `package.json`, `app/`, `components/`, or `lib/`. | Low | Keep analytics/error reporting absent or add an allowlisted, redacted event schema before enabling any third-party telemetry. |
| Codex/OpenAI developer tooling | No in-app Codex API integration was found. Local evaluation scripts use fake/synthetic data and production guards for OpenAI eval mode. | Low | Keep real client files out of eval/smoke fixtures. Add a documented rule that support/debug runs must not paste raw client document text into developer tools. |

### 3. Logging/privacy findings

| Finding | Severity | Evidence | Recommended follow-up |
| --- | --- | --- | --- |
| Safe logging helper exists and redacts common tokens, secrets, JWTs, database URLs, and emails. | Low | `lib/safe-logging.ts:5`, `lib/safe-logging.ts:12`, `lib/safe-logging.ts:35` | Keep using `getSafeErrorMetadata` for server logs. Add tests for AI provider errors, Google errors, and parser errors. |
| Data Intelligence debug logging is non-production and summarizes shape/counts, not raw payloads. | Low | `app/api/query-assistant/route.ts:50`, `app/api/query-assistant/route.ts:60`, `app/api/query-assistant/route.ts:84` | Keep this non-production only. Avoid logging debug trace contents because traces can include executed questions/plans and source counts. |
| AI Primary Parser provider error messages can include provider response snippets. | Medium | `lib/ai-primary-parser.ts:598`, `lib/ai-primary-parser.ts:600`, `lib/ai-primary-parser.ts:766` | Provider error bodies usually should not include the submitted prompt, but do not rely on that. Store/log only status, model, endpoint category, attempt, timeout, and body length; avoid persisting provider response text in `aiFailureReason`. |
| Some API routes return raw `Error.message` to the browser. | Medium | `app/api/cleanup/preview/route.ts:57`, `app/api/cleanup/analyze/route.ts:105`, `app/api/cleanup/run/route.ts:62`, `app/api/cleanup/apply/route.ts:36` | Return generic user-facing errors and log safe metadata server-side. Parser, Drive, or database error messages can accidentally contain file names, IDs, or sensitive operational details. |
| Vercel/Supabase logs should be treated as sensitive even without explicit payload logging. | Medium | Server logs include route errors and audit events; Supabase stores/query logs may expose owner emails, IDs, table names, and metadata counts. | Do not log request bodies, extracted text, model prompts, tool outputs, or reveal values. Configure log retention conservatively and restrict access to production logs. |
| Local scripts can print database summaries or JSON when manually run. | Low to Medium | `scripts/inspect-firm-document-sqlite.mjs:297`, `scripts/inspect-firm-document-sqlite.mjs:367`, `scripts/evaluate-data-intelligence-v2.mjs:158` | Keep scripts local/admin-only. Add warnings that inspection scripts may print sensitive extracted metadata and should not be used with real client databases in shared terminals. |

### 4. Recommended redaction boundaries

1. External AI/model prompts: never include raw document bytes, `diagnosticText`, full PDF field dumps, SSNs, tax IDs, full account numbers, DOBs, street addresses, phone numbers, emails, raw identity numbers, OAuth tokens, API keys, source file IDs, Drive links, or direct storage paths.
2. Model-safe client context: allow only the minimum needed to answer the task. Prefer pseudonymous client labels, account type, institution category, masked/last4 account identifiers, document type, status booleans, and coarse dates where possible.
3. Browser-visible state: do not send raw extracted text, PDF fields, AI raw summaries, debug traces, file hashes, raw file IDs, or provider error snippets unless an admin/debug flag is active and the user explicitly opens diagnostics.
4. Logs/audit events: record counts, statuses, durations, route names, model names, feature flags, hashed identifiers, and safe error classes. Do not log prompts, request bodies, tool outputs, model responses, extracted text, reveal values, OAuth responses, cookies, or session objects.
5. Persistence/cache: store structured normalized fields only when needed for workflow value. Encrypt reveal-only values, minimize excerpts, TTL preview caches, and avoid storing raw AI outputs.
6. Generated artifacts/reports: assume exports and filing history are client records. Include only operational metadata needed for audit, not raw extraction diagnostics.

### 5. Data minimization recommendations

1. Treat `DocumentInsight.diagnosticText`, `pdfFields`, `debug.aiRawSummary`, `debug.aiRawDetected*`, `fileId`, and raw `sourceName` as high-sensitivity data.
2. Stop writing `diagnosticText` and full PDF field values to `preview_analysis_cache.insight_json` in production. Keep them only in ephemeral local debug mode.
3. Add a retention policy for:
   - raw preview snapshots in `os.tmpdir()`
   - local `data/latest-preview.json`
   - local `data/preview-analysis-cache`
   - Supabase `preview_analysis_cache`
   - filing event excerpts
   - V2 audit events and reveal-card records
4. Prefer the V2 reveal-card architecture for sensitive fields and block legacy direct-answer paths for full account number, DOB, address, raw identity number, phone, email, SSN, and tax ID requests.
5. Keep OpenAI `store: false` for V2 and add equivalent privacy configuration/account-level controls for any provider used by legacy Chat Completions paths.
6. Separate debug views from operational user views. Production users should not see raw OCR/extracted text by default.
7. Add automated privacy tests that assert model-bound payloads, browser JSON, logs, snapshots, and cache rows do not contain representative sensitive patterns such as `[SSN]`, `[FULL_ACCOUNT_NUMBER]`, `[DOB]`, `[ADDRESS]`, `[EMAIL]`, `[TOKEN]`, and `[SOURCE_FILE_ID]`.

### 6. Immediate fixes vs future architecture improvements

#### Immediate fixes

| Task | Severity | Change type |
| --- | --- | --- |
| Keep `AI_PRIMARY_PARSER` and legacy `DATA_INTELLIGENCE_AI_ENABLED` off for real client documents until redaction and tests are in place. | High | Vercel/env policy |
| Gate Intake/Clean Up diagnostic panels behind a production-off admin/debug flag and redact extracted text/PDF fields by default. | High | Code, Vercel |
| Remove `diagnosticText`, full PDF field values, AI raw summaries, and provider response snippets from production preview caches. | High | Code, Supabase |
| Route legacy sensitive-value questions through V2 reveal cards or return a masked/not-supported response. | High | Code |
| Replace raw `Error.message` browser responses in cleanup routes with generic errors and safe server logs. | Medium | Code |
| Add owner/connection binding and shorter TTLs to raw preview file snapshots. | High | Code, Infra |
| Verify OpenAI/provider retention settings, data-use controls, and contracts before enabling external AI for real client data. | High | Manual/vendor |
| Add privacy regression tests for model prompts, API JSON responses, logs, and persisted preview cache shapes. | Medium | Tests |

#### Future architecture improvements

1. Make Data Intelligence V2 the only AI path for client-specific work, with field catalog reviews and enforced reveal cards for all sensitive values.
2. Introduce a PII vault pattern: store sensitive raw values encrypted, return only status/masked values to normal queries, and reveal raw values only through audited short-lived tokens.
3. Build a redaction/preprocessing layer for document extraction that creates model-safe excerpts before any LLM call.
4. Move parsing/OCR into a sandboxed worker with strict temp storage, memory, and time limits.
5. Add tenant/org/client-level permissioning so model tools and reveal cards are scoped beyond `ownerEmail`.
6. Add centralized privacy telemetry rules before introducing analytics or error reporting.
7. Define data retention and deletion workflows for cached AI outputs, extracted metadata, temp files, audit events, filing history, and generated reports.

### Code changes made in this audit

No application code changes were made in this pass. The audit identified privacy-sensitive flows that need deliberate redaction, caching, and feature-flag changes before real client usage.

## Production vs Development Exposure Audit

Date: 2026-05-18

Post-audit update on 2026-05-18: PROD-001 was mitigated in commit `6ca6753` (`fix(persistence): fail closed for production SQLite fallback`). Production-like runtimes now fail closed unless Supabase/Postgres encrypted persistence is configured. The persistent `data/*.sqlite` fallback is mitigated; the temporary projection SQLite bridge remains a separate follow-up tracked as PROD-007.

### 1. Production exposure risks

| Finding | Severity | Evidence | Impact | Recommended follow-up |
| --- | --- | --- | --- | --- |
| Production could fall back to local SQLite persistence if `PERSISTENCE_BACKEND` was missing. | Mitigated / monitor | Historical audit finding; mitigated by `6ca6753` in `lib/persistence/backend.ts` and `lib/runtime-environment.ts`. | Local SQLite is appropriate for development, but it stores app state and OAuth tokens in local files and is not a safe production or public-preview data boundary. The persistent fallback is now blocked in production-like runtimes. | Keep release verification that production and real-data previews set `PERSISTENCE_BACKEND=supabase`, a Supabase/Postgres URL, and `APP_ENCRYPTION_KEY`. Track the separate temp projection SQLite bridge as PROD-007. |
| Production safety checks for V2 audit/reveal storage are keyed to `NODE_ENV`, not the Vercel deployment environment. | Medium | `lib/data-intelligence-v2/config.ts:114`, `lib/data-intelligence-v2/config.ts:134`, `lib/data-intelligence-v2/service-factory.ts:191`, `lib/data-intelligence-v2/service-factory.ts:221` | Vercel normally sets `NODE_ENV=production`, so this is not an immediate Vercel production break. It is still a brittle boundary for production-like deployments, public previews, or any environment running real client data outside the exact Vercel default. | Add an explicit production-like helper that treats `VERCEL_ENV=production`, real-data previews, and any configured `APP_ENV=production/staging` as requiring durable Postgres audit/reveal stores. Type: Code and Vercel. |
| Intake/Clean Up diagnostics and preview/cache artifacts are not separated from production user workflows. | High | `app/preview/intake-queue.tsx:1168`, `app/cleanup/cleanup-planner.tsx:1747`, `lib/preview-analysis-cache.ts:127`, `lib/preview-snapshot.ts:384` | Debug-oriented extracted text, PDF fields, raw AI summaries, hashes, file IDs, and parser metadata can remain visible to authenticated production users and browser tooling. | Gate diagnostics behind an explicit server-side admin/debug flag that is off in production and public previews. Redact extracted values by default. Type: Code and Vercel. |
| No in-repo Vercel preview/production config was found. | Medium | No `vercel.json` present; `proxy.ts:12`, `lib/vercel-canonical-host.ts:13` | The app redirects production `.vercel.app` aliases to a canonical host, but preview deployment protection, branch-specific env scoping, and public preview access are manual Vercel configuration rather than enforced in repo. | Require Vercel Deployment Protection for previews containing real data, use branch-scoped Preview env vars, and document which preview branches may use real OAuth/OpenAI/Supabase resources. Type: Vercel/manual. |

### 2. Dangerous debug/dev tooling

| Tool or surface | Severity | Evidence | Current control | Recommended follow-up |
| --- | --- | --- | --- | --- |
| Data Intelligence V2 dev mock mode. | Medium | `lib/data-intelligence-v2/config.ts:37`, `lib/data-intelligence-v2/service-factory.ts:127`, `lib/data-intelligence-v2/service-factory.ts:136`, `lib/data-intelligence-v2/service-factory.ts:158` | Disabled by default and blocked when `NODE_ENV=production`. Mock fixtures are synthetic and server-side. | Also require `VERCEL_ENV !== "production"` and a positive local/dev flag. Consider refusing dev mock mode whenever real Supabase/Drive production env names are present. Type: Code. |
| Data Intelligence V2 eval/OpenAI fake-data mode. | Medium | `lib/data-intelligence-v2/config.ts:82`, `scripts/data-intelligence-v2-local-env.mjs:95`, `lib/data-intelligence-v2/eval/runner.ts:264`, `scripts/evaluate-data-intelligence-v2.mjs:75` | Uses fake data, disabled in `NODE_ENV=production`, and validates eval artifacts for unsafe sensitive patterns. | Keep eval scripts local/CI-only with synthetic data. Add a guard that refuses networked evals when `VERCEL_ENV` or production database env vars are present. Type: Code and CI policy. |
| Legacy Data Intelligence debug response/logging. | Medium | `app/api/query-assistant/route.ts:50`, `app/api/query-assistant/route.ts:60`, `app/api/query-assistant/route.ts:80` | Debug is disabled only when `NODE_ENV=production`; logs are shape/count metadata after prior cleanup. | Replace the implicit `NODE_ENV` gate with an explicit `DATA_INTELLIGENCE_DEBUG_ENABLED` flag and admin-only check. Keep it off in Preview/Production by default. Type: Code and Vercel. |
| Local SQLite inspection script can print sensitive database summaries. | Low to Medium | `package.json:11`, `scripts/inspect-firm-document-sqlite.mjs:280` | CLI-only and not web-routed. `data/` is gitignored. | Add a clear local-only warning or `--allow-sensitive-output` flag before use with real client data. Never run it in shared CI logs. Type: Code/process. |
| Synthetic corpus/evaluation generators are present but not exposed as app routes. | Low | `scripts/generate-synthetic-identity-corpus.mjs`, `scripts/generate-synthetic-statement-corpus.mjs`, `tests/synthetic-*` | Test data is synthetic and not routed through `app/api`. | Keep generated corpora under tests or ignored local artifacts. Do not seed real client examples into these fixtures. Type: Process. |
| Hidden debug/demo/admin/test endpoints were not found. | Low | `find app ...` found only `app/api/data-intelligence/v2/qa/preview-smoke/route.ts`; `app/security/page.tsx:3` redirects to `/setup`. | No obvious unauthenticated admin, seed, demo, test, or bypass route is present in `app/`. | Keep route inventory checks in CI or release checklist. Type: Tests/process. |

### 3. Preview deployment concerns

| Concern | Severity | Evidence | Impact | Recommended follow-up |
| --- | --- | --- | --- | --- |
| Preview QA endpoint is public-route addressable when enabled. | Medium | `app/api/data-intelligence/v2/qa/preview-smoke/route.ts:21`, `app/api/data-intelligence/v2/qa/preview-smoke/route.ts:25`, `app/api/data-intelligence/v2/qa/preview-smoke/route.ts:38` | The route is correctly limited to `VERCEL_ENV=preview` and requires a timing-safe secret, but it has no app session auth or rate limit. If the secret leaks, an attacker can run smoke checks and potentially drive OpenAI cost. | Keep `DATA_INTELLIGENCE_V2_PREVIEW_QA_ENABLED` Preview-only, rotate the QA secret after sharing, add basic rate limiting, and leave Vercel Deployment Protection on for previews. Type: Code and Vercel. |
| Preview QA can optionally use real OpenAI while still using fake data. | Low to Medium | `lib/data-intelligence-v2/preview-qa-service.ts:93`, `lib/data-intelligence-v2/preview-qa-service.ts:94`, `lib/data-intelligence-v2/preview-qa-service.ts:111`, `lib/data-intelligence-v2/preview-qa-service.ts:186` | The data gateway and sensitive provider are dev-mock/fake, which protects client data. The remaining risk is cost/abuse and any future drift that accidentally swaps fake data for real data. | Require a separate explicit flag for real-OpenAI preview QA, keep fake-data assertions, and add a test that preview QA never imports the existing real data gateway. Type: Code/tests. |
| The preview env configuration script enables V2, OpenAI, and sensitive reveal for Preview. | High | `scripts/configure-vercel-v2-preview-env.mjs:12`, `scripts/configure-vercel-v2-preview-env.mjs:17`, `scripts/configure-vercel-v2-preview-env.mjs:22`, `scripts/configure-vercel-v2-preview-env.mjs:120`, `scripts/configure-vercel-v2-preview-env.mjs:333` | The script is guarded by confirmation env vars and branch-scopes when a branch is available, but applying it to a broadly accessible Preview deployment can expose real V2 functionality to any signed-in user and any real data wired to that preview. | Use branch-scoped Preview env vars only, require Deployment Protection, use non-production Supabase/Google OAuth clients for previews, and document a rollback command/checklist. Type: Vercel/manual. |
| Vercel deployment-protection bypass support exists for QA scripts. | Medium | `scripts/qa-data-intelligence-v2-preview.mjs:13`, `scripts/qa-data-intelligence-v2-preview.mjs:111`, `scripts/qa-data-intelligence-v2-preview.mjs:316` | The script redacts bypass values in output, but bypass tokens are high-value operational secrets. Misuse can make protected previews reachable by automation beyond normal access controls. | Store bypass secrets only in local/CI secret stores, rotate after broad sharing, and avoid putting bypass tokens in URLs. Type: Vercel/GitHub process. |
| Production host canonicalization does not protect preview URLs. | Low to Medium | `proxy.ts:12`, `lib/vercel-canonical-host.ts:13` | Production aliases are redirected, but preview URLs remain governed by Vercel settings. This is expected, but previews with real data must not rely on app proxy logic for protection. | Enforce preview access in Vercel, not only in application routing. Type: Vercel/manual. |

### 4. Unsafe feature flags

| Flag or env pattern | Severity | Current state | Recommended follow-up |
| --- | --- | --- | --- |
| `DATA_INTELLIGENCE_V2_ENABLED`, `DATA_INTELLIGENCE_V2_CHAT_API_ENABLED`, `DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED`, `DATA_INTELLIGENCE_V2_UI_ENABLED` | Medium | Disabled by default in `.env.example`; page/API handlers check the flags before exposing V2 UI/API behavior. | Keep disabled in Production until RLS, IDOR, AI privacy, and reveal audit hardening are complete. Use branch-scoped Preview enables only. |
| `DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL` | High | Disabled by default, but preview configuration script sets it to `true` for Preview. | Keep false in Production and public previews with real users until durable owner/client authorization, Postgres reveal storage, audit monitoring, and privacy tests are in place. |
| `DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED` | Medium | Disabled by default and blocked by `NODE_ENV=production`. | Treat as local-only. Add `VERCEL_ENV`/`APP_ENV` checks and refuse when production data credentials are present. |
| `DATA_INTELLIGENCE_V2_PREVIEW_QA_ENABLED` and `DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET` | Medium | Disabled by default; route additionally requires `VERCEL_ENV=preview` and a secret. | Scope to Preview only, never Production. Rotate after sharing. Add rate limiting and keep Deployment Protection active. |
| `DATA_INTELLIGENCE_V2_EVAL_OPENAI_ENABLED` and `DATA_INTELLIGENCE_V2_EVAL_ALLOW_NETWORK` | Medium | Disabled by default and blocked by `NODE_ENV=production`. | Keep local/CI-only. Add a guard against running with production Supabase/Google/Vercel env values. |
| `PERSISTENCE_BACKEND=sqlite` | High | The default backend is SQLite, and `.env.example` uses SQLite for local development. | Make SQLite explicitly local-only. Production/Preview with real data should require Supabase and encrypted token storage. |
| `NEXT_PUBLIC_*` variables | Low | No `NEXT_PUBLIC_*` usage was found in reviewed source, scripts, tests, package config, or `.env.example`. | Continue avoiding public env vars for Supabase keys, OAuth config, AI keys, tokens, or internal feature flags unless they are intentionally browser-safe. |

### 5. Recommended production hardening steps

1. Extend the central production-like runtime classifier from the PROD-001 fix beyond persistence. Use it for dev mocks, evals, diagnostics, durable audit/reveal stores, and cookie/security assumptions.
2. Keep the PROD-001 fail-closed release check: Vercel Production and real-data Preview must use `PERSISTENCE_BACKEND=supabase`, configured Supabase/Postgres database env vars, and token encryption.
3. Keep all V2 flags off in Production until the authorization, RLS, AI privacy, reveal audit, and data-retention tasks from the other audits are complete.
4. Scope V2 Preview enables to a single branch and a non-production Supabase project. Do not point public preview deployments at production Drive/OAuth/Supabase resources.
5. Require Vercel Deployment Protection for previews that contain real client data or production-like env vars. Treat bypass secrets as credentials and rotate them if shared.
6. Replace implicit `NODE_ENV !== "production"` debug gates with explicit server-only feature flags plus admin/session authorization.
7. Add route inventory tests or a release checklist that fails on new `/debug`, `/test`, `/seed`, `/admin`, `/bypass`, or QA endpoints unless they have documented production guards.
8. Add CI/release checks for client bundle leakage: no `SUPABASE_SERVICE_ROLE_KEY`, database URLs, OpenAI keys, OAuth secrets, bypass tokens, or unexpected `NEXT_PUBLIC_*` variables in emitted browser assets.
9. Add local-only guards to scripts that can print extracted database contents or run networked AI evals.
10. Document Vercel manual controls: Production env values, Preview env values, branch-scoped preview flags, Deployment Protection status, preview QA secret rotation, and rollback steps for disabling V2 flags.

### Code changes made in this audit

No application code changes were made in this audit pass. Post-audit commit `6ca6753` mitigated PROD-001 in code; this document preserves the historical audit finding and records the remaining separation risks.
