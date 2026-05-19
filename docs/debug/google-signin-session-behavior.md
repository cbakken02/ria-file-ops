# Google Sign-In Session Behavior Review

## User Concern

After the production sign-in fix, clicking "Sign In" can reach `/dashboard` without visibly showing the Google account picker. The concern is whether Google OAuth is silently succeeding because the browser already has a Google session, or whether the app is bypassing authentication.

This review covers production app sign-in at `https://ria-file-ops.vercel.app`, not the separate Google Drive storage OAuth flow except where the paths share OAuth infrastructure.

## Browser Test Matrix

| Scenario | Result |
| --- | --- |
| Normal Chrome profile, app signed out, Google already signed in | The login page rendered. Clicking "Sign in with Google" returned to `/dashboard` quickly without a visible account picker. |
| Normal Chrome profile, direct `/dashboard` after app logout | The app did not render the dashboard and remained on the login flow. |
| Incognito Chrome, direct `/dashboard` | The app redirected to `/login`; no dashboard content rendered. |
| Incognito Chrome, click "Sign in with Google" | Browser navigated to `accounts.google.com` on the Google sign-in identifier page. No credentials were entered. |
| Fully signed-out Google session in the normal profile | Not performed to avoid disrupting the user's main browser session. Incognito provided a clean no-Google-session check. |
| Manual cookie deletion | Not performed to avoid touching unrelated browser state. The app logout path plus incognito provided safe app-session-cleared coverage. |

## Observed Behavior

- The production login page renders the enabled "Sign in with Google" button.
- The app-login button calls `signIn("google", { callbackUrl: "/dashboard" })`.
- A sanitized production endpoint probe confirmed `/api/auth/signin/google` returns a Google OAuth authorization URL on `accounts.google.com`.
- The generated OAuth request uses callback host/path `ria-file-ops.vercel.app` and `/api/auth/callback/google`.
- The generated OAuth request includes the expected OAuth parameter names, PKCE `S256`, response type `code`, and scopes `openid`, `email`, and `profile`.
- In the normal profile, the visible Google account screen can be skipped because Google already has an active browser session and prior consent for the app.
- In incognito, where the app and Google browser sessions were absent, the same sign-in action stopped at Google Accounts instead of reaching the dashboard.

## Expected OAuth Behavior

The quick normal-profile redirect is expected OAuth single sign-on behavior. Google may skip the account picker or consent screen when:

- the browser already has an active Google session;
- the account has already consented to the requested `openid email profile` scopes;
- the app sends a standard authorization-code request with a valid callback URI and PKCE.

That behavior does not by itself mean the app bypassed authentication. It means the identity provider completed the interactive portion without needing new input.

## App Session Verification

The app still validates its own session before showing protected pages:

- `app/dashboard/page.tsx` calls `requireSession()` before reading dashboard data.
- `lib/session.ts` calls `auth()` and then `getAppPrincipalResultFromSession(session)`.
- `lib/auth/principal.ts` derives a principal from `session.user.email` and calls `enforceSessionActivity()`.
- `lib/auth/session-activity.ts` requires a hashed app session id and creation timestamp, checks invalidation, idle timeout, and absolute timeout, then reads or upserts `public.app_session_activity`.
- If verification fails, protected pages redirect to `/login` with an appropriate reason instead of rendering.

Safe aggregate database checks after a normal-profile login showed the app created activity/audit metadata: `app_session_activity` count increased from 3 to 4 and `auth.login` audit count increased from 2 to 3. No table rows or private user data were inspected.

## Dashboard Protection

Dashboard protection passed the signed-out checks:

- Fetching `/dashboard` without cookies returned `307` to `/login`.
- Fetching `/api/auth/session` without cookies returned `200` with no user.
- Incognito navigation directly to `/dashboard` landed on `/login`.
- Normal-profile app logout invalidated the app session; a direct `/dashboard` attempt did not render protected content until sign-in completed.

## Cookie/Security Notes

Sanitized `Set-Cookie` checks from production sign-in start showed only cookie names and flags:

- `__Host-next-auth.csrf-token`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-only.
- `__Secure-next-auth.callback-url`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-only.
- `__Secure-next-auth.state`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-only, `Max-Age=900`.
- `__Secure-next-auth.pkce.code_verifier`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-only, `Max-Age=900`.

The installed NextAuth cookie defaults use the same `HttpOnly`, `SameSite=Lax`, `Path=/`, and secure-cookie behavior for the JWT session cookie in HTTPS/Vercel production. Browser cookie values were not inspected.

Session duration posture:

- App-level session activity enforces a 60-minute idle timeout.
- App-level session activity enforces a 12-hour absolute timeout.
- NextAuth's default JWT max age remains longer than the app-level absolute timeout unless explicitly overridden. The app-level check still blocks protected routes after the shorter timeout, but aligning the framework session max age would reduce stale encrypted session-cookie lifetime.

## Findings

Confirmed:

- The app does not bypass Google OAuth. The sign-in start route returns a Google authorization URL, and incognito reaches Google Accounts.
- `/dashboard` requires a valid app session. Signed-out and no-cookie requests do not render the dashboard.
- `/dashboard` also requires server-side principal/session activity verification against Supabase-backed app state.
- Recent AUTH-001 changes do not expose OAuth access or refresh tokens through the browser session and are not required for dashboard rendering.
- Auth/OAuth rate limiting did not block this successful sign-in path.
- No app-level preview bypass or development shortcut was found in the production sign-in/dashboard path.
- Canonical host behavior stayed on `ria-file-ops.vercel.app` for the tested production flow.

Ruled out:

- A visible Google account picker is not required for a valid OAuth login when the browser already has a Google session.
- Incognito cannot reach `/dashboard` without signing in.
- No-cookie HTTP requests cannot reach `/dashboard`.

Not fully tested:

- A fully signed-out Google session in the user's normal browser profile was not tested to avoid disrupting the user's logged-in Google state.
- Browser cookie store contents were not inspected; only production response cookie names and flags were checked.

## Risk Level

Low for the specific concern that production is bypassing app authentication. The observed behavior matches normal Google OAuth SSO, and the app still enforces NextAuth plus server-side session/principal verification before protected dashboard access.

## Recommended Changes

Completed follow-up:

- Explicit app logout returns to `/login?reason=logged_out`.
- Only that post-logout login state requests Google `prompt=select_account`.
- The app does not use `prompt=consent` or `prompt=login` for app sign-in, so it does not force full password reauthentication or new consent just because the user logged out of RIA File Ops.
- This is a UX/security-clarity improvement. It does not replace NextAuth session clearing, app session invalidation, or server-side dashboard/session verification.

Remaining non-blocking follow-ups:

- Consider setting explicit NextAuth `session.maxAge` and `jwt.maxAge` to align with the app's 12-hour absolute session timeout.
- Keep monitoring `auth.login` audit events and `app_session_activity` creation after production auth changes.

## Verification Steps

Completed verification:

1. Normal profile direct `/dashboard` after app logout did not render protected content.
2. Normal profile sign-in reached `/dashboard` and created aggregate session/audit metadata.
3. Incognito direct `/dashboard` redirected to `/login`.
4. Incognito sign-in navigated to `accounts.google.com` and stopped at the Google identifier page.
5. Sanitized production endpoint probes confirmed the NextAuth Google start route, callback host/path, PKCE, OAuth scopes, and secure cookie flags.
6. Code inspection confirmed dashboard route protection, session/principal verification, and absence of production auth bypass flags in the app path.
7. Focused regression coverage now verifies that explicit logout requests Google account selection on the next app sign-in while normal sign-in remains unchanged.

If investigating again, record only route names, hostnames, status codes, reason query names, cookie names/flags, and aggregate counts. Do not copy cookie values, OAuth codes, state values, tokens, database URLs, secret values, or user/client document data.
