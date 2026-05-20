# Work Packets and Execution Lab Rollout

Status: discovery and planning only
Last updated: 2026-05-19

This document describes how RIA File Ops should evolve from document intelligence into a durable Work Packet and Execution Lab system. It is intentionally architectural. It does not define a migration to run today, and it does not implement PDF filling, browser automation, CRM writeback, DocuSign preparation, or any other execution adapter.

## Product Vision

RIA File Ops already helps advisory operations teams identify uploaded client documents, extract useful values, clean up files, and prepare workflow-ready outputs. The next product step is to turn those document intelligence capabilities into task-specific workspaces.

A user should be able to start from an RIA operations task, such as "prepare this transfer form," "check what is missing for this rollover," or "draft the account update packet." The system should connect that instruction to existing indexed documents, extracted facts, source references, missing information, model reasoning, draft outputs, and eventually reviewed execution attempts.

The durable unit should not be a chat transcript and should not be a hardcoded workflow engine. It should be a packet of task context, referenced source material, model-safe facts, missing data, plans, review artifacts, and execution runs. The model can reason flexibly inside that packet. The application should provide tools, state, policy, references, review surfaces, and value-resolution boundaries.

## Definitions

### Work Packet

A Work Packet is a durable, task-specific workspace. It captures the user's task instruction, selected or discovered client/account/document context, source-backed facts, missing information, draft outputs, and links to one or more execution runs.

A packet should:

- Reference existing documents and extracted facts by stable IDs or source references.
- Avoid duplicating uploaded documents or raw extracted payloads.
- Record what information was checked, what was found, what is missing, and which sources support each conclusion.
- Persist outside chat so users can return to it, review it, and later run execution adapters from it.
- Stay flexible enough for many RIA operations workflows without encoding each one as a rigid decision tree.

### Execution Run

An Execution Run is a persisted attempt to produce or prepare a task output from a Work Packet. Early runs may only inspect a PDF and produce a task-aware completion plan. Later runs may create draft filled PDFs, prepare browser field-fill instructions, stage CRM updates, or assemble DocuSign preparation artifacts.

A run should:

- Belong to exactly one Work Packet.
- Have a type, status, input references, model-safe plan, step records, trace events, missing data, and review artifacts.
- Use value references for sensitive data instead of asking the model to handle raw sensitive values.
- Keep raw execution values inside app-controlled resolvers and adapters.
- Be reviewable and auditable without exposing secrets or raw PII in logs, prompts, or model output.

### Execution Lab

Execution Lab is the user-facing and developer-facing surface for inspecting, planning, reviewing, debugging, and eventually executing runs. It is not a separate workflow engine. It is a review and orchestration environment layered on top of packet state, document intelligence tools, value references, and app-side execution adapters.

## Packet and Run Relationship

A Work Packet is the durable workspace. An Execution Run is an episode inside that workspace.

One packet can have many runs. For example, a packet for a transfer paperwork task might have:

- A PDF field inventory run that inspects the fillable PDF.
- A completion planning run that maps task facts to PDF fields.
- A later fake-data PDF fill run.
- A future real-data fill run after secure resolver policy exists.
- A future DocuSign preparation run.

Runs should not own the task truth. The packet should own task intent, selected source documents, fact references, missing items, and review state. Runs should own run-specific plans, adapter outputs, traces, errors, and artifacts.

## Relationship to Existing Document Intelligence

Work Packets should build on the current document intelligence stack rather than replacing it.

Existing document intelligence already provides:

- Document upload and intake from Google Drive.
- PDF/text extraction and document classification.
- Canonical document projections for account statements, identity documents, and tax documents.
- Query stores over extracted facts.
- Data Intelligence V2 tools for resolving clients, accounts, statements, tax documents, identity status, workflow requirements, missing data, and sensitive reveal cards.
- Source reference and missing-data types that are close to what packets need.

Packets should reference these existing records by ID and source reference. They should not copy document files, raw Drive payloads, raw canonical JSON, or decrypted sensitive values into packet rows.

## Existing Systems to Reuse

### Data Intelligence V2

Data Intelligence V2 is the strongest foundation for Work Packets.

Reusable pieces:

- `lib/data-intelligence-v2/types.ts` defines `V2SourceRef`, `V2MissingDataItem`, `V2ToolResult`, `SafeConversationState`, workflow types, and reveal-card concepts.
- `lib/data-intelligence-v2/field-catalog.ts` classifies data exposure and marks sensitive fields as reveal-card-only or never-expose.
- `lib/data-intelligence-v2/safe-memory.ts` sanitizes model-bound state and asserts that unsafe values are not sent to the model.
- `lib/data-intelligence-v2/system-prompt.ts` already instructs the model to rely on tools, avoid invented facts, and report missing data.
- `lib/data-intelligence-v2/tool-loop.ts` already provides a tool-using model loop with auditing and safety validation.
- `lib/data-intelligence-v2/tools/definitions.ts` and `tools/runner.ts` define a safe server-side tool boundary.
- `lib/data-intelligence-v2/existing-data-gateway.ts` adapts existing document query stores into client/account/document facts.
- `lib/data-intelligence-v2/reveal-token-service.ts` and `sensitive-value-provider.ts` provide a precedent for sensitive value indirection.
- `lib/data-intelligence-v2/audit.ts`, `postgres-audit-sink.ts`, and `postgres-reveal-token-store.ts` provide sanitized audit and reveal metadata patterns.
- `components/data-intelligence-v2/copilot-chat.tsx`, `assistant-response-view.tsx`, and `secure-reveal-card.tsx` provide UI patterns for model-safe output, source-backed facts, missing data, recommended steps, and secure reveal cards.

Recommended reuse:

- Treat packet capabilities as an extension of the V2 tool layer, not as a separate one-off agent path.
- Reuse `V2SourceRef` and `V2MissingDataItem` concepts for packet source references and missing information.
- Reuse the field catalog and exposure classifications for packet facts and value references.
- Reuse the audit safety rules for run traces.
- Reuse reveal-card and sensitive-provider ideas, but adapt them for app-only execution resolvers where raw values are not revealed to the model or chat UI.

### Existing Chatbot Routes and UI

Current chat surfaces:

- V2 chat route: `app/api/data-intelligence/v2/chat/route.ts`
- V2 service and handler: `lib/data-intelligence-v2/chat-service.ts` and `chat-api-handler.ts`
- V2 UI: `components/data-intelligence-v2/copilot-chat.tsx`
- Legacy route: `app/api/query-assistant/route.ts`
- Legacy UI: `components/data-intelligence-chat.tsx`

The V2 chat can become a command/input layer for packet creation and packet updates. However, packet state and run results should not live only in browser chat history. Chat should eventually be able to create a packet proposal, add context to an existing packet, launch a planning run, and link the user to a durable packet/run view.

### Safe Tool Layer

The V2 tool runner is already designed around model-safe tools, owner-scope authorization, argument validation, gateway calls, result sanitization, and audit events. Work Packet tools should follow that pattern.

Future packet-oriented tools could include:

- `create_work_packet_proposal`
- `attach_packet_documents`
- `list_packet_sources`
- `list_packet_facts`
- `record_packet_missing_information`
- `create_execution_run_plan`
- `inspect_pdf_fields`
- `create_value_reference`
- `validate_completion_plan`

These should be capabilities available to the model, not a hardcoded path for every RIA workflow.

### Document Upload, Intake, and Cleanup

Reusable pieces:

- `lib/intake-refresh.ts` performs explicit source refreshes, scans Drive metadata, downloads files for analysis, rebuilds preview state, and avoids doing heavy processing during ordinary navigation.
- `app/api/preview/refresh/route.ts` provides the explicit refresh API boundary.
- `lib/processing-preview.ts` runs document analysis and writes canonical document projections.
- `lib/document-intelligence.ts` performs file analysis, classification, extraction, canonical projection, and PDF field inspection.
- `lib/cleanup-approval.ts`, `lib/file-approval.ts`, and `lib/filing.ts` already separate review/approval from app-side Google Drive execution.

The cleanup and filing flow is an important execution precedent: the model or application can propose work, but the app performs the operation through a controlled adapter, records events, and keeps review/approval in the product layer.

### Extracted Document Storage

Existing canonical projection storage is the main fact substrate for packets.

Local SQLite tables include:

- `documents`
- `document_canonical_payloads`
- `parties`
- `accounts`
- `account_parties`
- `document_party_facts`
- `document_tax_facts`
- `document_account_snapshots`
- `document_account_parties`
- `document_contacts`
- `account_values`
- `document_primary_facts`

Supabase/Postgres migrations create comparable projection tables and views, including `latest_account_snapshot_v` and `latest_account_document_v`.

Important implementation detail:

- Supabase projection storage encrypts sensitive values such as account numbers and raw identity values.
- Query stores decrypt sensitive values only in server-side code.
- Data Intelligence V2 then applies model-safety policy before anything reaches the model.

Packets should reference these rows and source refs. They should not duplicate document rows or raw sensitive values.

### Google Drive and File References

Reusable pieces:

- `lib/google-drive.ts` defines Drive file metadata, download, path lookup, folder creation, move, and rename helpers.
- `lib/storage/provider-types.ts`, `google-drive-adapter.ts`, and `provider-registry.ts` provide a storage-provider boundary.
- `lib/storage-connections.ts` handles active storage connections, encrypted tokens, refresh, and write-scope checks.

Packets should store app-level document IDs and safe source references. Raw Drive file IDs should remain server-side and should not be model-bound unless a specific safe, reviewed need exists.

### Current File and Object Models

The existing system already distinguishes:

- Source provider files such as Google Drive files.
- App-level document records.
- Canonical extracted document payloads.
- Structured projection rows for clients, accounts, identities, tax facts, contacts, and values.
- Preview analysis cache and review decisions.
- Cleanup file states and filing events.

Work Packets should sit above these layers. They should compose references to documents, facts, values, and files rather than becoming another extraction store.

### Current Task and Workflow Concepts

There is no durable Work Packet or Execution Run model today. The closest existing concepts are:

- V2 workflow requirement checks for RIA workflows such as new account, transfer, rollover, tax prep, beneficiary update, address change, cash management, document verification, and general client service.
- Cleanup review/apply flows.
- Filing approval and event recording.
- Chat-driven recommended steps and missing-data reporting.

These are useful ingredients, but they do not yet create a persistent task workspace.

### PDF and File Handling Utilities

Existing PDF capabilities are inspection-oriented:

- `lib/document-intelligence.ts` extracts text and AcroForm field metadata through pdfjs.
- `scripts/extract_pdf_content.py` can inspect text, fields, and value candidates locally through pypdf.
- `scripts/extract_pdf_form_fields.swift` can inspect local PDFKit form fields.
- `tests/vercel-pdf-extraction.test.mjs` verifies text extraction and AcroForm field reads.

There is no PDF filling implementation today, and none should be added until the packet/run/value-reference boundaries are designed and reviewed.

### Feature Flags and Gating Patterns

Data Intelligence V2 provides the best current gating pattern:

- `DATA_INTELLIGENCE_V2_ENABLED`
- `DATA_INTELLIGENCE_V2_CHAT_API_ENABLED`
- `DATA_INTELLIGENCE_V2_UI_ENABLED`
- `DATA_INTELLIGENCE_V2_DEV_MOCK_ENABLED`
- `DATA_INTELLIGENCE_V2_REVEAL_API_ENABLED`
- `DATA_INTELLIGENCE_V2_ALLOW_SENSITIVE_REVEAL`
- V2 audit and reveal backend flags
- OpenAI/eval/network gates
- Preview QA secret checks

`lib/runtime-environment.ts` and `lib/persistence/backend.ts` also enforce production-like runtime behavior and fail closed when Supabase/Postgres or encryption are missing.

Packet and Execution Lab features should follow the same flag discipline:

- Fake-data MVPs only until real-data policy is ready.
- Preview/dev-only gates for prototypes.
- No production exposure without audit, retention, authorization, and redaction review.

### Existing Architecture and Security Notes

Relevant docs:

- `README.md`
- `docs/product-status.md`
- `docs/data-intelligence-v2/deployment-readiness.md`
- `docs/data-intelligence-v2/local-qa.md`
- `docs/data-intelligence-v2/evals.md`
- `docs/security/security-roadmap.md`
- `docs/debug/intake-rescan-flow-audit.md`

Important security themes already documented:

- V2 should be preferred over legacy chat for client-specific AI.
- Raw sensitive values should not be model-bound.
- Reveal cards are safer than chat transcript exposure.
- Prompt/body/value logging must stay sanitized.
- Production-like runtimes should fail closed without secure persistence and encryption.
- Browser-visible diagnostics and extracted text require stricter gating before real PII usage.
- Owner-email scope is acceptable for the private MVP but not sufficient for long-term firm/client authorization.

## Current Gaps

The codebase does not yet have:

- Work Packet domain types, persistence, routes, or UI.
- Execution Run domain types, persistence, routes, or UI.
- Durable packet results outside chat.
- A packet repository or packet-aware tool gateway.
- A run trace table specific to execution attempts.
- Persisted missing-information state attached to a packet.
- PDF template records or a durable PDF field inventory model.
- A structured completion plan schema for mapping task requirements to PDF fields.
- A value-reference model for execution adapters.
- An app-only resolver that can provide raw values to a fill adapter without exposing them to the model.
- A fake-data execution resolver for safe MVP prototyping.
- A PDF fill adapter.
- Browser fill, CRM import/writeback, Wealthbox integration, or DocuSign preparation adapters.
- Production-grade firm/client authorization beyond owner-email scoped access.
- Retention policy for future execution artifacts.

## Proposed Conceptual Data Model

This section is conceptual only. Do not create migrations until the implementation phase explicitly asks for them.

### `work_packets`

Durable task workspace.

Suggested fields:

- `packet_id`
- `owner_email` or future `workspace_id`
- `title`
- `status`
- `task_source_type`
- `task_source_ref`
- `task_instruction_summary`
- `task_instruction_safe_text`
- `client_ref`
- `household_ref`
- `account_refs`
- `source_chat_ref`
- `created_by`
- `created_at`
- `updated_at`
- `archived_at`

The packet should store task context and safe summaries, not raw PII-heavy instructions unless a later secure storage policy explicitly allows it.

### `work_packet_documents`

Join table between packets and existing document records.

Suggested fields:

- `packet_id`
- `document_id`
- `source_file_ref`
- `document_role`
- `selection_reason`
- `selected_by`
- `confidence`
- `created_at`

This table should not duplicate files, extracted text, or canonical payloads.

### `work_packet_facts`

Packet-scoped references to extracted facts.

Suggested fields:

- `packet_fact_id`
- `packet_id`
- `field_key`
- `fact_ref_type`
- `fact_ref_id`
- `source_ref_json`
- `document_id`
- `exposure_classification`
- `safe_display_value`
- `masked_preview`
- `confidence`
- `status`
- `created_at`

The row should point to facts in existing projection tables, such as account snapshots, identity facts, tax facts, contacts, and account values. Sensitive raw values should not be copied here.

### `work_packet_missing_items`

Packet-level missing information.

Suggested fields:

- `missing_item_id`
- `packet_id`
- `field_key`
- `description`
- `reason`
- `checked_source_refs`
- `checked_tool_names`
- `suggested_next_step`
- `status`
- `created_at`
- `resolved_at`

This is the durable version of the missing-data pattern already present in Data Intelligence V2.

### `execution_runs`

Run header for a packet execution or planning attempt.

Suggested fields:

- `run_id`
- `packet_id`
- `run_type`
- `adapter_kind`
- `status`
- `model_plan_version`
- `safe_input_summary`
- `safe_result_summary`
- `created_by`
- `started_at`
- `completed_at`
- `failed_at`

Early run types should be planning-only, such as `pdf_field_inventory` and `pdf_completion_plan`.

### `execution_run_steps`

Step records inside a run.

Suggested fields:

- `step_id`
- `run_id`
- `step_index`
- `step_type`
- `status`
- `tool_name`
- `adapter_name`
- `model_safe_input_ref`
- `model_safe_output_ref`
- `app_output_ref`
- `safe_error_code`
- `safe_error_summary`
- `started_at`
- `completed_at`

Steps should record what happened without storing raw sensitive values.

### `execution_value_refs`

Opaque references to values needed by execution plans.

Suggested fields:

- `value_ref_id`
- `packet_id`
- `run_id`
- `field_key`
- `target_ref_type`
- `target_ref_id`
- `source_ref_json`
- `exposure_classification`
- `resolver_kind`
- `masked_preview`
- `status`
- `created_at`

The model can reason about these refs and their statuses. Only the app resolver can turn them into raw values, and only inside an authorized execution boundary.

### `pdf_field_inventories`

Optional later table for inspected PDF form structure.

Suggested fields:

- `inventory_id`
- `packet_id`
- `run_id`
- `document_ref`
- `template_hash`
- `field_count`
- `safe_summary`
- `created_at`

### `pdf_field_inventory_items`

Optional later table for individual form fields.

Suggested fields:

- `inventory_item_id`
- `inventory_id`
- `field_name`
- `field_type`
- `page_number`
- `rect`
- `options_safe_json`
- `current_value_status`
- `nearby_label_safe_text`
- `model_safe_context`

Do not store raw field values from real client PDFs unless a future secure storage policy explicitly allows it.

### `execution_artifacts`

References to run artifacts.

Suggested fields:

- `artifact_id`
- `run_id`
- `artifact_type`
- `storage_ref`
- `checksum`
- `safe_metadata_json`
- `created_at`
- `expires_at`

Initial MVPs should avoid storing generated filled PDFs with real data. Fake-data artifacts can be allowed under explicit gates.

### `execution_trace_events`

Sanitized trace events for debugging.

Suggested fields:

- `trace_event_id`
- `run_id`
- `step_id`
- `category`
- `status`
- `tool_name`
- `adapter_name`
- `safe_metadata_json`
- `created_at`

This should follow the Data Intelligence V2 audit rule: no raw prompts, no raw values, no raw tool payloads, no tokens, no credentials, and no Drive IDs unless explicitly classified safe.

## Document and Fact Referencing

Packets should reference existing documents and facts through stable app IDs and source refs.

Recommended reference targets:

- `documents.document_id`
- `document_account_snapshots`
- `document_party_facts`
- `document_tax_facts`
- `document_contacts`
- `account_values`
- `parties`
- `accounts`
- V2 `V2SourceRef` objects

Recommended rules:

- Keep uploaded documents in the existing document store.
- Keep raw file/provider metadata in server-side storage layers.
- Store safe labels, masked previews, and source summaries for UI readability.
- Store source refs and fact refs for traceability.
- Re-query current facts when needed instead of copying raw values into packet rows.
- Record missing items when a referenced document or fact is absent.

## Chat as an Initiation Layer

Chat can be a convenient way to start a packet, but it should not be the only place packet results live.

Recommended flow:

1. User asks the V2 copilot to help with a task.
2. The V2 tool layer resolves safe client/account/document context.
3. The assistant proposes a Work Packet with source-backed facts and missing items.
4. The user confirms or edits the packet.
5. The app persists the packet.
6. The user can open the packet outside chat.
7. Runs created from the packet are persisted and visible in Execution Lab.
8. Later chat messages can add context or start more runs, but they operate on durable packet IDs.

This keeps chat useful without making chat history the system of record.

## PDF Field Intelligence

PDF field intelligence should start with inspection, not filling.

The app can use existing PDF inspection utilities to produce a field inventory:

- Field name
- Field type
- Page number
- Rectangle/position
- Options for checkboxes, radios, or selects
- Safe current-value status, such as empty, present, or unknown
- Nearby label/context text when available
- Form/template fingerprint

The model should receive a model-safe inventory. For real client documents, that means no raw filled values from the PDF unless the value is explicitly classified as safe. For fake-data MVPs, test documents can contain fake values under clear gates.

The output of field intelligence should be a structured inventory and a set of mapping candidates, not a filled PDF.

## Task-Aware Completion Planning

A completion planning run should combine:

- The user's task instruction.
- Packet documents and fact references.
- Existing source-backed facts.
- Missing information.
- PDF field inventory.
- Field exposure policy.
- Available value-reference resolver capabilities.

The model should produce a structured plan such as:

- PDF field name.
- Intended business meaning.
- Required fact or value reference.
- Source refs supporting the mapping.
- Whether the value is safe, sensitive, missing, or requires manual review.
- Confidence.
- Validation rule.
- Review note.

The model should not invent values. If the required fact is not available, the plan should record a missing item and explain what source would likely resolve it.

## Value References and Resolvers

Execution planning should use opaque value references instead of raw sensitive values.

A value reference should represent a request for a value such as:

- Account full number.
- Date of birth.
- Legal address.
- Tax ID status.
- Identity document number.
- Phone or email.
- Account registration name.

The model can see:

- The value reference ID.
- The business field key.
- The exposure classification.
- The source refs.
- The masked preview or status.
- Whether the value is available, missing, unsupported, expired, or requires user review.

The model should not see the raw sensitive value.

The app resolver can later turn a value reference into a raw value only inside an authorized execution boundary. That boundary should include purpose, packet ID, run ID, user/session, field policy, audit event, retention policy, and adapter type.

For MVP work, implement a fake-data resolver first. The fake resolver should prove the architecture without touching real PII.

## Model Role and Sensitive Data Boundary

The model should help with:

- Understanding task intent.
- Identifying which documents and facts matter.
- Inspecting model-safe PDF field inventories.
- Mapping fields to business meanings.
- Creating completion plans.
- Explaining missing information.
- Suggesting review steps.
- Producing model-safe summaries and draft notes.

The model should not:

- Receive raw SSNs, full account numbers, identity numbers, dates of birth, addresses, emails, phones, provider tokens, or secrets.
- Fill PDFs itself.
- Operate a browser with real client data.
- Write directly to a CRM.
- Decide to bypass missing information.
- Store raw values in chat history, traces, audit events, or model output.

This is the same architectural principle as Data Intelligence V2 reveal cards, extended from "show a user a sensitive value" to "let the app use a sensitive value for a reviewed execution step."

## Why the App Should Fill Values

The application layer should perform actual filling because it can:

- Resolve sensitive values without sending them to the model.
- Enforce field-level exposure policy.
- Enforce user/session authorization.
- Record sanitized run traces.
- Apply deterministic field mappings.
- Validate required fields and formats.
- Produce reviewable artifacts.
- Retry or roll back adapter operations.
- Keep raw values out of prompts, completions, browser state, and logs.

The model should create and explain the plan. The app should execute the plan.

## Execution Traces and Debug Tables

Execution traces should be designed for review and debugging without leaking sensitive values.

Trace events should include:

- Run and step IDs.
- Tool or adapter name.
- Status.
- Safe field keys.
- Source refs.
- Value ref IDs.
- Timing.
- Sanitized error codes and messages.
- Model-safe summaries.

Trace events should exclude:

- Raw resolved values.
- Raw prompts containing sensitive instructions.
- Raw PDF contents from real client files.
- Full provider file IDs if not classified safe.
- OAuth tokens, refresh tokens, encryption keys, credentials, cookies, or external service payloads.

For real-data versions, trace retention should be short, explicit, and configurable.

## MVP Scope

The first implementation MVP should stay small and fake-data only.

Recommended MVP:

- Add packet and run domain contracts.
- Reuse V2 source refs, missing data, field exposure classifications, and audit concepts.
- Add tests for packet/run/value-ref serialization and policy classification.
- Add no external dependencies.
- Add no production execution features.
- Add no PDF filling.
- Add no browser automation.
- Add no CRM or DocuSign integration.
- Add no migrations until the schema is reviewed.

The first product-facing MVP after schema review could:

- Create a Work Packet from a V2 chat proposal.
- Persist packet metadata, document refs, fact refs, and missing items.
- Inspect a fake fillable PDF and persist a model-safe field inventory.
- Produce a task-aware completion plan using fake data and value references.
- Show the packet/run result in an existing or explicitly approved review surface.
- Require human review before any later execution adapter exists.

## Explicit Non-Goals

For this planning task:

- Do not implement Work Packets.
- Do not implement Execution Lab.
- Do not build PDF filling.
- Do not build browser automation.
- Do not create new UI routes.
- Do not add database migrations.
- Do not add new dependencies.
- Do not change production env files, secrets, Vercel settings, Supabase credentials, or external service configs.

For early implementation phases:

- Do not use real PII in execution prototypes.
- Do not duplicate documents into packet storage.
- Do not hardcode every RIA workflow.
- Do not let model output become the only source of truth.
- Do not let the model handle raw sensitive execution values.
- Do not write directly to external systems without explicit product, security, and review gates.

## Recommended Implementation Phases

### Phase 0: Discovery and Rollout Plan

Complete this document and use it as the starting point for future packet/execution work.

### Phase 1: Domain Contracts Only

Add TypeScript domain contracts for Work Packets, Execution Runs, value references, completion plans, missing information, and execution trace events.

Contract location: `lib/work-packets/types.ts`, exported through `lib/work-packets/index.ts`.

Constraints:

- No routes.
- No migrations.
- No execution adapters.
- No dependencies.
- No production flags changed.

### Phase 2: Persistence Design and Migration Review

Draft migrations for packet/run persistence after the contracts are reviewed.

Review focus:

- Document and fact references.
- Sensitive value exclusion.
- RLS/authorization model.
- Audit and trace retention.
- Fake-data gates.
- Supabase encryption requirements.

### Phase 3: Packet Creation from Existing V2 Chat

Allow V2 chat to propose or create a packet from model-safe context.

The chat should pass packet commands through safe tools. Packet state should persist outside chat.

### Phase 4: PDF Field Inventory

Use existing PDF inspection utilities to inventory fields from a fake-data fillable PDF.

Output should be inspection only:

- Field inventory.
- Safe field context.
- Missing/unknown field labels.
- No filling.

### Phase 5: Task-Aware Completion Planning

Create planning runs that map packet facts and value refs to PDF fields.

Output should be:

- Structured completion plan.
- Confidence and rationale.
- Missing items.
- Human review notes.
- No filled artifact.

### Phase 6: Fake-Data PDF Fill Adapter

Only after planning and review surfaces are stable, add a fake-data-only PDF fill adapter. This should prove app-side filling and tracing without real PII.

### Phase 7: Secure Real-Data Resolver

Design and implement a secure/session-only resolver for real data.

Requirements:

- Explicit authorization.
- Field policy checks.
- Purpose-bound resolution.
- Short-lived session.
- Sanitized audit.
- No raw values in model output or traces.
- Retention policy.

### Phase 8: Future Execution Adapters

Add adapters only after the packet/run/value-ref foundation is proven.

Candidate adapters:

- PDF fill.
- Browser field fill.
- Wealthbox or other CRM task import/writeback.
- DocuSign preparation.
- Secure fill sessions.

## Security and PII Principles

For fake-data MVPs:

- Use fake client data only.
- Gate prototypes to local/dev/preview as appropriate.
- Do not mix fake execution fixtures with production data.
- Keep tests and evals synthetic.
- Keep model-bound values inside the Data Intelligence V2 safety envelope.

For later real-data versions:

- Keep raw sensitive values out of model prompts, completions, traces, audit metadata, and chat history.
- Store references instead of duplicating values.
- Resolve sensitive values only inside app-controlled, purpose-bound execution sessions.
- Use field-level exposure policy for every value.
- Require explicit user review before producing or sending execution artifacts.
- Encrypt sensitive persisted data.
- Keep retention short and intentional.
- Strengthen authorization beyond owner-email scope before broad production use.
- Gate diagnostics that expose extracted text, PDF field values, source file IDs, or raw document details.
- Preserve sanitized audit trails for who initiated, reviewed, resolved, and executed each run.

## Dev-Only Jon Smith Fidelity TOA Demo Target

Near-term demo target: "Complete the TOA form for Jon Smith's transfer from his Ameriprise IRA to his Fidelity IRA."

Local template convention:

- Place the fillable PDF manually at `local-dev/pdf-templates/fidelity-toa-template.pdf`.
- Do not commit the PDF.
- `local-dev/` is gitignored for dev-only artifacts.

Implemented Phase 1 demo scaffold:

- `lib/work-packets/dev-demo/jon-smith-fidelity-toa.ts` defines fake Jon Smith, fake Fidelity receiving IRA, fake Ameriprise delivering IRA, fake full in-kind transfer instruction, model-facing value refs, masked resolver previews, a Work Packet, an Execution Run, and a task-aware completion plan scaffold.
- `lib/work-packets/pdf-field-inventory.ts` inspects local fillable PDFs with the existing `pdfjs-dist` dependency and returns model-safe field inventories. It records field names, inferred types, options when available, positions when available, and current-value status without copying raw field values.
- `scripts/inspect-work-packets-fidelity-toa-demo.mjs` prints a safe dev summary. If the local PDF exists, it inspects fields first; otherwise it builds the scaffold with a missing-template-inventory item.
- `tests/work-packets-fidelity-toa-demo.test.mjs` checks that the fake demo builds a model-safe packet/run and does not serialize fake raw SSNs, full account numbers, address, or email.
- `lib/work-packets/pdf-fill-adapter.ts` provides a dev-only PDF copy/fill adapter that consumes a completion plan and an app-layer resolver. It fills only resolved value-ref text fields, skips unresolved option/radio fields and intentionally blank fields, and emits a masked execution trace.
- `scripts/fill-work-packets-fidelity-toa-demo.mjs` writes the fake-data filled output to `local-dev/generated/jon-smith-fidelity-toa-filled.pdf` and prints only destination field names, value refs, masked previews, statuses, and reasons.
- `lib/work-packets/pdf-option-mapping.ts` and `scripts/generate-work-packets-fidelity-toa-option-mapping.mjs` generate isolated dev-only option probe PDFs under `local-dev/generated/option-mapping/` so numeric radio/checkbox export values can be manually confirmed before the main demo fill selects any options.
- `scripts/inspect-work-packets-fidelity-toa-option-visuals.mjs` renders those probe PDFs with macOS PDFKit/Swift, compares each probe against `blank-control.pdf`, writes visual debug PNGs under `local-dev/generated/option-mapping/visual-debug/`, and reports only high-confidence demo option mappings. It fails closed to `manual_review_required` if the changed checkbox region is missing or ambiguous.
- The fake-data fill demo now uses a tiny confirmed-option allowlist in `lib/work-packets/dev-demo/fidelity-toa-option-mapping.ts`: `Type=7` for the receiving Traditional/SEP/Rollover IRA option, `Type2=7` for the delivering Traditional/SEP/Rollover IRA option, and `Trans=1` for Section 3.A full in-kind transfer. `NewAcct` remains intentionally blank because the fake client has an existing Fidelity account number.
- `scripts/verify-work-packets-fidelity-toa-demo.mjs` reads the generated fake-data PDF with pypdf, verifies expected text fields and confirmed options, confirms intentionally skipped fields remain blank, and prints a safe summary that does not include raw fake SSNs or full account numbers.
- `scripts/build-work-packets-fidelity-toa-review-artifact.mjs` writes `local-dev/generated/jon-smith-fidelity-toa-execution-review.json`, a model-safe handoff that combines task/run metadata, safe task context, completion-plan summary, masked fill trace, output PDF reference, verification summary, and review flags for a future Execution Lab view.
- `lib/work-packets/dev-demo/fidelity-toa-execution-review-view-model.ts` and `scripts/view-work-packets-fidelity-toa-review-artifact.mjs` load that local review artifact and shape it into a dev-only Execution Lab view model with header, task context, completion plan, fill trace, verification, review flag, and artifact reference sections. This is the first display handoff shape for a future UI; it does not add routes or persistence.
- `components/work-packets/execution-lab-review-surface.tsx` renders that safe view model as the first reusable Execution Lab review display surface. The hidden route at `/dev/execution-lab/fidelity-toa` is not linked from navigation; it is session-gated in local development and owner/admin-gated in production through the existing waitlist/admin email gate.
- `scripts/run-work-packets-fidelity-toa-demo.mjs` runs the full fake-data dev pipeline in one command: check for the local Fidelity TOA template, fill the copied PDF, verify the output, build the review artifact, load the view-model summary, and print the hidden local route to inspect the result.
- `lib/work-packets/dev-demo/local-execution-review-artifact-registry.ts` is a server-only local artifact selector. It maps stable dev run ids such as `jon-smith-fidelity-toa` to known JSON files under `local-dev/generated`, rejects path-like ids, loads the existing safe view model, and lets `/dev/execution-lab/fidelity-toa?run=jon-smith-fidelity-toa` select the current artifact without accepting raw file paths.
- `app/dev/execution-lab/fidelity-toa/actions.ts`, `app/dev/execution-lab/fidelity-toa/pdf/[runId]/route.ts`, and `lib/work-packets/dev-demo/website-fidelity-toa-demo.ts` add a website-runnable fake-data demo path. An authorized developer uploads the Fidelity TOA template from the hidden route, the server uses fake Jon Smith data to fill and verify the PDF, and the page displays the safe view model with Open PDF and Download PDF links.
- Local terminal scripts may still use Python/pypdf for dev inspection and verification. The website/Vercel path uses Node-native PDF filling and readback through `pdf-lib`, because Vercel's Node serverless runtime does not provide a Python package environment for importing pypdf inside a spawned `python3` process.
- The website-run path does not use `local-dev/pdf-templates` or `local-dev/generated`. Because no durable private object store exists yet, it stores the generated PDF and safe review artifact in a temporary server-only in-memory registry keyed by the signed-in owner and stable demo id. This is acceptable only for the protected fake-data demo; it is not production persistence and may be lost on server restart or serverless instance changes.

Future stored-template support:

- Store reusable PDF templates in a private Supabase Storage bucket, not as blobs in normal database tables.
- Store template metadata later in a table, including template id, custodian/form family, display label, storage object key, fingerprint/hash, version, active status, created-by metadata, and created/updated timestamps.
- Fetch stored templates only through server-side, admin-gated code paths. The browser should never receive arbitrary storage keys or direct bucket access.
- Keep the current upload path as an optional one-off override for testing newer template versions before promoting them to the stored current template.
- Track template fingerprints and versions so form updates can be detected before reusing stale field mappings or completion plans.
- Future UI can offer "Use stored current Fidelity TOA template" and "Upload one-off template for this run" as explicit choices.

Still intentionally not implemented:

- Browser automation.
- External custodian access.
- CRM, DocuSign, Wealthbox, Fidelity, Schwab, or other integrations.
- Database migrations or production persistence tables.
- Real-data value resolution.
- Production navigation or durable execution artifact storage.

Recommended next step for the demo: replace the temporary server-memory website demo store with an explicit private artifact storage design for templates, generated PDFs, and safe review artifacts before any real-data execution work.

## Future Extensions

### PDF Fill

The app fills PDFs from reviewed completion plans and value refs. The model creates the mapping and review explanation. The app resolves values, writes fields, validates output, and records traces.

### Browser Fill

Browser fill should use the same packet/run/value-ref architecture. The browser adapter should receive field actions and resolved values from the app boundary, not from model text.

### Wealthbox and CRM

CRM task import could create Work Packets from external task instructions. CRM writeback should be a reviewed execution adapter with strict authorization and trace events.

### DocuSign

DocuSign prep could assemble recipient roles, document packets, field tags, and review metadata. Sending should remain a separate reviewed action.

### Secure Fill Sessions

A secure fill session should be a short-lived execution boundary that can resolve raw values for a specific packet, run, adapter, user, and purpose. It should not expose raw values back to the model.

## Open Questions

- What is the first real task type to support: transfer forms, account opening, address changes, beneficiary updates, or something else?
- Should packet creation begin from chat, uploaded form selection, CRM task import, or a manual "new packet" action?
- What is the correct long-term authorization model for firm, team, client, and household access?
- Which extracted fact rows should get stable public reference IDs before packet persistence?
- How should packet status map to user review states?
- How much of the original task instruction can be stored safely when real PII is present?
- Should PDF field inventories be stored per document, per template hash, or per run?
- Where should generated artifacts live, and how long should they be retained?
- What is the minimum review UI needed before fake-data PDF filling?
- How should value references represent unsupported or unavailable sensitive fields?
- What additional audit events are required beyond the current Data Intelligence V2 audit categories?
- Which diagnostics should be hidden or support-gated before real execution features exist?

## Recommended Next Codex Implementation Prompt

Use this as the next implementation prompt after reviewing this rollout plan:

```text
Read docs/work-packets-execution-lab-rollout.md before making changes. Implement Phase 1 only: add TypeScript domain contracts for Work Packets, Execution Runs, value references, completion plans, missing information, and execution trace events. Reuse existing Data Intelligence V2 types where appropriate, especially source refs, missing-data concepts, field exposure classifications, and model-safe boundaries. Do not add routes, UI routes, database migrations, dependencies, PDF filling, browser automation, CRM/DocuSign integration, external service config changes, production env changes, or real PII handling. Add focused tests or type-level validation only if they fit existing project patterns and remain fast.
```

## Codex Operating Notes

Future Codex runs working on packet or execution-related changes should:

- Read this rollout doc before packet/execution-related changes.
- Reuse existing systems before creating new ones.
- Do not hardcode every RIA workflow.
- Prefer capabilities, tools, and value references over rigid decision trees.
- Keep documents referenced by ID/source rather than duplicated.
- Keep model output separate from sensitive value resolution.
- Keep implementation steps small and reviewable.
- Avoid external service changes unless explicitly requested.
