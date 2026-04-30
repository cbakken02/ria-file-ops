# Data Intelligence V2 Preview QA

This guide covers automated QA for an existing Vercel Preview deployment of
the Data Intelligence V2 copilot. It does not deploy code, modify Vercel env
vars, run Supabase migrations, or change production resources.

## Purpose

Use the preview QA script to verify safe route behavior before manual browser
QA. The script can classify Vercel Deployment Protection, app-level auth, V2
route availability, anonymous API protection, and obvious unsafe output
patterns without printing secrets or storing transcripts.

## Current Preview Status

Automated backend Preview QA has passed for the current V2 Preview deployment
after configuring Vercel Deployment Protection automation bypass and rotating
the Preview-only QA secret. The successful smoke reached the app, confirmed
app-level auth still blocks anonymous chat and reveal calls, and received a
safe `passed` result from the Preview-only QA endpoint. No Production
deployment or Production env change was performed.

## Preview-Only QA Endpoint

The Preview-only backend smoke endpoint is:

```text
POST /api/data-intelligence/v2/qa/preview-smoke
```

It is disabled outside Vercel Preview and returns `404` unless all of these
are true:

- `VERCEL_ENV=preview`
- `DATA_INTELLIGENCE_V2_PREVIEW_QA_ENABLED=true`
- `DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET` is configured for Preview
- the request sends `x-data-intelligence-v2-qa-secret`

The endpoint uses fake/dev mock data only, does not use app-level user
sessions, does not return raw reveal values, and is not a replacement for
browser UI QA. Production must not enable this endpoint.

## Preview URL

Use the Preview URL from the deployment report:

```bash
node scripts/qa-data-intelligence-v2-preview.mjs \
  --url <preview-url> \
  --json
```

The script should report Deployment Protection as active when no bypass secret
is supplied. That is expected for protected previews and is not an app failure.

To call the Preview-only QA endpoint when a QA secret is present in the shell:

```bash
node scripts/qa-data-intelligence-v2-preview.mjs \
  --url <preview-url> \
  --run-preview-qa-endpoint \
  --json
```

If Vercel Deployment Protection blocks the endpoint before the app route runs,
rerun with the Vercel bypass option as well. The QA secret and bypass secret
are sent only through headers and are never printed.

## Vercel Protection Bypass

If a Vercel automation bypass secret is available in the shell, run:

```bash
node scripts/qa-data-intelligence-v2-preview.mjs \
  --url <preview-url> \
  --with-vercel-bypass \
  --json
```

The script sends the bypass only through request headers and never prints the
secret, auth cookies, or token values. Vercel Deployment Protection bypass does not bypass app-level auth or the app's own NextAuth/session requirements.

The Preview QA endpoint also requires its own QA secret. Vercel Deployment
Protection bypass does not replace `DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET`.

## Expected Anonymous Behavior

After Deployment Protection is bypassed, anonymous requests should still be
blocked by app auth:

- `POST /api/data-intelligence/v2/chat` should not accept anonymous chat.
- `POST /api/data-intelligence/v2/reveal` should not anonymously reveal a
  value.
- A `401` or `403` from app auth is expected without a valid app session.

If an anonymous chat or reveal request succeeds, treat that as a failure.

## Manual QA Requirements

If app auth automation is missing, full V2 chat/reveal QA remains manual:

1. Open the Preview deployment with an authenticated test account.
2. Visit `/data-intelligence`.
3. Confirm the V2 UI renders.
4. Ask only a fake/test-client-safe question.
5. Confirm source-backed facts, missing/unverified data, and recommended steps
   render.
6. Request a secure reveal card only for fake/test data.
7. Confirm revealed values stay inside the reveal card and are not sent back in
   follow-up chat payloads.
8. Verify durable reveal-card and audit rows later through a safe schema/data
   review path if one is explicitly approved.

Do not use real client/customer data. Do not reveal real sensitive values. Do
not print secrets, DB URLs, auth cookies, bypass secrets, or tokens.

## Rollback Flags

V1 fallback remains intact. For Preview rollback, disable one or more of:

- `DATA_INTELLIGENCE_V2_UI_ENABLED=false`
- `DATA_INTELLIGENCE_V2_CHAT_API_ENABLED=false`
- `DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED=false`
- `DATA_INTELLIGENCE_V2_ENABLED=false`

## Production

No production deployment is part of this QA step. Production env vars must not
be modified during Preview QA.
