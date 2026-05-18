# Secret History Audit

Date: 2026-05-18

## 1. Current tracked env/secrets status

No real env file appears to be tracked now.

Tracked env-like files:

| File | Status | Evidence |
| --- | --- | --- |
| `.env.example` | Tracked intentionally | Template only. Values were reviewed as placeholders, empty values, or non-secret config defaults. Secret values were not printed. |

Tracked sensitive-local paths not found:

| Pattern | Tracked now? |
| --- | --- |
| `.env`, `.env.local`, `.env.production`, `.env.preview`, `.envrc` | No |
| `.vercel/` | No |
| `supabase/.temp/` | No |
| `*.pem`, `*.key` | No |
| Vercel env export files | No |

Local ignored sensitive paths do exist in the working tree:

| Path | Git status |
| --- | --- |
| `.env.local` | Ignored |
| `.vercel/` | Ignored |
| `supabase/.temp/` | Ignored |
| `data/` | Ignored |

The local ignored files/directories were not printed or inspected for values. They are not tracked by git.

## 2. Suspicious secrets in history

No confirmed secret value was found in git history.

History findings:

| Finding | Risk | Redacted evidence |
| --- | --- | --- |
| `.env.example` exists historically | Low | `.env.example` appears in historical commits, including `f357e1b`, `b59f494`, `eabcfe6`, `e58ae98`, `64ba3e5`, `8e2b17e`, and `4967450`; reviewed as placeholder/template content only. |
| No historical `.env.local`, `.env.production`, `.vercel/`, or `supabase/.temp/` path changes found | Low | Path-history scan returned `.env.example` only for env-file paths. |
| Secret variable names appear in code/docs/tests | Low | References include names such as `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `NEXTAUTH_SECRET`, and Vercel bypass secret env names. These are variable names, placeholders, tests, or `process.env` reads, not printed values. |
| Raw secret-shaped values were not found | Low | Redacted scan found no OpenAI-style key shape, JWT-like token shape, private key block, or Postgres URL with embedded credentials. |

## 3. Redacted evidence only

Commands/checks used:

| Check | Result |
| --- | --- |
| Current tracked files | `.env.example` is the only tracked env-like file. |
| `.gitignore` coverage | `.env*` is ignored with `!.env.example`; `.vercel`, `supabase/.temp/`, `/data/`, and `*.pem` are ignored. |
| Ignored working-tree sensitive paths | `.env.local`, `.vercel/`, `supabase/.temp/`, and `data/` are ignored and present locally. |
| Git history path scan | No real env files or Vercel/Supabase temp env paths found in history; `.env.example` only. |
| Git history content scan | Secret env-name references found, but no confirmed secret values. |
| High-risk raw pattern scan | No matches for raw key/token/private-key/credentialed-DB-URL shapes. |

No secret values are included in this report.

## 4. Required key rotations

No key rotation is required based on this git-history audit alone.

Conditional rotations:

| Key/material | Rotate if |
| --- | --- |
| Supabase service role key | A real `SUPABASE_SERVICE_ROLE_KEY` was ever committed outside the reviewed history, pasted into logs, shared in chat, or exposed through Vercel preview output. |
| Supabase database URLs/passwords | Any real `SUPABASE_DB_URL`, `SUPABASE_DB_URL_POOLER`, `DATABASE_URL`, or Postgres password was ever committed, logged, or shared. |
| Google OAuth client secret | Any real `GOOGLE_CLIENT_SECRET` was ever committed, logged, or shared. |
| OpenAI/API keys | Any real `OPENAI_API_KEY`, `DATA_INTELLIGENCE_API_KEY`, or V2 OpenAI key was ever committed, logged, or shared. |
| Auth/session/encryption secrets | Any real `NEXTAUTH_SECRET`, `AUTH_SECRET`, JWT secret, or app encryption key was ever committed, logged, or shared. |
| Vercel bypass/QA secrets | Any real deployment bypass or preview QA secret was ever committed, logged, or shared. |

## 5. Recommended cleanup path

History rewrite is not recommended right now. There is no confirmed secret value in tracked history, and rewriting history would add coordination risk without a clear benefit.

Recommended next steps:

1. Keep `.env.example` tracked, but keep all values placeholder-only.
2. Keep `.env.local`, `.vercel/`, `supabase/.temp/`, `data/`, `*.pem`, and real key files ignored.
3. Add automated secret scanning before production, preferably `gitleaks` or `trufflehog` in CI and a lightweight pre-commit hook locally.
4. Enable GitHub secret scanning/push protection if the repository is hosted on GitHub.
5. Treat the local ignored `.env.local` as sensitive operational material: do not paste it into issues, PRs, logs, screenshots, or AI prompts.
6. If a real secret is later found in git history, immediately rotate the affected key first, then rewrite history with `git filter-repo` or BFG, force-push, invalidate old clones/forks where possible, and document the incident.
