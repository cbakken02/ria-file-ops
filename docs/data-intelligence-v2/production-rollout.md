# Data Intelligence V2 Production Rollout

Production V2 rollout completed on April 30, 2026 for
`https://ria-file-ops.vercel.app`.

## Status

- Production Vercel deployment completed successfully.
- V2 Production environment variable names were configured by name.
- Core app, auth, database, encryption, and OpenAI key groups were present by
  name before rollout.
- Supabase migration history matched local migrations through `20260430`.
- No Supabase migration apply was run during the Production rollout.
- V1 fallback remains intact.
- No GitHub push or pull request was created.

## Smoke Result

Unauthenticated Production smoke checks passed:

- `/login` returned successfully.
- `/data-intelligence` redirected unauthenticated traffic to `/login`.
- Google provider metadata was available.
- OAuth callback path remained `/api/auth/callback/google`.
- No server `500` responses were detected in the safe smoke checks.

Authenticated browser QA still requires a safe signed-in browser session. Do not
use real client prompts or reveal real sensitive values during manual QA.

## Rollback

Rollback remains environment-driven. Disable one or more of these Production
flags if V2 needs to be backed out:

```bash
DATA_INTELLIGENCE_V2_UI_ENABLED=false
DATA_INTELLIGENCE_V2_CHAT_API_ENABLED=false
DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED=false
```

Disabling the V2 UI flag should return `/data-intelligence` to the V1
experience while leaving the V2 implementation available for later diagnosis.

## Next Step

Run manual authenticated Production browser QA with a safe account/session:

- Confirm V2 UI renders on `/data-intelligence`.
- Ask only a safe general smoke prompt.
- Confirm no raw sensitive values are shown.
- Confirm reveal cards remain gated and local to the reveal UI.
- Confirm no console or network `500` errors.
