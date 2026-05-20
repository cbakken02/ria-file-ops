import type {
  CompletionPlan,
  CompletionPlanField,
  DestinationField,
  DestinationFieldOption,
  ExecutionRun,
  ExecutionTraceEvent,
  FieldInventory,
  MaskedValuePreview,
  MissingItem,
  PacketDocumentRef,
  ReviewFlag,
  SourceRef,
  ValueRef,
  ValueRefId,
  ValueRefTarget,
  WorkPacket,
  WorkPacketKnownFact,
} from "@/lib/work-packets/types";
import { JON_SMITH_FIDELITY_TOA_CONFIRMED_OPTION_MAPPINGS } from "@/lib/work-packets/dev-demo/fidelity-toa-option-mapping";

export const JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH =
  "local-dev/pdf-templates/fidelity-toa-template.pdf";

export const JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH =
  "local-dev/generated/jon-smith-fidelity-toa-filled.pdf";

export const JON_SMITH_FIDELITY_TOA_TASK =
  "Complete the TOA form for Jon Smith's transfer from his Ameriprise IRA to his Fidelity IRA.";

const DEMO_PACKET_ID = "wp_dev_jon_smith_fidelity_toa";
const DEMO_RUN_ID = "run_dev_jon_smith_fidelity_toa_plan";
const DEMO_COMPLETION_PLAN_ID = "plan_dev_jon_smith_fidelity_toa";
const DEMO_CREATED_AT = "2026-05-19T00:00:00.000Z";

const DEMO_SOURCE_REF: SourceRef = {
  sourceId: "dev_fixture_jon_smith_fidelity_toa",
  sourceType: "system_record",
  sourceSystem: "manual",
  label: "Jon Smith Fidelity TOA dev-only fake fixture",
  confidence: "high",
};

export const JON_SMITH_FIDELITY_TOA_TEMPLATE_REF: PacketDocumentRef = {
  documentId: "dev_pdf_template_fidelity_toa",
  role: "destination_form",
  label: "Dev-only Fidelity TOA PDF template",
  documentTypeId: "unknown",
  sourceFileRef: {
    provider: "local_upload",
    safeLabel: JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
    modelExposure: "safe_label_only",
  },
  sourceRefs: [DEMO_SOURCE_REF],
  confidence: "high",
  selectionReason:
    "Developer places the fillable Fidelity TOA template locally; the PDF is ignored by git.",
  metadata: {
    templatePath: JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
    devOnly: true,
  },
};

type DemoValueRole =
  | "client"
  | "receiving_account"
  | "delivering_account"
  | "delivering_firm"
  | "transfer";

type DemoValueDefinition = {
  valueRefId: ValueRefId;
  fieldKey: string;
  label: string;
  rawValue: string;
  sensitivity:
    | "safe_to_model"
    | "client_confidential_to_model"
    | "masked_only_to_model"
    | "reveal_card_only_never_to_model";
  sensitiveField?: ValueRef["sensitiveField"];
  maskStrategy: MaskedValuePreview["strategy"];
  role: DemoValueRole;
  target: ValueRefTarget;
};

const DEMO_VALUES: DemoValueDefinition[] = [
  {
    valueRefId: "value_ref_client_legal_name",
    fieldKey: "client.legal_name",
    label: "Client legal name",
    rawValue: "Jon Smith",
    sensitivity: "safe_to_model",
    maskStrategy: "none",
    role: "client",
    target: { targetType: "client", targetId: "dev_client_jon_smith" },
  },
  {
    valueRefId: "value_ref_client_ssn",
    fieldKey: "client.ssn",
    label: "Client SSN",
    rawValue: "000126789",
    sensitivity: "reveal_card_only_never_to_model",
    sensitiveField: "ssn",
    maskStrategy: "last4",
    role: "client",
    target: { targetType: "client", targetId: "dev_client_jon_smith" },
  },
  {
    valueRefId: "value_ref_client_dob",
    fieldKey: "client.dob",
    label: "Client date of birth",
    rawValue: "1974-03-18",
    sensitivity: "reveal_card_only_never_to_model",
    sensitiveField: "dob",
    maskStrategy: "date_status_only",
    role: "client",
    target: { targetType: "client", targetId: "dev_client_jon_smith" },
  },
  {
    valueRefId: "value_ref_client_address",
    fieldKey: "client.address",
    label: "Client mailing address",
    rawValue: "123 Demo Lane, Boston, MA 02110",
    sensitivity: "reveal_card_only_never_to_model",
    sensitiveField: "address",
    maskStrategy: "city_state_only",
    role: "client",
    target: { targetType: "client", targetId: "dev_client_jon_smith" },
  },
  {
    valueRefId: "value_ref_client_phone",
    fieldKey: "client.phone",
    label: "Client phone",
    rawValue: "6175550184",
    sensitivity: "reveal_card_only_never_to_model",
    sensitiveField: "phone",
    maskStrategy: "masked",
    role: "client",
    target: { targetType: "client", targetId: "dev_client_jon_smith" },
  },
  {
    valueRefId: "value_ref_client_email",
    fieldKey: "client.email",
    label: "Client email",
    rawValue: "jon.smith@example.test",
    sensitivity: "reveal_card_only_never_to_model",
    sensitiveField: "email",
    maskStrategy: "masked",
    role: "client",
    target: { targetType: "client", targetId: "dev_client_jon_smith" },
  },
  {
    valueRefId: "value_ref_receiving_custodian",
    fieldKey: "receiving_account.custodian",
    label: "Receiving account custodian",
    rawValue: "Fidelity",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "none",
    role: "receiving_account",
    target: { targetType: "account", targetId: "dev_account_fidelity_ira" },
  },
  {
    valueRefId: "value_ref_receiving_account_type",
    fieldKey: "receiving_account.type",
    label: "Receiving account type",
    rawValue: "Traditional/Rollover IRA",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "none",
    role: "receiving_account",
    target: { targetType: "account", targetId: "dev_account_fidelity_ira" },
  },
  {
    valueRefId: "value_ref_receiving_account_number",
    fieldKey: "receiving_account.account_number",
    label: "Receiving Fidelity account number",
    rawValue: "900012345",
    sensitivity: "reveal_card_only_never_to_model",
    sensitiveField: "full_account_number",
    maskStrategy: "last4",
    role: "receiving_account",
    target: { targetType: "account", targetId: "dev_account_fidelity_ira" },
  },
  {
    valueRefId: "value_ref_receiving_registration",
    fieldKey: "receiving_account.registration_name",
    label: "Receiving account registration",
    rawValue: "Jon Smith Traditional IRA",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "none",
    role: "receiving_account",
    target: { targetType: "account", targetId: "dev_account_fidelity_ira" },
  },
  {
    valueRefId: "value_ref_delivering_firm_name",
    fieldKey: "delivering_firm.name",
    label: "Delivering firm name",
    rawValue: "Ameriprise",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "none",
    role: "delivering_firm",
    target: { targetType: "institution", targetId: "dev_firm_ameriprise" },
  },
  {
    valueRefId: "value_ref_delivering_firm_address_line1",
    fieldKey: "delivering_firm.address.line1",
    label: "Delivering firm address line 1",
    rawValue: "100 Ameriprise Demo Way",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "masked",
    role: "delivering_firm",
    target: { targetType: "institution", targetId: "dev_firm_ameriprise" },
  },
  {
    valueRefId: "value_ref_delivering_firm_address_city",
    fieldKey: "delivering_firm.address.city",
    label: "Delivering firm city",
    rawValue: "Minneapolis",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "masked",
    role: "delivering_firm",
    target: { targetType: "institution", targetId: "dev_firm_ameriprise" },
  },
  {
    valueRefId: "value_ref_delivering_firm_address_state",
    fieldKey: "delivering_firm.address.state",
    label: "Delivering firm state",
    rawValue: "MN",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "masked",
    role: "delivering_firm",
    target: { targetType: "institution", targetId: "dev_firm_ameriprise" },
  },
  {
    valueRefId: "value_ref_delivering_firm_address_zip",
    fieldKey: "delivering_firm.address.zip",
    label: "Delivering firm ZIP",
    rawValue: "55402",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "masked",
    role: "delivering_firm",
    target: { targetType: "institution", targetId: "dev_firm_ameriprise" },
  },
  {
    valueRefId: "value_ref_delivering_firm_phone",
    fieldKey: "delivering_firm.phone",
    label: "Delivering firm phone",
    rawValue: "8005550199",
    sensitivity: "client_confidential_to_model",
    sensitiveField: "phone",
    maskStrategy: "last4",
    role: "delivering_firm",
    target: { targetType: "institution", targetId: "dev_firm_ameriprise" },
  },
  {
    valueRefId: "value_ref_delivering_custodian",
    fieldKey: "delivering_account.custodian",
    label: "Delivering account custodian",
    rawValue: "Ameriprise",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "none",
    role: "delivering_account",
    target: { targetType: "account", targetId: "dev_account_ameriprise_ira" },
  },
  {
    valueRefId: "value_ref_delivering_account_type",
    fieldKey: "delivering_account.type",
    label: "Delivering account type",
    rawValue: "Traditional IRA",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "none",
    role: "delivering_account",
    target: { targetType: "account", targetId: "dev_account_ameriprise_ira" },
  },
  {
    valueRefId: "value_ref_delivering_account_number",
    fieldKey: "delivering_account.account_number",
    label: "Delivering Ameriprise account number",
    rawValue: "234567890",
    sensitivity: "reveal_card_only_never_to_model",
    sensitiveField: "full_account_number",
    maskStrategy: "last4",
    role: "delivering_account",
    target: { targetType: "account", targetId: "dev_account_ameriprise_ira" },
  },
  {
    valueRefId: "value_ref_transfer_scope",
    fieldKey: "transfer.scope",
    label: "Transfer scope",
    rawValue: "Full transfer",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "none",
    role: "transfer",
    target: { targetType: "manual", targetId: "dev_transfer_instruction" },
  },
  {
    valueRefId: "value_ref_transfer_kind",
    fieldKey: "transfer.kind",
    label: "Transfer kind",
    rawValue: "In-kind transfer",
    sensitivity: "client_confidential_to_model",
    maskStrategy: "none",
    role: "transfer",
    target: { targetType: "manual", targetId: "dev_transfer_instruction" },
  },
];

export type JonSmithFidelityToaResolverPreview = {
  valueRefId: ValueRefId;
  fieldKey: string;
  label: string;
  status: ValueRef["status"];
  maskedPreview: MaskedValuePreview;
  rawValueWasNotReturned: true;
};

export type JonSmithFidelityToaResolvedValue =
  | {
      status: "resolved";
      valueRefId: ValueRefId;
      rawValue: string;
      maskedPreview: MaskedValuePreview;
    }
  | {
      status: "not_found";
      valueRefId: ValueRefId;
      reason: string;
    };

export type JonSmithFidelityToaDemo = {
  packet: WorkPacket;
  run: ExecutionRun;
  completionPlan: CompletionPlan;
  valueRefs: ValueRef[];
  resolverPreviews: JonSmithFidelityToaResolverPreview[];
};

type FieldMapping = {
  key: string;
  destinationLabel: string;
  meaning: string;
  fieldType: DestinationField["fieldType"];
  requiredness?: DestinationField["requiredness"];
  fieldNames?: string[];
  patterns: RegExp[];
  valueRefId?: ValueRefId;
  action: CompletionPlanField["action"];
  reason: string;
  confidence: CompletionPlanField["confidence"];
  plannedValue:
    | "value_ref"
    | "date_value"
    | "select_option"
    | "checkbox_true"
    | "manual_review_required"
    | "intentionally_blank";
  optionLabel?: string;
  confirmedOption?: DestinationFieldOption;
  reviewFlag?: ReviewFlag;
};

type BlankFieldMappingEntry = [
  key: string,
  fieldName: string,
  reason: string,
  fieldType?: DestinationField["fieldType"],
];

export function buildJonSmithFidelityToaDemo(options: {
  fieldInventory?: FieldInventory;
  createdAt?: string;
} = {}): JonSmithFidelityToaDemo {
  const valueRefs = buildJonSmithFidelityToaValueRefs(options.createdAt);
  const completionPlan = buildJonSmithFidelityToaCompletionPlan({
    fieldInventory: options.fieldInventory,
    valueRefs,
    createdAt: options.createdAt,
  });
  const run = buildJonSmithFidelityToaExecutionRun({
    fieldInventory: options.fieldInventory,
    completionPlan,
    valueRefs,
    createdAt: options.createdAt,
  });
  const packet = buildJonSmithFidelityToaWorkPacket({
    completionPlan,
    valueRefs,
    createdAt: options.createdAt,
  });

  return {
    packet,
    run,
    completionPlan,
    valueRefs,
    resolverPreviews: previewJonSmithFidelityToaResolverValues(valueRefs),
  };
}

export function buildJonSmithFidelityToaValueRefs(createdAt = DEMO_CREATED_AT): ValueRef[] {
  return DEMO_VALUES.map((definition) => ({
    valueRefId: definition.valueRefId,
    fieldKey: definition.fieldKey,
    label: definition.label,
    target: definition.target,
    sensitivity: definition.sensitivity,
    sensitiveField: definition.sensitiveField,
    status: valueStatusForDefinition(definition),
    maskedPreview: buildMaskedPreview(definition),
    sourceRefs: [DEMO_SOURCE_REF],
    resolverPolicy: {
      resolverKind: "fake_data",
      purpose: "form_completion",
      requiresUserReview: definition.sensitivity !== "safe_to_model",
      allowModelAccess: modelAccessForDefinition(definition),
      notes:
        "Dev-only fake resolver fixture. Raw fake value is reserved for app-layer resolution.",
      metadata: {
        devOnly: true,
        role: definition.role,
      },
    },
    createdAt,
    metadata: {
      devOnly: true,
      role: definition.role,
    },
  }));
}

export function previewJonSmithFidelityToaResolverValues(
  valueRefs = buildJonSmithFidelityToaValueRefs(),
): JonSmithFidelityToaResolverPreview[] {
  return valueRefs.map((valueRef) => {
    const definition = findDefinition(valueRef.valueRefId);

    return {
      valueRefId: valueRef.valueRefId,
      fieldKey: valueRef.fieldKey,
      label: valueRef.label ?? definition.label,
      status: valueRef.status,
      maskedPreview: buildMaskedPreview(definition),
      rawValueWasNotReturned: true,
    };
  });
}

export function resolveJonSmithFidelityToaFakeValue(
  valueRefId: ValueRefId,
): JonSmithFidelityToaResolvedValue {
  const definition = DEMO_VALUES.find((candidate) => candidate.valueRefId === valueRefId);

  if (!definition) {
    return {
      status: "not_found",
      valueRefId,
      reason: "Unknown Jon Smith Fidelity TOA fake value ref.",
    };
  }

  return {
    status: "resolved",
    valueRefId,
    rawValue: definition.rawValue,
    maskedPreview: buildMaskedPreview(definition),
  };
}

export function buildJonSmithFidelityToaCompletionPlan(options: {
  fieldInventory?: FieldInventory;
  valueRefs?: ValueRef[];
  packetId?: string;
  runId?: string;
  createdAt?: string;
} = {}): CompletionPlan {
  const createdAt = options.createdAt ?? DEMO_CREATED_AT;
  const valueRefs = options.valueRefs ?? buildJonSmithFidelityToaValueRefs(createdAt);
  const missingItems = buildCompletionPlanMissingItems(options.fieldInventory, createdAt);
  const mappings = buildFieldMappings();
  const fields = mappings.map((mapping) =>
    buildCompletionPlanField(mapping, valueRefs, options.fieldInventory),
  );
  const reviewFlags = [
    ...fields.flatMap((field) => field.reviewFlags ?? []),
    ...missingItems.map((item) => reviewFlagForMissingItem(item, createdAt)),
  ];

  return {
    completionPlanId: DEMO_COMPLETION_PLAN_ID,
    packetId: options.packetId ?? DEMO_PACKET_ID,
    runId: options.runId ?? DEMO_RUN_ID,
    status:
      missingItems.length > 0
        ? "blocked_missing_information"
        : "ready_for_review",
    destinationDocumentRef: JON_SMITH_FIDELITY_TOA_TEMPLATE_REF,
    fieldInventoryId: options.fieldInventory?.inventoryId,
    fields,
    valueRefs,
    missingItems,
    reviewFlags,
    safeSummary:
      "Dev-only Jon Smith TOA plan maps client, receiving Fidelity IRA, delivering Ameriprise IRA, and full in-kind transfer fields to value refs.",
    createdBy: { actorType: "system", displayName: "Dev fixture" },
    createdAt,
    updatedAt: createdAt,
    metadata: {
      devOnly: true,
      fixture: "jon_smith_fidelity_toa",
      rawValuesWereNotIncluded: true,
    },
  };
}

function buildJonSmithFidelityToaWorkPacket(options: {
  completionPlan: CompletionPlan;
  valueRefs: ValueRef[];
  createdAt?: string;
}): WorkPacket {
  const createdAt = options.createdAt ?? DEMO_CREATED_AT;

  return {
    id: DEMO_PACKET_ID,
    title: "Jon Smith Fidelity TOA demo packet",
    task: {
      goal: "Complete a Fidelity TOA form for a fake Jon Smith IRA transfer.",
      instruction: JON_SMITH_FIDELITY_TOA_TASK,
      safeSummary:
        "Fake-data demo for transferring Jon Smith's Ameriprise Traditional IRA to a Fidelity Traditional/Rollover IRA.",
      taskTypeHint: "transfer",
      sourceRefs: [DEMO_SOURCE_REF],
      metadata: {
        devOnly: true,
      },
    },
    status:
      options.completionPlan.status === "blocked_missing_information"
        ? "blocked_missing_information"
        : "ready_for_review",
    sourceType: "manual",
    sourceRef: "dev_fixture_jon_smith_fidelity_toa",
    clientRefs: [
      {
        entityType: "client",
        entityId: "dev_client_jon_smith",
        label: "Jon Smith",
        sourceRefs: [DEMO_SOURCE_REF],
        confidence: "high",
        metadata: { devOnly: true },
      },
    ],
    accountRefs: [
      {
        entityType: "account",
        entityId: "dev_account_fidelity_ira",
        label: "Fidelity Traditional/Rollover IRA",
        sourceRefs: [DEMO_SOURCE_REF],
        confidence: "high",
        metadata: { accountRole: "receiving" },
      },
      {
        entityType: "account",
        entityId: "dev_account_ameriprise_ira",
        label: "Ameriprise Traditional IRA",
        sourceRefs: [DEMO_SOURCE_REF],
        confidence: "high",
        metadata: { accountRole: "delivering" },
      },
    ],
    documentRefs: [JON_SMITH_FIDELITY_TOA_TEMPLATE_REF],
    knownFacts: buildKnownFacts(),
    valueRefs: options.valueRefs,
    missingItems: options.completionPlan.missingItems ?? [],
    reviewFlags: options.completionPlan.reviewFlags ?? [],
    draftOutputs: [
      {
        outputId: "draft_output_dev_pdf_field_plan",
        outputType: "pdf_field_plan",
        title: "Jon Smith Fidelity TOA field plan",
        status: "ready_for_review",
        safeSummary:
          "Maps PDF destination fields to fake-data value refs; no PDF has been filled.",
        sourceRefs: [DEMO_SOURCE_REF],
        createdBy: { actorType: "system", displayName: "Dev fixture" },
        createdAt,
        updatedAt: createdAt,
        metadata: { devOnly: true },
      },
    ],
    executionRunRefs: [
      {
        runId: DEMO_RUN_ID,
        runType: "completion_plan",
        status:
          options.completionPlan.status === "blocked_missing_information"
            ? "blocked_missing_information"
            : "planned",
        safeSummary: "Dev-only completion plan scaffold.",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    ownerEmail: "dev-only@example.test",
    createdBy: { actorType: "system", displayName: "Dev fixture" },
    createdAt,
    updatedAt: createdAt,
    metadata: {
      devOnly: true,
      rawValuesWereNotIncluded: true,
    },
  };
}

function buildJonSmithFidelityToaExecutionRun(options: {
  fieldInventory?: FieldInventory;
  completionPlan: CompletionPlan;
  valueRefs: ValueRef[];
  createdAt?: string;
}): ExecutionRun {
  const createdAt = options.createdAt ?? DEMO_CREATED_AT;
  const traceEvents = buildTraceEvents(options.fieldInventory, createdAt);

  return {
    id: DEMO_RUN_ID,
    packetId: DEMO_PACKET_ID,
    source: "test",
    runType: "completion_plan",
    status:
      options.completionPlan.status === "blocked_missing_information"
        ? "blocked_missing_information"
        : "planned",
    taskContext: {
      goal: "Plan a fake Jon Smith Fidelity TOA completion.",
      instruction: JON_SMITH_FIDELITY_TOA_TASK,
      safeSummary:
        "Create a task-aware plan that separates receiving Fidelity IRA fields from delivering Ameriprise IRA fields.",
      taskTypeHint: "transfer",
      sourceRefs: [DEMO_SOURCE_REF],
      metadata: { devOnly: true },
    },
    formDocumentRefs: [JON_SMITH_FIDELITY_TOA_TEMPLATE_REF],
    fieldInventories: options.fieldInventory ? [options.fieldInventory] : undefined,
    completionPlan: options.completionPlan,
    valueRefs: options.valueRefs,
    maskedResolverPreviews: previewJonSmithFidelityToaResolverValues(options.valueRefs).map(
      (preview) => preview.maskedPreview,
    ),
    reviewFlags: options.completionPlan.reviewFlags,
    traceEvents,
    outputArtifactRefs: [
      {
        artifactId: "artifact_dev_completion_plan",
        artifactType: "completion_plan",
        safeSummary:
          "Model-safe completion plan scaffold only; no filled PDF artifact exists.",
        createdAt,
        metadata: {
          devOnly: true,
          rawValuesWereNotIncluded: true,
        },
      },
    ],
    draftOutputs: [
      {
        outputId: "draft_output_dev_review_summary",
        outputType: "review_summary",
        title: "Jon Smith Fidelity TOA review summary",
        status: "draft",
        safeSummary:
          "Review account type export values and full in-kind checkbox mapping before any future fill.",
        sourceRefs: [DEMO_SOURCE_REF],
        createdAt,
        updatedAt: createdAt,
        metadata: { devOnly: true },
      },
    ],
    createdBy: { actorType: "system", displayName: "Dev fixture" },
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
    metadata: {
      devOnly: true,
      rawValuesWereNotIncluded: true,
    },
  };
}

function buildKnownFacts(): WorkPacketKnownFact[] {
  return [
    knownFact("client.legal_name", "Client legal name", "Jon Smith", "safe_to_model"),
    knownFact(
      "receiving_account.custodian",
      "Receiving custodian",
      "Fidelity",
      "client_confidential_to_model",
    ),
    knownFact(
      "receiving_account.type",
      "Receiving account type",
      "Traditional/Rollover IRA",
      "client_confidential_to_model",
    ),
    knownFact(
      "receiving_account.last4",
      "Receiving account number last four",
      "Account ending 2345",
      "masked_only_to_model",
    ),
    knownFact(
      "delivering_account.custodian",
      "Delivering custodian",
      "Ameriprise",
      "client_confidential_to_model",
    ),
    knownFact(
      "delivering_firm.name",
      "Delivering firm name",
      "Ameriprise",
      "client_confidential_to_model",
    ),
    knownFact(
      "delivering_firm.address.city_state_zip",
      "Delivering firm city/state/ZIP",
      "Masked fake location",
      "masked_only_to_model",
    ),
    knownFact(
      "delivering_account.type",
      "Delivering account type",
      "Traditional IRA",
      "client_confidential_to_model",
    ),
    knownFact(
      "delivering_account.last4",
      "Delivering account number last four",
      "Account ending 7890",
      "masked_only_to_model",
    ),
    knownFact(
      "transfer.scope",
      "Transfer scope",
      "Full in-kind transfer",
      "client_confidential_to_model",
    ),
  ];
}

function knownFact(
  fieldKey: string,
  label: string,
  displayValue: string,
  exposureClassification: WorkPacketKnownFact["exposureClassification"],
): WorkPacketKnownFact {
  return {
    factId: `fact_${fieldKey.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    fieldKey,
    label,
    displayValue,
    safeValue: displayValue,
    exposureClassification,
    sourceRefs: [DEMO_SOURCE_REF],
    confidence: "high",
    status: "available",
    metadata: {
      devOnly: true,
      rawSensitiveValueWasNotCopied: true,
    },
  };
}

function buildCompletionPlanMissingItems(
  fieldInventory: FieldInventory | undefined,
  createdAt: string,
): MissingItem[] {
  if (fieldInventory && fieldInventory.fields.length > 0) {
    return [];
  }

  return [
    {
      missingItemId: "missing_local_fidelity_toa_field_inventory",
      item: "Local Fidelity TOA PDF field inventory",
      checked: [JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH],
      checkedSourceRefs: [DEMO_SOURCE_REF],
      reason:
        "The dev-only local PDF template has not been inspected yet. Place the template locally and run the dev inspector before filling.",
      suggestedNextStep:
        "Place the fillable PDF at local-dev/pdf-templates/fidelity-toa-template.pdf.",
      severity: "warning",
      priority: 1,
      status: "open",
      createdAt,
      metadata: { devOnly: true },
    },
  ];
}

function buildFieldMappings(): FieldMapping[] {
  return [
    {
      key: "client_legal_name",
      destinationLabel: "AcctOwner",
      meaning: "Jon Smith as the account owner on the TOA request.",
      fieldType: "text",
      fieldNames: ["AcctOwner"],
      patterns: [/^acctowner$/i],
      valueRefId: "value_ref_client_legal_name",
      action: "fill",
      reason: "The TOA owner should match the client on both IRA accounts.",
      confidence: "high",
      plannedValue: "value_ref",
    },
    {
      key: "client_ssn",
      destinationLabel: "Social Security or Taxpayer ID Number",
      meaning: "Sensitive owner tax identifier required by many TOA forms.",
      fieldType: "text",
      fieldNames: ["Social Security or Taxpayer ID Number"],
      patterns: [/ssn/i, /social.*security/i, /\btin\b/i, /tax.*id/i],
      valueRefId: "value_ref_client_ssn",
      action: "fill",
      reason: "Use a sensitive value ref; do not expose the raw SSN to the model.",
      confidence: "medium",
      plannedValue: "value_ref",
    },
    {
      key: "additional_owner_ssn",
      destinationLabel: "AddSocial Security or Taxpayer ID Number",
      meaning: "Additional owner tax identifier is blank for this single-owner demo.",
      fieldType: "text",
      fieldNames: ["AddSocial Security or Taxpayer ID Number"],
      patterns: [/^addsocial security or taxpayer id number$/i],
      action: "leave_blank",
      reason: "Jon Smith is the only owner in the fake demo task.",
      confidence: "medium",
      plannedValue: "intentionally_blank",
    },
    {
      key: "receiving_new_account_indicator",
      destinationLabel: "NewAcct",
      meaning: "Fidelity new-account/current-account option group.",
      fieldType: "radio",
      fieldNames: ["NewAcct"],
      patterns: [/^newacct$/i],
      action: "leave_blank",
      reason:
        "Jon Smith already has a receiving Fidelity account number, so the new-account option remains unselected.",
      confidence: "high",
      plannedValue: "intentionally_blank",
    },
    {
      key: "receiving_account_type",
      destinationLabel: "Type",
      meaning: "Receiving Fidelity account type option group.",
      fieldType: "radio",
      fieldNames: ["Type"],
      patterns: [/^type$/i],
      valueRefId: "value_ref_receiving_account_type",
      action: "select",
      reason:
        "The dev visual option inspector confirmed Type export value 7 for the receiving Traditional/SEP/Rollover IRA option.",
      confidence: "high",
      plannedValue: "select_option",
      confirmedOption: confirmedOption(
        "receivingTraditionalIra",
        "confirmed_option_receiving_traditional_rollover_ira",
      ),
    },
    {
      key: "additional_owner_name",
      destinationLabel: "AddAcctOwner",
      meaning: "Additional account owner is blank for this single-owner demo.",
      fieldType: "text",
      fieldNames: ["AddAcctOwner"],
      patterns: [/^addacctowner$/i],
      action: "leave_blank",
      reason: "Jon Smith is the only owner in the fake demo task.",
      confidence: "medium",
      plannedValue: "intentionally_blank",
    },
    {
      key: "receiving_account_number",
      destinationLabel: "AcctNumber",
      meaning: "The Fidelity IRA account that will receive the transfer.",
      fieldType: "text",
      fieldNames: ["AcctNumber"],
      patterns: [/^acctnumber$/i],
      valueRefId: "value_ref_receiving_account_number",
      action: "fill",
      reason: "Receiving account number is sensitive and must be resolved by the app.",
      confidence: "high",
      plannedValue: "value_ref",
    },
    {
      key: "delivering_account_number",
      destinationLabel: "AcctNumber2",
      meaning: "The Ameriprise IRA account being transferred.",
      fieldType: "text",
      fieldNames: ["AcctNumber2"],
      patterns: [/^acctnumber2$/i],
      valueRefId: "value_ref_delivering_account_number",
      action: "fill",
      reason:
        "Use AcctNumber2 as the tentative delivering/source account number field for the fake TOA demo.",
      confidence: "medium",
      plannedValue: "value_ref",
      reviewFlag: {
        reviewFlagId: "review_acctnumber2_delivering_account_meaning",
        flagType: "manual_confirmation",
        severity: "warning",
        message:
          "Confirm visually that AcctNumber2 is the delivering/source account number and not a second receiving account number.",
        status: "open",
        createdAt: DEMO_CREATED_AT,
        metadata: { devOnly: true },
      },
    },
    {
      key: "acct_owner_2",
      destinationLabel: "AcctOwner2",
      meaning: "Second owner field is blank for this single-owner demo.",
      fieldType: "text",
      fieldNames: ["AcctOwner2"],
      patterns: [/^acctowner2$/i],
      action: "leave_blank",
      reason: "Jon Smith is the only owner in the fake demo task.",
      confidence: "medium",
      plannedValue: "intentionally_blank",
    },
    {
      key: "delivering_firm_name",
      destinationLabel: "FirmName",
      meaning: "The firm currently holding the IRA assets.",
      fieldType: "text",
      fieldNames: ["FirmName"],
      patterns: [/^firmname$/i],
      valueRefId: "value_ref_delivering_firm_name",
      action: "fill",
      reason: "The delivering firm is Ameriprise for this fake task.",
      confidence: "high",
      plannedValue: "value_ref",
    },
    {
      key: "delivering_firm_address_line1",
      destinationLabel: "FirmAddress",
      meaning: "The delivering Ameriprise firm address line 1.",
      fieldType: "text",
      fieldNames: ["FirmAddress"],
      patterns: [/^firmaddress$/i],
      valueRefId: "value_ref_delivering_firm_address_line1",
      action: "fill",
      reason:
        "FirmAddress belongs to the delivering firm, not Jon Smith's client address.",
      confidence: "high",
      plannedValue: "value_ref",
    },
    {
      key: "delivering_firm_state",
      destinationLabel: "StateProvince",
      meaning: "The delivering Ameriprise firm state.",
      fieldType: "text",
      fieldNames: ["StateProvince"],
      patterns: [/^stateprovince$/i],
      valueRefId: "value_ref_delivering_firm_address_state",
      action: "fill",
      reason: "StateProvince belongs to the delivering firm address.",
      confidence: "high",
      plannedValue: "value_ref",
    },
    {
      key: "delivering_firm_city",
      destinationLabel: "FirmCity",
      meaning: "The delivering Ameriprise firm city.",
      fieldType: "text",
      fieldNames: ["FirmCity"],
      patterns: [/^firmcity$/i],
      valueRefId: "value_ref_delivering_firm_address_city",
      action: "fill",
      reason: "FirmCity belongs to the delivering firm address.",
      confidence: "high",
      plannedValue: "value_ref",
    },
    {
      key: "delivering_firm_zip",
      destinationLabel: "FirmZIP",
      meaning: "The delivering Ameriprise firm ZIP/postal code.",
      fieldType: "text",
      fieldNames: ["FirmZIP"],
      patterns: [/^firmzip$/i],
      valueRefId: "value_ref_delivering_firm_address_zip",
      action: "fill",
      reason: "FirmZIP belongs to the delivering firm address.",
      confidence: "high",
      plannedValue: "value_ref",
    },
    {
      key: "delivering_account_type",
      destinationLabel: "Type2",
      meaning: "Delivering Ameriprise account type option group.",
      fieldType: "radio",
      fieldNames: ["Type2"],
      patterns: [/^type2$/i],
      valueRefId: "value_ref_delivering_account_type",
      action: "select",
      reason:
        "The dev visual option inspector confirmed Type2 export value 7 for the delivering Traditional/SEP/Rollover IRA option.",
      confidence: "high",
      plannedValue: "select_option",
      confirmedOption: confirmedOption(
        "deliveringTraditionalIra",
        "confirmed_option_delivering_traditional_rollover_ira",
      ),
    },
    {
      key: "delivering_account_type_other",
      destinationLabel: "Other2",
      meaning: "Other account type text is blank unless Type2 is manually confirmed as Other.",
      fieldType: "text",
      fieldNames: ["Other2"],
      patterns: [/^other2$/i],
      action: "leave_blank",
      reason:
        "The delivering account type is Traditional IRA, so the Other account type text should stay blank unless manual review says otherwise.",
      confidence: "medium",
      plannedValue: "intentionally_blank",
    },
    {
      key: "transfer_scope",
      destinationLabel: "Trans",
      meaning: "Transfer scope/type option group.",
      fieldType: "radio",
      fieldNames: ["Trans"],
      patterns: [/^trans$/i],
      valueRefId: "value_ref_transfer_scope",
      action: "select",
      reason:
        "The dev visual option inspector confirmed Trans export value 1 for Section 3.A option 1, transfer the entire account in kind.",
      confidence: "high",
      plannedValue: "select_option",
      confirmedOption: confirmedOption(
        "fullInKindTransfer",
        "confirmed_option_full_in_kind_transfer",
      ),
    },
    {
      key: "transfer_type_other",
      destinationLabel: "Other1",
      meaning: "Other transfer instruction text is blank unless manually required.",
      fieldType: "text",
      fieldNames: ["Other1"],
      patterns: [/^other1$/i],
      action: "leave_blank",
      reason:
        "The demo task is a full in-kind transfer, so Other transfer instruction text is not used unless manual review says otherwise.",
      confidence: "medium",
      plannedValue: "intentionally_blank",
    },
    {
      key: "delivering_firm_phone",
      destinationLabel: "FirmPhone",
      meaning: "The delivering Ameriprise firm phone number.",
      fieldType: "text",
      fieldNames: ["FirmPhone"],
      patterns: [/^firmphone$/i],
      valueRefId: "value_ref_delivering_firm_phone",
      action: "fill",
      reason: "FirmPhone belongs to the delivering firm contact information.",
      confidence: "high",
      plannedValue: "value_ref",
    },
    {
      key: "print_account_owner",
      destinationLabel: "PrintAcctOwner",
      meaning: "Printed owner name, not a signature.",
      fieldType: "text",
      fieldNames: ["PrintAcctOwner"],
      patterns: [/^printacctowner$/i],
      valueRefId: "value_ref_client_legal_name",
      action: "fill",
      reason: "PrintAcctOwner appears to be a printed-name field rather than a signature field.",
      confidence: "medium",
      plannedValue: "value_ref",
      reviewFlag: {
        reviewFlagId: "review_printacctowner_not_signature",
        flagType: "manual_confirmation",
        severity: "warning",
        message:
          "Confirm visually that PrintAcctOwner is a printed-name field and not an e-signature field.",
        status: "open",
        createdAt: DEMO_CREATED_AT,
        metadata: { devOnly: true },
      },
    },
    {
      key: "print_account_owner_2",
      destinationLabel: "PrintAcctOwner2",
      meaning: "Second printed owner name is blank for this single-owner demo.",
      fieldType: "text",
      fieldNames: ["PrintAcctOwner2"],
      patterns: [/^printacctowner2$/i],
      action: "leave_blank",
      reason: "Jon Smith is the only owner in the fake demo task.",
      confidence: "medium",
      plannedValue: "intentionally_blank",
    },
    {
      key: "signature_date",
      destinationLabel: "Date MM DD YYYY",
      meaning: "Signature/date field should be left blank for human execution.",
      fieldType: "date",
      fieldNames: ["Date MM DD YYYY"],
      patterns: [/^date mm dd yyyy$/i],
      action: "leave_blank",
      reason: "Signature/date fields should not be filled by this planning scaffold.",
      confidence: "medium",
      plannedValue: "intentionally_blank",
    },
    {
      key: "partial_transfer_amount",
      destinationLabel: "CashAmmt",
      meaning: "Leave partial transfer amount blank for a full transfer.",
      fieldType: "text",
      fieldNames: ["CashAmmt"],
      patterns: [/^cashammt$/i],
      action: "leave_blank",
      reason:
        "The task is a full in-kind transfer, so cash/partial transfer amount should stay blank unless manual review changes the instruction.",
      confidence: "medium",
      plannedValue: "intentionally_blank",
    },
    ...blankFieldMappings([
      ["security_1", "Security1", "No specific security rows are needed for the full-transfer demo."],
      ["shares_1", "Shares1", "No share quantity rows are needed for the full-transfer demo."],
      ["security_2", "Security2", "No specific security rows are needed for the full-transfer demo."],
      ["shares_2", "Shares2", "No share quantity rows are needed for the full-transfer demo."],
      ["security_3", "Security3", "No specific security rows are needed for the full-transfer demo."],
      ["shares_3", "Shares3", "No share quantity rows are needed for the full-transfer demo."],
      ["security_4", "Security4", "No specific security rows are needed for the full-transfer demo."],
      ["shares_4", "Shares4", "No share quantity rows are needed for the full-transfer demo."],
      ["security_5", "Security5", "No specific security rows are needed for the full-transfer demo."],
      ["shares_5", "Shares5", "No share quantity rows are needed for the full-transfer demo."],
      ["security_6", "Security6", "No specific security rows are needed for the full-transfer demo."],
      ["shares_6", "Shares6", "No share quantity rows are needed for the full-transfer demo."],
      ["annuity_amount", "AnnuityAmmt1", "No annuity amount is planned for the fake TOA demo."],
      ["annuity_date", "AnnuityDate", "No annuity date is planned for the fake TOA demo.", "date"],
      ["annuity_shares", "AnnuityShares", "No annuity shares are planned for the fake TOA demo."],
      ["cd_date", "CDDate", "No CD maturity date is planned for the fake TOA demo.", "date"],
    ]),
    ...optionReviewMappings(),
  ];
}

function blankFieldMappings(
  entries: BlankFieldMappingEntry[],
): FieldMapping[] {
  return entries.map(([key, fieldName, reason, fieldType = "text"]) => ({
    key,
    destinationLabel: fieldName,
    meaning: reason,
    fieldType,
    fieldNames: [fieldName],
    patterns: [new RegExp(`^${fieldName}$`, "i")],
    action: "leave_blank",
    reason,
    confidence: "medium",
    plannedValue: "intentionally_blank",
  }));
}

function optionReviewMappings(): FieldMapping[] {
  return [
    optionReviewMapping(
      "security_action_4",
      "Action4",
      "Confirm Action4 option codes before selecting any security-row action.",
    ),
    optionReviewMapping(
      "security_action_5",
      "Action5",
      "Confirm Action5 option codes before selecting any security-row action.",
    ),
    optionReviewMapping(
      "security_action_6",
      "Action6",
      "Confirm Action6 option codes before selecting any security-row action.",
    ),
    optionReviewMapping(
      "annuity_option",
      "Annuity",
      "Confirm Annuity option codes before using annuity-related fields.",
    ),
    optionReviewMapping(
      "drip_option",
      "DRIP",
      "Confirm DRIP option codes before choosing dividend reinvestment treatment.",
    ),
    optionReviewMapping(
      "bank_option",
      "Bank",
      "Confirm Bank option codes before using bank/CD transfer fields.",
    ),
  ];
}

function optionReviewMapping(
  key: string,
  fieldName: string,
  message: string,
): FieldMapping {
  return {
    key,
    destinationLabel: fieldName,
    meaning: message,
    fieldType: "radio",
    fieldNames: [fieldName],
    patterns: [new RegExp(`^${fieldName}$`, "i")],
    action: "manual_review",
    reason: message,
    confidence: "medium",
    plannedValue: "manual_review_required",
    reviewFlag: optionExportReviewFlag(`review_${key}_export_value`, message),
  };
}

function buildCompletionPlanField(
  mapping: FieldMapping,
  valueRefs: ValueRef[],
  fieldInventory: FieldInventory | undefined,
): CompletionPlanField {
  const matchedField = findInventoryField(fieldInventory, mapping);
  const destinationField = matchedField ?? fallbackDestinationField(mapping);
  const reviewFlags = buildMappingReviewFlags(
    mapping,
    destinationField,
    fieldInventory,
    matchedField,
  );

  return {
    planFieldId: `plan_field_${mapping.key}`,
    destinationFieldId: destinationField.fieldId,
    destinationField,
    action: mapping.action,
    plannedValue: plannedValueForMapping(mapping, valueRefs, destinationField),
    reason: mapping.reason,
    confidence: matchedField ? mapping.confidence : "low",
    sourceRefs: [DEMO_SOURCE_REF],
    reviewFlags,
    metadata: {
      devOnly: true,
      mappingKey: mapping.key,
      destinationFieldWasInInventory: Boolean(matchedField),
    },
  };
}

function plannedValueForMapping(
  mapping: FieldMapping,
  valueRefs: ValueRef[],
  destinationField: DestinationField,
): CompletionPlanField["plannedValue"] {
  if (mapping.plannedValue === "intentionally_blank") {
    return {
      valueKind: "intentionally_blank",
      reason: mapping.reason,
    };
  }

  if (mapping.plannedValue === "manual_review_required") {
    return {
      valueKind: "manual_review_required",
      reason: mapping.reason,
    };
  }

  if (mapping.plannedValue === "date_value") {
    return {
      valueKind: "date_value",
      valueRefId: requiredValueRef(mapping, valueRefs).valueRefId,
      maskedPreview: requiredValueRef(mapping, valueRefs).maskedPreview,
    };
  }

  if (mapping.plannedValue === "select_option") {
    return {
      valueKind: "select_option",
      valueRefId: mapping.valueRefId
        ? requiredValueRef(mapping, valueRefs).valueRefId
        : undefined,
      selectedOption: confirmedOptionForMapping(mapping, destinationField),
    };
  }

  if (mapping.plannedValue === "checkbox_true") {
    return {
      valueKind: "checkbox_state",
      checked: true,
      valueRefId: mapping.valueRefId,
    };
  }

  const valueRef = requiredValueRef(mapping, valueRefs);
  return {
    valueKind: "value_ref",
    valueRefId: valueRef.valueRefId,
    maskedPreview: valueRef.maskedPreview,
  };
}

function requiredValueRef(mapping: FieldMapping, valueRefs: ValueRef[]): ValueRef {
  const valueRef = valueRefs.find((candidate) => candidate.valueRefId === mapping.valueRefId);

  if (!valueRef) {
    throw new Error(`Missing demo value ref for ${mapping.key}.`);
  }

  return valueRef;
}

function findInventoryField(
  fieldInventory: FieldInventory | undefined,
  mapping: FieldMapping,
): DestinationField | undefined {
  if (!fieldInventory) {
    return undefined;
  }

  const exactNames = new Set(
    (mapping.fieldNames ?? []).map((name) => name.toLowerCase()),
  );
  const exactMatch = fieldInventory.fields.find((field) =>
    exactNames.has(field.name.toLowerCase()),
  );

  if (exactMatch) {
    return exactMatch;
  }

  return fieldInventory.fields.find((field) => {
    const text = `${field.name} ${field.label ?? ""} ${field.meaning ?? ""}`;
    return mapping.patterns.some((pattern) => pattern.test(text));
  });
}

function fallbackDestinationField(mapping: FieldMapping): DestinationField {
  return {
    fieldId: `demo_field_${mapping.key}`,
    name: mapping.destinationLabel,
    label: mapping.destinationLabel,
    meaning: mapping.meaning,
    fieldType: mapping.fieldType,
    requiredness: mapping.requiredness ?? "unknown",
    sourceDocumentRef: JON_SMITH_FIDELITY_TOA_TEMPLATE_REF,
    sourceRefs: [DEMO_SOURCE_REF],
    currentValueStatus: "unknown",
    confidence: "unknown",
    metadata: {
      devOnly: true,
      fallbackField: true,
    },
  };
}

function buildMappingReviewFlags(
  mapping: FieldMapping,
  destinationField: DestinationField,
  fieldInventory: FieldInventory | undefined,
  matchedField: DestinationField | undefined,
): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  if (!fieldInventory || !matchedField) {
    flags.push({
      reviewFlagId: `review_${mapping.key}_field_not_inspected`,
      flagType: "manual_confirmation",
      severity: "warning",
      message:
        fieldInventory
          ? "This destination field was not found in the inspected local PDF template."
          : "This destination field is a scaffold placeholder until the local PDF template is inspected.",
      fieldId: destinationField.fieldId,
      valueRefId: mapping.valueRefId,
      sourceRefs: [DEMO_SOURCE_REF],
      status: "open",
      createdAt: DEMO_CREATED_AT,
      metadata: { devOnly: true },
    });
  }

  if (mapping.reviewFlag) {
    flags.push({
      ...mapping.reviewFlag,
      fieldId: destinationField.fieldId,
      valueRefId: mapping.valueRefId,
    });
  }

  return flags;
}

function confirmedOption(
  mappingKey: keyof typeof JON_SMITH_FIDELITY_TOA_CONFIRMED_OPTION_MAPPINGS,
  optionId: string,
): DestinationFieldOption {
  const mapping = JON_SMITH_FIDELITY_TOA_CONFIRMED_OPTION_MAPPINGS[mappingKey];

  return {
    optionId,
    label: mapping.label,
    exportValue: mapping.exportValue,
    meaning: mapping.visibleSelection,
    metadata: {
      devOnly: true,
      confirmationSource: mapping.confirmedBy,
      confirmationConfidence: mapping.confidence,
    },
  };
}

function confirmedOptionForMapping(
  mapping: FieldMapping,
  destinationField: DestinationField,
): DestinationFieldOption {
  if (!mapping.confirmedOption) {
    throw new Error(`Missing confirmed demo option for ${mapping.key}.`);
  }

  const inventoryOption = destinationField.options?.find(
    (option) => option.exportValue === mapping.confirmedOption?.exportValue,
  );

  return {
    ...mapping.confirmedOption,
    optionId: inventoryOption?.optionId ?? mapping.confirmedOption.optionId,
    modelSafeValue:
      inventoryOption?.modelSafeValue ?? mapping.confirmedOption.modelSafeValue,
    metadata: {
      ...(inventoryOption?.metadata ?? {}),
      ...(mapping.confirmedOption.metadata ?? {}),
      exactPdfExportValueKnown: true,
    },
  };
}

function optionExportReviewFlag(reviewFlagId: string, message: string): ReviewFlag {
  return {
    reviewFlagId,
    flagType: "uncertain_mapping",
    severity: "warning",
    message,
    status: "open",
    createdAt: DEMO_CREATED_AT,
    metadata: { devOnly: true },
  };
}

function reviewFlagForMissingItem(item: MissingItem, createdAt: string): ReviewFlag {
  return {
    reviewFlagId: `review_${item.missingItemId}`,
    flagType: "missing_information",
    severity: item.severity,
    message: item.reason,
    missingItemId: item.missingItemId,
    sourceRefs: item.checkedSourceRefs,
    status: "open",
    createdAt,
    metadata: item.metadata,
  };
}

function buildTraceEvents(
  fieldInventory: FieldInventory | undefined,
  createdAt: string,
): ExecutionTraceEvent[] {
  const traceEvents: ExecutionTraceEvent[] = [
    {
      traceEventId: "trace_value_refs_created",
      runId: DEMO_RUN_ID,
      eventType: "value_ref_created",
      eventCategory: "value_ref",
      status: "success",
      message: "Created dev-only value refs; raw fake resolver values were not included.",
      sourceRefs: [DEMO_SOURCE_REF],
      metadata: {
        devOnly: true,
        rawValuesWereNotIncluded: true,
      },
      createdAt,
    },
    {
      traceEventId: "trace_completion_plan_created",
      runId: DEMO_RUN_ID,
      eventType: "completion_plan_created",
      eventCategory: "completion_plan",
      status: "success",
      message: "Created task-aware completion plan scaffold.",
      sourceRefs: [DEMO_SOURCE_REF],
      metadata: { devOnly: true },
      createdAt,
    },
  ];

  if (fieldInventory) {
    traceEvents.unshift({
      traceEventId: "trace_field_inventory_created",
      runId: DEMO_RUN_ID,
      eventType: "field_inventory_created",
      eventCategory: "field_inventory",
      status: "success",
      message: "Inspected local dev-only PDF template and captured model-safe fields.",
      documentId: JON_SMITH_FIDELITY_TOA_TEMPLATE_REF.documentId,
      sourceRefs: [DEMO_SOURCE_REF],
      metadata: {
        devOnly: true,
        fieldCount: fieldInventory.fields.length,
      },
      createdAt,
    });
  }

  return traceEvents;
}

function buildMaskedPreview(definition: DemoValueDefinition): MaskedValuePreview {
  return {
    display: maskedDisplay(definition),
    strategy: definition.maskStrategy,
    last4:
      definition.maskStrategy === "last4"
        ? lastFour(definition.rawValue)
        : undefined,
    valueWasNotShownToModel: true,
  };
}

function maskedDisplay(definition: DemoValueDefinition): string {
  switch (definition.maskStrategy) {
    case "none":
      return definition.rawValue;
    case "last4":
      return `***${lastFour(definition.rawValue)}`;
    case "date_status_only":
      return "Date on file";
    case "city_state_only":
      return "Boston, MA";
    case "masked":
    case "hidden":
    case "custom":
      return "Masked fake value";
  }
}

function lastFour(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-4);
}

function valueStatusForDefinition(definition: DemoValueDefinition): ValueRef["status"] {
  if (definition.sensitivity === "safe_to_model") {
    return "available_safe";
  }

  if (definition.sensitivity === "client_confidential_to_model") {
    return "available_safe";
  }

  return "available_masked";
}

function modelAccessForDefinition(
  definition: DemoValueDefinition,
): ValueRef["resolverPolicy"]["allowModelAccess"] {
  if (
    definition.sensitivity === "safe_to_model" ||
    definition.sensitivity === "client_confidential_to_model"
  ) {
    return "safe_value_allowed";
  }

  if (definition.sensitivity === "masked_only_to_model") {
    return "masked_preview_only";
  }

  return "never_model_bound";
}

function findDefinition(valueRefId: ValueRefId): DemoValueDefinition {
  const definition = DEMO_VALUES.find((candidate) => candidate.valueRefId === valueRefId);

  if (!definition) {
    throw new Error(`Unknown Jon Smith demo value ref: ${valueRefId}`);
  }

  return definition;
}
