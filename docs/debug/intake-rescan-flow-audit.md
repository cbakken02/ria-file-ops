# Intake Rescan Flow Audit

## User Concern
The Intake page shows operational status such as last scan, cache state, source folder, and per-file diagnostics, but a normal browser refresh can still show old queue data. That can make the page feel like it checked Google Drive when it actually reloaded the saved Intake snapshot.

## Current Flow
- `/intake` renders through `app/preview/intake-workspace-page.tsx`.
- The page validates the app session with `requireSession()`, resolves the app principal, reads the active storage connection record, reads firm settings, review decisions, filing events, and loads the saved preview snapshot with `readPreviewSnapshot(ownerEmail)`.
- The rendered queue is reconstructed from `restorePreviewItemsFromSnapshot(snapshot)`.
- The page does not list the Google Drive source folder during initial render or browser refresh.
- The dashboard follows the same saved-state pattern for preview counts: it reads the saved preview snapshot rather than checking Drive.

## Old Quarantined Auto Refresh Behavior
The old untracked file remains outside the repo at `../ria-file-ops-quarantine/intake-auto-refresh-untracked-2026-05-18/intake-auto-refresh.tsx` and was not restored. Safe stat checks confirm the file exists in quarantine, but read attempts time out, so this audit relies on tracked repo code and historical docs rather than reusing that component.

Historical audit docs describe the old `IntakeAutoRefresh` approach as a browser-triggered refresh path. Current tracked code has replaced that pattern with an explicit server-side Rescan action and no tracked `app/preview/intake-auto-refresh.tsx`.

## Browser Refresh Behavior
A browser refresh:
- validates the app session and principal;
- refreshes an expired storage access token if the active storage record can be refreshed;
- reads storage connection status, setup settings, decisions, filing events, and saved preview snapshot state;
- displays the saved queue from the last completed Rescan.

A browser refresh does not:
- call `listFilesInFolder()` for the source folder;
- compare the live Drive folder manifest to the saved queue;
- detect newly added, removed, or changed source files;
- mark the queue stale based on Drive metadata.

The page copy now says "Last completed rescan" and "Displayed queue" and explains that browser refresh shows the saved queue. This avoids implying that browser refresh performs a live Drive scan.

## Explicit Rescan Behavior
The Rescan source folder form posts to `refreshIntakeAction()` in `app/preview/actions.ts`. The API route `app/api/preview/refresh/route.ts` uses the same shared helper.

With `forceFresh: true`, `refreshIntakeQueueForSession()` / `refreshIntakeQueue()`:
- resolves the active server-side storage authorization for the signed-in principal;
- requires a configured source folder;
- clears the owner's preview analysis cache and preview snapshot;
- loads live source folder metadata from Drive;
- lists live source folder files from Drive;
- optionally loads and lists the destination root;
- rebuilds the processing preview;
- writes a new preview snapshot;
- revalidates `/dashboard`, `/intake`, `/preview`, and `/review`.

This path is the current source of truth for discovering source-folder changes.

## Cache / Last Scan / Debug State
- Preview snapshots are keyed by owner email. In local SQLite/file mode they live under `data/preview-snapshots`; in Supabase mode they live in `public.preview_snapshots`.
- Preview analysis cache entries are keyed by owner email, analysis profile, and Drive file ID. The current cache match also checks analysis version, file ID, MIME type, and Drive size when available.
- Preview items store Drive modified time, Drive size, and downloaded SHA1 when available, but browser refresh does not compare those fields to live Drive metadata.
- The analysis cache match does not currently use Drive modified time or downloaded hash, so same-ID/same-size edits are not a reliable freshness boundary.
- `generatedAt` on the preview snapshot is the last successful snapshot write from Rescan, not a live Drive check timestamp.
- Per-item diagnostics show analysis source, cache write time, Drive modified time, Drive size, downloaded hash, parser details, AI status, and extracted text. These are currently product-facing behind a `Diagnostics` disclosure in the Intake item modal, not gated by a debug flag.

## Drive Source Folder Freshness Detection
Current tracked code can detect source-folder freshness only when an explicit Rescan lists Drive live. It does not have a lightweight page-load freshness check that compares a live Drive manifest to the saved snapshot.

A safe freshness check would likely compare file ID, MIME type, modified time, and size for source-folder children, then mark the saved queue stale without downloading or analyzing documents.

## File Needs-Analysis Detection
Current explicit Rescan can detect new or changed files because it lists Drive and rebuilds the queue. With `forceFresh: true`, it clears the owner's analysis cache, so all listed source files are reprocessed for the preview queue.

Current browser refresh cannot detect unprocessed files that exist in Drive but are missing from the saved snapshot. It also cannot detect changed or deleted Drive files until Rescan runs.

## Confirmed Issues
1. Browser refresh does not check live Drive state. This is by design for speed, but the prior labels made the saved state look fresher than it was.
2. There is no lightweight source-folder manifest check on page load.
3. `needs_reauth` can be detected during explicit Rescan or token refresh, but a revoked token may not be discovered by browser refresh unless the token refresh path itself fails.
4. Per-file diagnostics are overly technical for normal users and can make cache internals feel like product state.

## Missing UX / Polish
- Show a concise status such as "Saved queue from last rescan" instead of raw cache language.
- Add a clear "Rescan needed" or "Drive may have changed" state after a lightweight manifest mismatch.
- Keep detailed diagnostics behind a debug or support-oriented affordance, or rename them to "Technical details."
- Explain that Rescan checks Drive and may take longer because it rebuilds analysis state.

## Security or Auth Concerns
- Intake live Drive operations are server-side and require `requireSession()` plus active storage authorization.
- The browser-visible page does not need Drive access tokens to refresh or display the saved queue.
- The current page can show cached state while storage needs reconnect; explicit Rescan marks Drive auth failures as reconnect-required.
- This audit did not run live Drive scans, inspect document contents, or modify production data.

## Recommended Fixes
1. Keep the wording fix that distinguishes browser refresh from explicit Rescan.
2. Add a lightweight server-side Drive manifest freshness check on Intake page load if latency is acceptable. It should list metadata only, not download or analyze documents.
3. Persist a compact source-folder manifest with each preview snapshot so the app can compare file IDs, modified times, MIME types, and sizes.
4. Mark the queue stale when the live manifest differs from the saved manifest, and prompt the user to Rescan.
5. Keep full document analysis behind explicit Rescan unless product requirements change.
6. Move detailed per-file diagnostics behind a debug/support mode or reframe them as technical details.

## Priority
Medium. The current server-side Rescan flow is safer than browser auto-refresh loops, but missing freshness detection can confuse users and delay analysis of new Drive files.

## Test Coverage
Existing tests cover that Intake exposes a server-side Rescan action, that the refresh API uses the shared helper, that force-fresh Rescan clears owner caches, and that Rescan lists Drive folders and writes a new snapshot.

This audit added coverage that the Intake page labels the displayed state as a saved queue, does not import live Drive listing on render, and routes live Drive scanning through the explicit Rescan action/API.

## Proposed Product Behavior
On browser refresh:
- validate auth/session;
- validate stored connection status;
- load the saved queue quickly;
- optionally perform a lightweight source-folder metadata check;
- mark the queue stale if Drive metadata differs;
- do not run full document analysis automatically.

On explicit Rescan:
- list the source folder live from Drive;
- detect new, changed, and missing files;
- rebuild the queue and analysis state according to product design;
- update last completed rescan and saved queue status;
- show reconnect guidance when Drive auth fails.
