# Intake Rescan Flow Audit

## User Concern
The Intake page shows operational status such as last completed rescan, displayed queue, source folder, Drive freshness, and per-file diagnostics. A normal browser refresh should load the saved queue quickly while still detecting whether the Drive source folder has changed enough to require Rescan.

## Current Flow
- `/intake` renders through `app/preview/intake-workspace-page.tsx`.
- The page validates the app session with `requireSession()`, resolves the app principal, reads the active storage connection record, reads firm settings, review decisions, filing events, and loads the saved preview snapshot with `readPreviewSnapshot(ownerEmail)`.
- The rendered queue is reconstructed from `restorePreviewItemsFromSnapshot(snapshot)`.
- The page runs `checkIntakeSourceFreshness()` when a source folder and connected storage account are present. This lists Drive metadata only and compares it with the saved snapshot.
- The dashboard follows the same saved-state pattern for preview counts: it reads the saved preview snapshot rather than checking Drive.

## Old Quarantined Auto Refresh Behavior
The old untracked file remains outside the repo at `../ria-file-ops-quarantine/intake-auto-refresh-untracked-2026-05-18/intake-auto-refresh.tsx` and was not restored. Safe stat checks confirm the file exists in quarantine, but read attempts time out, so this audit relies on tracked repo code and historical docs rather than reusing that component.

Historical audit docs describe the old `IntakeAutoRefresh` approach as a browser-triggered refresh path. Current tracked code has replaced that pattern with an explicit server-side Rescan action and no tracked `app/preview/intake-auto-refresh.tsx`.

## Browser Refresh Behavior
A browser refresh:
- validates the app session and principal;
- refreshes an expired storage access token if the active storage record can be refreshed;
- reads storage connection status, setup settings, decisions, filing events, and saved preview snapshot state;
- lists source-folder metadata when storage is connected and a source folder is configured;
- compares live file ID, name, MIME type, modified time, and size against the saved queue snapshot;
- displays the saved queue from the last completed Rescan;
- shows "Source folder changed — Rescan needed" when live metadata differs.

A browser refresh does not:
- download file contents;
- run document parsing or AI analysis;
- rebuild the queue;
- loop or auto-trigger Rescan.

The page copy now says "Last completed rescan," "Displayed queue," and "Drive freshness." It explains that browser refresh checks Drive metadata without downloading files, while explicit Rescan rebuilds and analyzes the queue.

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
- Preview items store Drive modified time, Drive size, and downloaded SHA1 when available. Browser refresh compares live Drive name, MIME type, modified time, and size against the saved snapshot.
- The analysis cache match does not currently use Drive modified time or downloaded hash, so same-ID/same-size edits are not a reliable freshness boundary.
- `generatedAt` on the preview snapshot is the last successful snapshot write from Rescan, not a live Drive check timestamp.
- Per-item diagnostics show analysis source, cache write time, Drive modified time, Drive size, downloaded hash, parser details, AI status, and extracted text. These are currently product-facing behind a `Diagnostics` disclosure in the Intake item modal, not gated by a debug flag.

## Drive Source Folder Freshness Detection
Current tracked code detects source-folder freshness on browser refresh with `lib/intake-freshness.ts`.

The check:
- lists source-folder metadata through the storage provider adapter;
- filters out folders;
- compares live files against saved snapshot items by file ID;
- counts live files missing from the snapshot as new/unprocessed;
- counts saved files missing from Drive as removed;
- counts same-ID files as changed when name, MIME type, modified time, or size differs;
- marks the page stale without downloading or analyzing documents.

## File Needs-Analysis Detection
Browser refresh can now detect new, changed, removed, and files-needing-analysis counts from metadata only. In the current count model, files needing analysis are new plus changed files.

Explicit Rescan remains the path that actually rebuilds the queue. With `forceFresh: true`, it clears the owner's analysis cache, so all listed source files are reprocessed for the preview queue.

## Confirmed Issues
1. Browser refresh now checks live Drive metadata, but does not persist a compact manifest separate from the saved queue.
2. Same-ID/same-size edits with unchanged Drive modified time remain hard to detect without a content hash or download.
3. `needs_reauth` can be detected during explicit Rescan, token refresh, or the freshness metadata check.
4. Per-file diagnostics are overly technical for normal users and can make cache internals feel like product state.

## Missing UX / Polish
- Show a concise status such as "Saved queue from last rescan" instead of raw cache language.
- Keep the clear "Source folder changed — Rescan needed" state after a lightweight metadata mismatch.
- Keep detailed diagnostics behind a debug or support-oriented affordance, or rename them to "Technical details."
- Explain that Rescan checks Drive and may take longer because it rebuilds analysis state.

## Security or Auth Concerns
- Intake live Drive operations are server-side and require `requireSession()` plus active storage authorization.
- The browser-visible page does not need Drive access tokens to refresh or display the saved queue.
- The current page can show cached state while storage needs reconnect; explicit Rescan and metadata freshness checks mark Drive auth failures as reconnect-required.
- This audit did not run live Drive scans, inspect document contents, or modify production data.

## Recommended Fixes
1. Persist a compact source-folder manifest with each preview snapshot so freshness can compare against the exact Rescan manifest, not only current queue items.
2. Consider using Drive checksums where available, while avoiding downloads during page refresh.
3. Keep full document analysis behind explicit Rescan unless product requirements change.
4. Move detailed per-file diagnostics behind a debug/support mode or reframe them as technical details.

## Priority
Medium. The current metadata check prevents the page from silently looking current when Drive changed, but a persisted manifest would make the model more explicit and auditable.

## Test Coverage
Existing tests cover that Intake exposes a server-side Rescan action, that the refresh API uses the shared helper, that force-fresh Rescan clears owner caches, and that Rescan lists Drive folders and writes a new snapshot.

Freshness tests cover matching metadata, stale counts for new/changed/removed/unprocessed files, and the browser-refresh helper listing metadata without downloading files. Source-level coverage also checks that the page calls `checkIntakeSourceFreshness()` rather than importing document download or analysis helpers.

## Proposed Product Behavior
On browser refresh:
- validate auth/session;
- validate stored connection status;
- load the saved queue quickly;
- perform a lightweight source-folder metadata check when storage is connected;
- mark the queue stale if Drive metadata differs;
- do not run full document analysis automatically.

On explicit Rescan:
- list the source folder live from Drive;
- detect new, changed, and missing files;
- rebuild the queue and analysis state according to product design;
- update last completed rescan and saved queue status;
- show reconnect guidance when Drive auth fails.
