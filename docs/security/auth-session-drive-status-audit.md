# Auth Session & Drive Status Audit

Date: 2026-05-18

## 1. Why intake is likely stale while cleanup works

The intake page is likely stale because its first render is built from cached app state:

- `app/preview/intake-workspace-page.tsx` uses `requireSession()` for login, then reads cached storage records with `getCachedStorageConnectionsForSession(session)`.
- It reads the last saved queue from `readPreviewSnapshot(ownerEmail)` and `restorePreviewItemsFromSnapshot(snapshot)`.
- Its live Drive refresh happens through `IntakeAutoRefresh`, which previously only called `/api/preview/refresh` after a browser reload. Client-side navigation to Intake did not scan Drive.
- If `/api/preview/refresh` failed because the Drive token was invalid, the failure was swallowed in the client component. The server may mark the connection `needs_reauth`, but Intake did not call `router.refresh()` on failure, so the page could keep showing the previous cached connection/queue state.

Clean Up behaves differently:

- `app/cleanup/clean-up-workspace-page.tsx` also starts from cached storage status, but the client `CleanupPlanner` immediately loads live Drive data through `/api/cleanup/browser`.
- `/api/cleanup/browser` uses `getActiveStorageConnectionForSession(session)`, which can refresh stored Google tokens when `refreshToken` and `expiresAt` are present.
- Clean Up client code treats 401/403 responses as storage unavailable and updates its local UI state. Intake did not have equivalent failure-state handling before this audit.

Result: Drive can appear to work in Clean Up because Clean Up actively revalidates Drive on client load, while Intake can keep displaying an old snapshot and old cached connection status.

## 2. Differences between intake and cleanup auth/Drive checks

| Area | Intake | Clean Up | Dashboard |
| --- | --- | --- | --- |
| Page auth | `requireSession()` | `requireSession()` | `requireSession()` |
| Proxy/middleware | `proxy.ts` only canonicalizes production host; it is not an auth guard. | Same | Same |
| Initial storage status | Cached via `getCachedStorageConnectionsForSession()` | Cached via `getCachedStorageConnectionsForSession()` | Cached via `getCachedStorageConnectionsForSession()` |
| Live Drive check on page load | Previously only after browser reload through `/api/preview/refresh`; now attempts when Intake mounts and is eligible. | Yes, `CleanupPlanner` calls `/api/cleanup/browser` on mount. | No live Drive check; dashboard intentionally shows cached operational state only when cached storage status is connected. |
| Live API storage helper | `/api/preview/refresh` uses `getVerifiedActiveStorageConnectionForSession()` and lists Drive. | Browser route uses `getActiveStorageConnectionForSession()` then live Drive calls; preview/analyze/apply routes use verified/approval helpers. | No live Drive API in page render. |
| Failure handling | Previously silent client catch; now calls `router.refresh()` after failed refresh so server-side `needs_reauth` can show. | 401/403 sets local `storageAvailable=false`. | Shows cached app-state panel; does not actively discover expired Drive auth. |
| Queue/data source | Saved preview snapshot plus optional refresh endpoint. | Live Drive browser plus cleanup-state records. | Saved preview snapshot, review decisions, and filing events. |

## Auth provider/session flow

- `auth.ts` uses NextAuth with Google and JWT sessions.
- Login provider scope is `openid email profile`; Drive access is intentionally a separate storage OAuth flow.
- Storage OAuth starts at `/api/storage/google/start`, requests Google Drive scope, stores a CSRF-like state cookie for 10 minutes, then saves the storage connection in `/api/storage/google/callback`.
- `auth.ts` can refresh the Google account token if the NextAuth JWT has a `refreshToken`, but normal login does not request Drive scope.
- Storage connections have their own persisted `accessToken`, optional `refreshToken`, `expiresAt`, granted scopes, and `status`.
- No explicit app account status model was found beyond signed-in session email and storage connection `connected` / `needs_reauth`.

## Auto logout / one-hour inactivity

No one-hour inactivity handling was found.

- `authOptions.session` sets `strategy: "jwt"` but does not set `maxAge` or `updateAge`.
- No current `/api/session/keepalive`, `/api/session/status`, or `/api/session/logout` routes are tracked.
- No client idle timer, visibility-change handler, or forced idle sign-out flow was found.

## 3. Recommended code fixes

Immediate fixes:

1. Keep the Intake auto-refresh change from this audit: when Intake is eligible to refresh, attempt the refresh on mount/navigation, not only on browser reload.
2. Keep the failure refresh behavior from this audit: if Intake refresh fails, call `router.refresh()` so the page can pick up a server-side `needs_reauth` update.
3. Add visible Intake refresh state: show “Refreshing Intake…” and a reconnect/error notice if `/api/preview/refresh` returns 401/403/5xx.
4. Add a manual “Refresh Intake” button that calls `/api/preview/refresh` without requiring a full browser reload.

Near-term consistency fixes:

1. Use one shared Drive-status helper for page status panels so Intake, Clean Up, Dashboard, History, and Setup use the same definitions for `connected`, `needs_reauth`, and “cached only”.
2. Return storage connection `status` from `/api/storage/connections`; the add-storage modal currently shows attached connections without status.
3. Consider a small `/api/storage/status` endpoint that verifies or refreshes the active connection and returns safe metadata only.
4. Add tests for `/api/preview/refresh` behavior when Drive verification fails and when it marks the storage connection `needs_reauth`.

Production hardening:

1. Decide whether private MVP should use long-lived JWT sessions or set explicit `session.maxAge` / `session.updateAge`.
2. If one-hour inactivity is required, implement a client idle timer plus server-side session validation on sensitive actions.
3. Add an account/team status model before real users: active, disabled, invited, suspended, and allowed storage providers.
4. Add route coverage tests that assert protected pages and API routes reject unauthenticated requests.

## 4. Code changes made

| File | Change |
| --- | --- |
| `app/preview/intake-auto-refresh.tsx` | Removed the browser-reload-only gate so eligible Intake pages can refresh after normal navigation. Added `router.refresh()` when the refresh request fails, allowing updated server-side storage status such as `needs_reauth` to render. |

No OAuth scopes, production env vars, Supabase settings, Vercel settings, or database policies were changed.

## 5. Remaining production auth hardening tasks

| Priority | Task | Why |
| --- | --- | --- |
| High | Add visible Intake refresh/error state and manual refresh control. | Users need to distinguish “cached queue” from “live Drive refresh failed.” |
| High | Add explicit one-hour inactivity/session policy if required for demos or production. | It is currently missing. |
| High | Add account status checks before real users. | A signed-in Google account is treated as allowed if it has app data; there is no disabled/suspended account gate. |
| Medium | Normalize page-level Drive status checks across Intake, Clean Up, Dashboard, History, and Setup. | Current behavior is understandable but inconsistent. |
| Medium | Return safe status metadata from `/api/storage/connections`. | Storage management UI can otherwise imply stale/reauth-needed connections are healthy. |
| Medium | Add tests for stale Drive state transitions. | Prevents regressions in cached-vs-live storage behavior. |
| Low | Consider moving auth protection into a central route map or proxy layer in addition to per-page/per-route checks. | Current direct checks are mostly sound, but a route map would make omissions easier to catch. |
