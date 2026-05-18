# Supabase RLS Audit

This audit was read-only. No migrations were run, no database changes were made, and no Supabase/Vercel settings were changed.

Reference note: Supabase now distinguishes Data API grants from RLS, and recent Supabase changelog guidance says new tables may no longer be automatically exposed to Data/GraphQL APIs by default. Existing projects can still have legacy grants, so this project must verify grants in the dashboard before assuming tables are private.

## 1. Table Inventory

| Table/view | Used by app | Ownership column/path | Required access model | Current risk |
| --- | --- | --- | --- | --- |
| `public.firm_settings` | Settings, dashboard, intake, cleanup | `owner_email` | Owner/user scoped; write only for signed-in owner | High |
| `public.storage_connections` | Google Drive connection storage | `owner_email` | Server-only; owner scoped; never direct client-readable because it stores encrypted OAuth tokens | High |
| `public.filing_events` | History, dashboard, approval flows | `owner_email` | Owner scoped read/write; event IDs must be owner checked | High |
| `public.bug_reports` | Bug report API | `owner_email` | Insert by signed-in owner; admin/support read only | Medium |
| `public.review_decisions` | Intake/review queues | `owner_email` | Owner scoped read/write by signed-in owner | High |
| `public.client_memory_rules` | Filing/client matching | `owner_email` | Owner scoped read/write; contains client naming data | High |
| `public.preview_analysis_cache` | Intake analysis cache | `owner_email` | Server-only owner scoped; cache may contain extracted metadata | High |
| `public.preview_snapshots` | Intake queue state | `owner_email` | Owner scoped; contains cached queue/file metadata | High |
| `public.cleanup_file_states` | Cleanup suggestions/apply flow | `owner_email` | Owner scoped; file IDs from requests must be filtered by owner | High |
| `public.documents` | Canonical document index | `owner_email` | Owner/account/org scoped; contains sensitive document metadata | High |
| `public.document_canonical_payloads` | Canonical extracted payloads | `document_id -> documents.owner_email` | Server-only; readable only through owner-checked document | High |
| `public.institutions` | Query assistant/Data Intelligence | `owner_email` | Owner scoped | High |
| `public.parties` | Query assistant/Data Intelligence | `owner_email` | Owner scoped; client identity/household data | High |
| `public.accounts` | Query assistant/Data Intelligence | `owner_email` | Owner scoped; account identifiers are sensitive | High |
| `public.account_parties` | Account ownership graph | `owner_email` | Owner scoped | High |
| `public.document_institutions` | Document facts | `document_id -> documents.owner_email` | Owner scoped via parent document | High |
| `public.document_parties` | Document facts | `document_id -> documents.owner_email` | Owner scoped via parent document | High |
| `public.document_party_facts` | Identity facts | `document_id -> documents.owner_email` | Server-only; contains encrypted/raw-adjacent identity values | High |
| `public.document_account_snapshots` | Account snapshots | `document_id -> documents.owner_email` | Owner scoped via parent document | High |
| `public.document_account_parties` | Account/document party links | `document_id -> documents.owner_email` | Owner scoped via parent document | High |
| `public.document_contacts` | Institution/contact data | `document_id -> documents.owner_email` | Owner scoped via parent document | High |
| `public.account_values` | Account balances/values | `document_account_snapshot_id -> documents.owner_email` | Owner scoped via snapshot parent document | High |
| `public.document_primary_facts` | Primary document lookup facts | `owner_email` and `document_id` | Owner scoped | High |
| `public.document_tax_facts` | Tax document facts | `document_id -> documents.owner_email` | Owner scoped via parent document; tax values are sensitive | High |
| `public.data_intelligence_v2_reveal_cards` | Secure reveal metadata | `owner_email`, `user_email` | Server-only; creator/admin plus owner scope | High |
| `public.data_intelligence_v2_audit_events` | V2 audit trail | nullable `owner_email`, `user_email` | Server-only append; not client-readable | High |
| `public.latest_account_snapshot_v` | Query assistant/Data Intelligence | derives `owner_email` from `documents` | Must be `security_invoker` or inaccessible to client roles | High |
| `public.latest_account_document_v` | Query assistant/Data Intelligence | derives `owner_email` from latest snapshot view | Must be `security_invoker` or inaccessible to client roles | High |

## 2. Required Access Model Per Table

The current app is not using Supabase Auth or `@supabase/supabase-js`. It uses NextAuth for Google sign-in and connects to Supabase Postgres with `pg` through `SUPABASE_DB_URL_POOLER` or `SUPABASE_DB_URL`.

That means `auth.uid()` and `auth.jwt()` policies are not active for the current runtime path. The application currently relies on:

- Route/session checks through `auth()` or `requireSession()`.
- Query parameters derived from `session.user.email`.
- App-layer filters such as `WHERE owner_email = $1`.
- A server-only database connection that can read/write RLS-enabled tables despite no app policies being present.

The correct isolation target today is owner email, with a future upgrade path to firm/org/client membership:

- **Owner scope now:** every user can access only rows whose `owner_email` is their authenticated email.
- **Firm/org scope later:** advisor/CSA/admin roles should be modeled in durable server-side tables, not in client-supplied session fields.
- **Document child scope:** child rows without `owner_email` must be isolated by joining to `public.documents`.
- **Reveal scope:** reveal cards must match both owner scope and creator/admin authorization.
- **Audit scope:** audit events should be append-only from server code and should not be client-readable.

## 3. Current Risk Level

Overall RLS posture: **High**.

No Critical repository-only finding was confirmed because the app does not currently ship a Supabase browser client and no runtime service-role key usage was found. The risk becomes Critical if any of these `public` tables are exposed through Supabase Data API grants to `anon`/`authenticated` roles before policies are implemented and verified.

Key findings:

- **High:** migrations enable RLS on tables but create no policies. This is intentional per `20260424_phase1_app_state_and_projection.sql`, which says the schema is server-only with no anon/authenticated policies.
- **High:** runtime code uses direct Postgres. If the configured DB role is table owner, `postgres`, `service_role`, or another role with `BYPASSRLS`, database RLS is not the real authorization boundary.
- **High:** if the app DB role were changed to a normal non-bypass role today, most app queries would fail because no RLS policies exist.
- **High:** `latest_account_snapshot_v` and `latest_account_document_v` are public-schema views without `security_invoker`; views can bypass table RLS unless configured/protected.
- **High:** document child tables like `document_tax_facts`, `document_party_facts`, `document_account_snapshots`, and `account_values` lack `owner_email`; policies must join back to `documents`.
- **Medium:** most routes and server actions do owner-scoped reads/writes, but `/api/cleanup/apply`, `/api/cleanup/run`, and `/api/intake/approve` rely on lower-level `approveFileItems()` for auth instead of route-local checks.
- **Medium:** `/api/drive/files/[fileId]` is authenticated but not constrained to owner-scoped app state; it can fetch any Drive file accessible to the active Google token.
- **Medium:** `deleteDocumentScopedRows()` deletes projection child rows by `document_id` without an explicit `owner_email` predicate. RLS policies via parent `documents` would mitigate this, but app-layer defense is weaker than it should be.
- **Low:** no runtime `SUPABASE_SERVICE_ROLE_KEY` usage was found. Service-role exposure risk is currently documentation/env hygiene, not an active runtime bypass in code.

Query and route filtering summary:

- `lib/persistence/supabase-app-state-store.ts` consistently scopes app-state reads and writes by `owner_email` for settings, storage connections, review decisions, cleanup state, filing events, client memory, and bug reports.
- `lib/preview-analysis-cache.ts` and `lib/preview-snapshot.ts` scope Supabase preview cache/snapshot rows by `owner_email`.
- `lib/persistence/supabase-document-query-store.ts` generally filters document reads with `ownerEmail` and joins back to `public.documents.owner_email` for child facts.
- `lib/persistence/supabase-document-projection-store.ts` writes projection rows from an owner-scoped input, but some child-row cleanup deletes are keyed only by `document_id`.
- Pages and server actions generally derive `ownerEmail` from `requireSession()`.
- API routes generally call `auth()` directly; cleanup/intake approval POST routes rely on shared auth in `approveFileItems()`.
- No API route should rely on RLS alone today, because current runtime database access does not carry Supabase Auth identity.

## 4. Proposed RLS Policies In SQL Draft Form

Do not apply this SQL yet. It is a draft to show the intended model after the team chooses an auth bridge.

### Recommended Current-Architecture Draft

Because the app uses NextAuth plus direct Postgres, the most compatible approach is:

1. Create a least-privileged app database role without `BYPASSRLS`.
2. Enable `FORCE ROW LEVEL SECURITY` on app tables.
3. Set trusted request context before queries, for example `SET LOCAL app.owner_email = '<session email>'`, inside each transaction/request.
4. Add policies using a private helper that reads the trusted database setting.

```sql
-- Draft only. Do not run until the app sets these GUCs safely per request.

create schema if not exists app_private;

create or replace function app_private.current_owner_email()
returns text
language sql
stable
as $$
  select nullif(lower(current_setting('app.owner_email', true)), '')
$$;

create or replace function app_private.current_user_email()
returns text
language sql
stable
as $$
  select nullif(lower(current_setting('app.user_email', true)), '')
$$;

create or replace function app_private.current_app_role()
returns text
language sql
stable
as $$
  select nullif(lower(current_setting('app.role', true)), '')
$$;
```

Direct `owner_email` tables:

```sql
-- Replace app_authenticated with the actual least-privileged app DB role.
-- Repeat for:
-- firm_settings, storage_connections, filing_events, bug_reports,
-- review_decisions, client_memory_rules, preview_analysis_cache,
-- preview_snapshots, cleanup_file_states, documents, institutions, parties,
-- accounts, account_parties, document_primary_facts.

create policy "<table> owner select"
on public.<table>
for select
to app_authenticated
using (lower(owner_email) = app_private.current_owner_email());

create policy "<table> owner insert"
on public.<table>
for insert
to app_authenticated
with check (lower(owner_email) = app_private.current_owner_email());

create policy "<table> owner update"
on public.<table>
for update
to app_authenticated
using (lower(owner_email) = app_private.current_owner_email())
with check (lower(owner_email) = app_private.current_owner_email());

create policy "<table> owner delete"
on public.<table>
for delete
to app_authenticated
using (lower(owner_email) = app_private.current_owner_email());
```

Document child tables:

```sql
-- Template for child tables with document_id:
-- document_canonical_payloads, document_institutions, document_parties,
-- document_party_facts, document_account_snapshots,
-- document_account_parties, document_contacts, document_tax_facts.

create policy "<child_table> owner select via document"
on public.<child_table>
for select
to app_authenticated
using (
  exists (
    select 1
    from public.documents d
    where d.document_id = <child_table>.document_id
      and lower(d.owner_email) = app_private.current_owner_email()
  )
);

create policy "<child_table> owner insert via document"
on public.<child_table>
for insert
to app_authenticated
with check (
  exists (
    select 1
    from public.documents d
    where d.document_id = <child_table>.document_id
      and lower(d.owner_email) = app_private.current_owner_email()
  )
);

create policy "<child_table> owner update via document"
on public.<child_table>
for update
to app_authenticated
using (
  exists (
    select 1
    from public.documents d
    where d.document_id = <child_table>.document_id
      and lower(d.owner_email) = app_private.current_owner_email()
  )
)
with check (
  exists (
    select 1
    from public.documents d
    where d.document_id = <child_table>.document_id
      and lower(d.owner_email) = app_private.current_owner_email()
  )
);

create policy "<child_table> owner delete via document"
on public.<child_table>
for delete
to app_authenticated
using (
  exists (
    select 1
    from public.documents d
    where d.document_id = <child_table>.document_id
      and lower(d.owner_email) = app_private.current_owner_email()
  )
);
```

`account_values` needs a snapshot-to-document join:

```sql
create policy "account_values owner access via snapshot document"
on public.account_values
for all
to app_authenticated
using (
  exists (
    select 1
    from public.document_account_snapshots s
    join public.documents d on d.document_id = s.document_id
    where s.document_account_snapshot_id = account_values.document_account_snapshot_id
      and lower(d.owner_email) = app_private.current_owner_email()
  )
)
with check (
  exists (
    select 1
    from public.document_account_snapshots s
    join public.documents d on d.document_id = s.document_id
    where s.document_account_snapshot_id = account_values.document_account_snapshot_id
      and lower(d.owner_email) = app_private.current_owner_email()
  )
);
```

Reveal cards:

```sql
create policy "reveal cards creator or admin select"
on public.data_intelligence_v2_reveal_cards
for select
to app_authenticated
using (
  lower(owner_email) = app_private.current_owner_email()
  and (
    lower(user_email) = app_private.current_user_email()
    or app_private.current_app_role() = 'admin'
  )
);

create policy "reveal cards creator insert"
on public.data_intelligence_v2_reveal_cards
for insert
to app_authenticated
with check (
  lower(owner_email) = app_private.current_owner_email()
  and lower(user_email) = app_private.current_user_email()
);

create policy "reveal cards creator or admin update"
on public.data_intelligence_v2_reveal_cards
for update
to app_authenticated
using (
  lower(owner_email) = app_private.current_owner_email()
  and (
    lower(user_email) = app_private.current_user_email()
    or app_private.current_app_role() = 'admin'
  )
)
with check (
  lower(owner_email) = app_private.current_owner_email()
  and (
    lower(user_email) = app_private.current_user_email()
    or app_private.current_app_role() = 'admin'
  )
);
```

Audit events:

```sql
-- Prefer no client read policies for audit events.
-- If the app role writes audit events under RLS, allow append only.

create policy "audit events server append"
on public.data_intelligence_v2_audit_events
for insert
to app_authenticated
with check (
  owner_email is null
  or lower(owner_email) = app_private.current_owner_email()
);
```

Views:

```sql
-- Prefer recreating with security_invoker in a migration, or keep revoked from
-- anon/authenticated roles. Verify Postgres version support before applying.

alter view public.latest_account_snapshot_v set (security_invoker = true);
alter view public.latest_account_document_v set (security_invoker = true);
```

Force RLS and grants:

```sql
-- Draft only. Apply after policies are tested in staging.

alter table public.firm_settings force row level security;
alter table public.storage_connections force row level security;
alter table public.filing_events force row level security;
alter table public.bug_reports force row level security;
alter table public.documents force row level security;
alter table public.document_canonical_payloads force row level security;
alter table public.institutions force row level security;
alter table public.parties force row level security;
alter table public.accounts force row level security;
alter table public.account_parties force row level security;
alter table public.document_institutions force row level security;
alter table public.document_parties force row level security;
alter table public.document_party_facts force row level security;
alter table public.document_account_snapshots force row level security;
alter table public.document_account_parties force row level security;
alter table public.document_contacts force row level security;
alter table public.account_values force row level security;
alter table public.document_primary_facts force row level security;
alter table public.review_decisions force row level security;
alter table public.client_memory_rules force row level security;
alter table public.preview_analysis_cache force row level security;
alter table public.preview_snapshots force row level security;
alter table public.cleanup_file_states force row level security;
alter table public.document_tax_facts force row level security;
alter table public.data_intelligence_v2_reveal_cards force row level security;
alter table public.data_intelligence_v2_audit_events force row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on public.latest_account_snapshot_v from anon, authenticated;
revoke all on public.latest_account_document_v from anon, authenticated;
```

### Future Supabase Auth Alternative

If the app moves to Supabase Auth or sends Supabase JWTs to PostgREST, owner policies can use a trusted claim instead:

```sql
-- Only for a Supabase Auth/Data API architecture.
-- Do not use user_metadata for authorization.

create policy "<table> owner access by jwt email"
on public.<table>
for all
to authenticated
using (lower(owner_email) = lower(auth.jwt() ->> 'email'))
with check (lower(owner_email) = lower(auth.jwt() ->> 'email'));
```

For real multi-user firms, this should be replaced by durable membership tables such as `firm_memberships`, `client_access_grants`, and `account_access_grants`, keyed from trusted server-side membership data.

## 5. Tables That Should Not Be Client-Readable

For private MVP usage, the safest default is: **none of the current `public` tables should be directly client-readable through Supabase Data API.**

Especially do not expose:

- `storage_connections`: encrypted OAuth tokens and provider account identifiers.
- `document_canonical_payloads`: extracted/canonical client metadata.
- `document_party_facts`: identity facts, encrypted raw ID values, masked IDs, DOBs, expirations.
- `document_account_snapshots`, `account_values`, `accounts`: account numbers, account last four, balances/values.
- `document_tax_facts`: tax forms, box/line values, tax-year facts.
- `preview_analysis_cache` and `preview_snapshots`: cached file queue/extraction state.
- `data_intelligence_v2_reveal_cards`: reveal authorization metadata.
- `data_intelligence_v2_audit_events`: audit metadata and security decisions.
- `filing_events`: file IDs, client folders, destination paths, parser outcomes.
- `bug_reports`: reporter and free-text support data.
- `latest_account_snapshot_v` and `latest_account_document_v`: derived sensitive account/document views unless `security_invoker` and grants are verified.

If a browser needs data, continue using app API routes that return redacted, purpose-built response shapes.

## 6. Blockers And Questions Before Applying Policies

1. What database role does `SUPABASE_DB_URL_POOLER`/`SUPABASE_DB_URL` use in Vercel: `postgres`, `service_role`, a table owner, or a least-privileged role?
2. Does that role have `BYPASSRLS`, own the tables, or bypass RLS through ownership? If yes, RLS is currently defense-in-name only until role design changes.
3. Are any `public` tables currently granted to `anon` or `authenticated` through legacy Supabase Data API defaults?
4. Is the production architecture intended to stay NextAuth plus direct Postgres, or migrate to Supabase Auth/PostgREST?
5. If staying direct Postgres, where will trusted per-request context be set so RLS can know the current owner email?
6. Should `owner_email` remain the durable tenant boundary, or should the schema add `firm_id`, `org_id`, `account_id`, and membership/access tables before real users?
7. Should child tables without `owner_email` add a denormalized `owner_email` column to simplify RLS and performance, or is join-based RLS acceptable?
8. Should `latest_account_snapshot_v` and `latest_account_document_v` be moved to a private schema instead of kept in `public`?
9. Do audit events need admin/support read access in-app, and if so what durable admin role model should authorize it?
10. Should the app fail closed in production unless `PERSISTENCE_BACKEND=supabase` uses a least-privileged non-bypass role?

## Recommended Follow-Up Tasks

1. Verify Supabase table/view grants for `anon`, `authenticated`, and any app-specific DB role.
2. Create a staging-only least-privileged app DB role and test whether current app queries fail under RLS.
3. Add a request-scoped DB context strategy, or choose Supabase Auth before writing final policies.
4. Add explicit route-local auth checks to cleanup/intake POST routes even though shared helpers currently protect them.
5. Add owner predicates to projection cleanup deletes where practical, especially document-scoped deletes by `document_id`.
6. Convert or protect the two public views before any client/Data API exposure.
7. Keep all app tables ungranted to `anon`/`authenticated` until policies are written, reviewed, and tested with negative cross-owner tests.
