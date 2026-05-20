import type { CanonicalDocumentTypeId, CanonicalSourceRef } from "@/lib/canonical-extracted-document";
import type {
  DefaultMaskingStrategy,
  ModelExposureClassification,
  RevealPurpose,
  SensitiveField,
  SensitiveValueStatus,
  V2MissingDataItem,
  V2SafeFact,
  V2SourceRef,
  V2WorkflowType,
} from "@/lib/data-intelligence-v2/types";

export type WorkPacketId = string;
export type ExecutionRunId = string;
export type ValueRefId = string;
export type FieldInventoryId = string;
export type DestinationFieldId = string;
export type CompletionPlanId = string;
export type DraftOutputId = string;
export type ExecutionTraceEventId = string;

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export type ModelSafeScalar = string | number | boolean | null;

export type ModelSafeJsonValue =
  | ModelSafeScalar
  | ModelSafeJsonValue[]
  | { [key: string]: ModelSafeJsonValue };

// Free-form metadata must remain model-safe: no raw sensitive values, tokens,
// provider secrets, raw prompts, raw tool payloads, or raw document contents.
export type ModelSafeMetadata = Record<string, ModelSafeJsonValue>;

export type WorkPacketSourceType =
  | "chat"
  | "manual"
  | "future_crm"
  | "future_api";

export type ExecutionRunSource =
  | "chat"
  | "manual"
  | "test"
  | "future_agent";

export type WorkPacketStatus =
  | "draft"
  | "assembling"
  | "active"
  | "ready_for_review"
  | "blocked_missing_information"
  | "completed"
  | "cancelled"
  | "archived";

export type ExecutionRunStatus =
  | "draft"
  | "queued"
  | "inspecting"
  | "planning"
  | "planned"
  | "awaiting_review"
  | "blocked_missing_information"
  | "blocked_policy"
  | "completed"
  | "failed"
  | "cancelled";

export type CompletionPlanStatus =
  | "draft"
  | "ready_for_review"
  | "approved"
  | "blocked_missing_information"
  | "superseded";

export type DraftOutputStatus =
  | "draft"
  | "ready_for_review"
  | "approved"
  | "superseded"
  | "archived";

export type WorkPacketActorRef = {
  actorType: "user" | "system" | "model" | "test";
  userEmail?: string;
  userId?: string;
  displayName?: string;
};

export type WorkPacketTaskTypeHint =
  | V2WorkflowType
  | {
      kind: "custom";
      key: string;
      label?: string;
    }
  | {
      kind: "unknown";
      label?: string;
    };

export type WorkPacketTaskContext = {
  goal: string;
  instruction: string;
  safeSummary?: string;
  taskTypeHint?: WorkPacketTaskTypeHint;
  constraints?: string[];
  sourceRefs?: SourceRef[];
  metadata?: ModelSafeMetadata;
};

export type EntityRefType =
  | "client"
  | "contact"
  | "household"
  | "account"
  | "party"
  | "institution"
  | "unknown";

export type EntityRef = {
  entityType: EntityRefType;
  entityId: string;
  label?: string;
  sourceRefs?: SourceRef[];
  confidence?: ConfidenceLevel;
  metadata?: ModelSafeMetadata;
};

export type SourceSystem =
  | "data_intelligence_v2"
  | "document_projection"
  | "canonical_extraction"
  | "storage_provider"
  | "work_packet"
  | "execution_lab"
  | "manual"
  | "future_external";

export type SafeCanonicalSourceRef = Omit<CanonicalSourceRef, "value"> & {
  valueWasNotCopied: true;
};

export type SourceRef = V2SourceRef & {
  sourceSystem?: SourceSystem;
  canonicalSourceRef?: SafeCanonicalSourceRef;
  metadata?: ModelSafeMetadata;
};

export type ProviderFileRef = {
  provider: "google_drive" | "local_upload" | "future_external" | "unknown";
  sourceFileId?: string;
  safeLabel?: string;
  modelExposure: "server_only" | "safe_label_only";
};

export type PacketDocumentRole =
  | "task_source"
  | "supporting_document"
  | "destination_form"
  | "identity_evidence"
  | "account_evidence"
  | "tax_evidence"
  | "review_artifact"
  | "other";

export type PacketDocumentRef = {
  documentId: string;
  role: PacketDocumentRole;
  label?: string;
  documentTypeId?: CanonicalDocumentTypeId | "unknown";
  sourceFileRef?: ProviderFileRef;
  sourceRefs?: SourceRef[];
  confidence?: ConfidenceLevel;
  selectedBy?: WorkPacketActorRef;
  selectionReason?: string;
  metadata?: ModelSafeMetadata;
};

export type DocumentFactRefType =
  | "document"
  | "document_canonical_payload"
  | "document_primary_fact"
  | "document_party_fact"
  | "document_tax_fact"
  | "document_account_snapshot"
  | "document_account_party"
  | "document_contact"
  | "account_value"
  | "party"
  | "account"
  | "institution"
  | "v2_safe_fact"
  | "manual_safe_fact"
  | "future_external_fact";

export type DocumentFactRef = {
  refType: DocumentFactRefType;
  refId: string;
  fieldKey?: string;
  label?: string;
  documentId?: string;
  sourceRefs?: SourceRef[];
  confidence?: ConfidenceLevel;
  metadata?: ModelSafeMetadata;
};

export type MaskedValuePreview = {
  display: string;
  strategy: DefaultMaskingStrategy | "custom";
  last4?: string;
  valueWasNotShownToModel: true;
};

export type ValueResolverKind =
  | "none"
  | "safe_literal"
  | "document_fact"
  | "sensitive_value_provider"
  | "fake_data"
  | "manual_entry"
  | "future_secure_session";

export type ValueResolverPolicy = {
  resolverKind: ValueResolverKind;
  purpose?: RevealPurpose;
  requiresUserReview: boolean;
  allowModelAccess:
    | "safe_value_allowed"
    | "masked_preview_only"
    | "never_model_bound";
  notes?: string;
  metadata?: ModelSafeMetadata;
};

export type ValueRefStatus =
  | SensitiveValueStatus
  | "available_safe"
  | "available_masked"
  | "requires_review"
  | "expired"
  | "not_requested";

export type ValueRefTarget = {
  targetType:
    | "client"
    | "contact"
    | "household"
    | "account"
    | "institution"
    | "document"
    | "document_fact"
    | "destination_field"
    | "manual"
    | "unknown";
  targetId?: string;
  documentFactRef?: DocumentFactRef;
};

export type ValueRef = {
  valueRefId: ValueRefId;
  // Examples: client.legal_name, client.ssn, receiving_account.number.
  fieldKey: string;
  label?: string;
  target?: ValueRefTarget;
  sensitivity: ModelExposureClassification;
  sensitiveField?: SensitiveField;
  status: ValueRefStatus;
  maskedPreview?: MaskedValuePreview;
  sourceRefs?: SourceRef[];
  resolverPolicy: ValueResolverPolicy;
  createdAt?: string;
  expiresAt?: string;
  metadata?: ModelSafeMetadata;
};

export type WorkPacketKnownFact = Omit<
  V2SafeFact,
  "value" | "sourceRefs" | "confidence"
> & {
  safeValue?: ModelSafeScalar;
  exposureClassification: ModelExposureClassification;
  maskedPreview?: MaskedValuePreview;
  valueRefId?: ValueRefId;
  factRef?: DocumentFactRef;
  sourceRefs: SourceRef[];
  confidence: ConfidenceLevel;
  status: "available" | "stale" | "needs_review" | "superseded";
  metadata?: ModelSafeMetadata;
};

export type MissingItemSeverity = "info" | "warning" | "blocking";

export type MissingItemStatus =
  | "open"
  | "resolved"
  | "waived"
  | "superseded";

export type MissingItem = Omit<V2MissingDataItem, "checked"> & {
  missingItemId: string;
  fieldKey?: string;
  checked: string[];
  checkedSourceRefs?: SourceRef[];
  severity: MissingItemSeverity;
  priority?: number;
  status: MissingItemStatus;
  createdAt?: string;
  resolvedAt?: string;
  metadata?: ModelSafeMetadata;
};

export type ReviewFlagType =
  | "missing_information"
  | "uncertain_mapping"
  | "conflicting_sources"
  | "low_confidence"
  | "sensitive_value"
  | "policy_review"
  | "manual_confirmation"
  | "adapter_limitation"
  | "other";

export type ReviewFlag = {
  reviewFlagId: string;
  flagType: ReviewFlagType;
  severity: MissingItemSeverity;
  message: string;
  fieldId?: DestinationFieldId;
  valueRefId?: ValueRefId;
  missingItemId?: string;
  sourceRefs?: SourceRef[];
  status: "open" | "resolved" | "waived" | "superseded";
  createdAt?: string;
  resolvedAt?: string;
  metadata?: ModelSafeMetadata;
};

export type DestinationFieldType =
  | "text"
  | "textarea"
  | "checkbox"
  | "radio"
  | "select"
  | "date"
  | "signature"
  | "initials"
  | "calculated"
  | "unknown";

export type DestinationFieldRequiredness =
  | "required"
  | "optional"
  | "conditional"
  | "unknown";

export type DestinationFieldOption = {
  optionId?: string;
  label: string;
  exportValue?: string;
  modelSafeValue?: ModelSafeScalar;
  meaning?: string;
  metadata?: ModelSafeMetadata;
};

export type FieldPosition = {
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type DestinationField = {
  fieldId: DestinationFieldId;
  name: string;
  label?: string;
  meaning?: string;
  fieldType: DestinationFieldType;
  requiredness: DestinationFieldRequiredness;
  options?: DestinationFieldOption[];
  sourceDocumentRef?: PacketDocumentRef;
  sourceRefs?: SourceRef[];
  position?: FieldPosition;
  currentValueStatus?: "empty" | "present" | "unknown" | "not_applicable";
  confidence?: ConfidenceLevel;
  metadata?: ModelSafeMetadata;
};

export type FieldInventorySourceKind =
  | "pdf_form"
  | "browser_form"
  | "crm_form"
  | "manual_template"
  | "unknown";

export type FieldInventoryExtractionMethod =
  | "pdfjs"
  | "pypdf"
  | "pdfkit"
  | "manual"
  | "future_adapter"
  | "unknown";

export type FieldInventory = {
  inventoryId: FieldInventoryId;
  sourceKind: FieldInventorySourceKind;
  sourceDocumentRef?: PacketDocumentRef;
  templateFingerprint?: string;
  extractionMethod?: FieldInventoryExtractionMethod;
  fields: DestinationField[];
  safeSummary?: string;
  reviewFlags?: ReviewFlag[];
  createdAt?: string;
  metadata?: ModelSafeMetadata;
};

export type CompletionPlanFieldValue =
  | {
      valueKind: "value_ref";
      valueRefId: ValueRefId;
      maskedPreview?: MaskedValuePreview;
    }
  | {
      valueKind: "explicit_safe_value";
      value: ModelSafeScalar;
      exposureClassification:
        | "safe_to_model"
        | "client_confidential_to_model";
    }
  | {
      valueKind: "checkbox_state";
      checked: boolean;
      valueRefId?: ValueRefId;
      selectedOption?: DestinationFieldOption;
    }
  | {
      valueKind: "select_option";
      valueRefId?: ValueRefId;
      selectedOption: DestinationFieldOption;
    }
  | {
      valueKind: "date_value";
      valueRefId?: ValueRefId;
      safeDate?: string;
      maskedPreview?: MaskedValuePreview;
    }
  | {
      valueKind: "intentionally_blank";
      reason: string;
    }
  | {
      valueKind: "missing";
      missingItemId?: string;
      reason: string;
    }
  | {
      valueKind: "manual_review_required";
      reason: string;
    };

export type CompletionPlanFieldAction =
  | "fill"
  | "check"
  | "select"
  | "leave_blank"
  | "skip"
  | "manual_review";

export type CompletionPlanField = {
  planFieldId: string;
  destinationFieldId: DestinationFieldId;
  destinationField?: DestinationField;
  action: CompletionPlanFieldAction;
  plannedValue: CompletionPlanFieldValue;
  reason: string;
  confidence: ConfidenceLevel;
  sourceRefs?: SourceRef[];
  reviewFlags?: ReviewFlag[];
  missingItemIds?: string[];
  metadata?: ModelSafeMetadata;
};

export type CompletionPlan = {
  completionPlanId: CompletionPlanId;
  packetId?: WorkPacketId;
  runId?: ExecutionRunId;
  status: CompletionPlanStatus;
  destinationDocumentRef?: PacketDocumentRef;
  fieldInventoryId?: FieldInventoryId;
  fields: CompletionPlanField[];
  valueRefs?: ValueRef[];
  missingItems?: MissingItem[];
  reviewFlags?: ReviewFlag[];
  safeSummary?: string;
  createdBy?: WorkPacketActorRef;
  createdAt?: string;
  updatedAt?: string;
  metadata?: ModelSafeMetadata;
};

export type DraftOutputType =
  | "crm_note_draft"
  | "client_email_draft"
  | "review_summary"
  | "pdf_field_plan"
  | "future_output_artifact"
  | "other";

export type DraftOutputRef = {
  outputId: DraftOutputId;
  outputType: DraftOutputType;
  title: string;
  status: DraftOutputStatus;
  safeSummary?: string;
  contentRef?: string;
  artifactRef?: string;
  sourceRefs?: SourceRef[];
  reviewFlags?: ReviewFlag[];
  createdBy?: WorkPacketActorRef;
  createdAt?: string;
  updatedAt?: string;
  metadata?: ModelSafeMetadata;
};

export type OutputArtifactRef = {
  artifactId: string;
  artifactType:
    | "field_inventory"
    | "completion_plan"
    | "review_summary"
    | "draft_document"
    | "future_execution_output"
    | "other";
  storageRef?: string;
  checksum?: string;
  safeSummary?: string;
  createdAt?: string;
  expiresAt?: string;
  metadata?: ModelSafeMetadata;
};

export type ExecutionTraceEventType =
  | "field_inventory_created"
  | "completion_plan_created"
  | "value_ref_created"
  | "value_ref_resolved_masked"
  | "pdf_fill_planned"
  | "output_created"
  | "review_flag_created"
  | "missing_item_recorded"
  | "adapter_skipped"
  | "error"
  | "custom";

export type ExecutionTraceEventCategory =
  | "packet"
  | "run"
  | "field_inventory"
  | "completion_plan"
  | "value_ref"
  | "output"
  | "error"
  | "system";

export type ExecutionTraceEvent = {
  traceEventId: ExecutionTraceEventId;
  runId?: ExecutionRunId;
  stepId?: string;
  eventType: ExecutionTraceEventType;
  eventCategory: ExecutionTraceEventCategory;
  status?: ExecutionRunStatus | "success" | "warning" | "skipped";
  fieldId?: DestinationFieldId;
  valueRefId?: ValueRefId;
  documentId?: string;
  sourceRefs?: SourceRef[];
  message?: string;
  metadata?: ModelSafeMetadata;
  createdAt: string;
};

export type ExecutionErrorInfo = {
  code: string;
  safeMessage: string;
  retryable?: boolean;
  sourceRefs?: SourceRef[];
  metadata?: ModelSafeMetadata;
};

export type ExecutionRunType =
  | "field_inventory"
  | "completion_plan"
  | "pdf_fill_planned"
  | "draft_output"
  | "future_execution_adapter"
  | "custom";

export type ExecutionRun = {
  id: ExecutionRunId;
  packetId?: WorkPacketId;
  source: ExecutionRunSource;
  runType: ExecutionRunType;
  status: ExecutionRunStatus;
  taskContext: WorkPacketTaskContext;
  formDocumentRefs?: PacketDocumentRef[];
  fieldInventories?: FieldInventory[];
  completionPlan?: CompletionPlan;
  valueRefs?: ValueRef[];
  maskedResolverPreviews?: MaskedValuePreview[];
  reviewFlags?: ReviewFlag[];
  traceEvents?: ExecutionTraceEvent[];
  outputArtifactRefs?: OutputArtifactRef[];
  draftOutputs?: DraftOutputRef[];
  error?: ExecutionErrorInfo;
  createdBy?: WorkPacketActorRef;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  metadata?: ModelSafeMetadata;
};

export type ExecutionRunRef = {
  runId: ExecutionRunId;
  runType: ExecutionRunType;
  status: ExecutionRunStatus;
  safeSummary?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkPacket = {
  id: WorkPacketId;
  title: string;
  task: WorkPacketTaskContext;
  status: WorkPacketStatus;
  sourceType: WorkPacketSourceType;
  sourceRef?: string;
  clientRefs?: EntityRef[];
  contactRefs?: EntityRef[];
  householdRefs?: EntityRef[];
  accountRefs?: EntityRef[];
  documentRefs: PacketDocumentRef[];
  factRefs?: DocumentFactRef[];
  knownFacts: WorkPacketKnownFact[];
  valueRefs?: ValueRef[];
  missingItems: MissingItem[];
  reviewFlags?: ReviewFlag[];
  draftOutputs?: DraftOutputRef[];
  executionRunRefs?: ExecutionRunRef[];
  ownerEmail?: string;
  workspaceId?: string;
  createdBy?: WorkPacketActorRef;
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string;
  metadata?: ModelSafeMetadata;
};
