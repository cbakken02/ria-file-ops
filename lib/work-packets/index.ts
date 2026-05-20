export type {
  CompletionPlan,
  CompletionPlanField,
  CompletionPlanFieldAction,
  CompletionPlanFieldValue,
  CompletionPlanId,
  CompletionPlanStatus,
  ConfidenceLevel,
  DestinationField,
  DestinationFieldId,
  DestinationFieldOption,
  DestinationFieldRequiredness,
  DestinationFieldType,
  DocumentFactRef,
  DocumentFactRefType,
  DraftOutputId,
  DraftOutputRef,
  DraftOutputStatus,
  DraftOutputType,
  EntityRef,
  EntityRefType,
  ExecutionErrorInfo,
  ExecutionRun,
  ExecutionRunId,
  ExecutionRunRef,
  ExecutionRunSource,
  ExecutionRunStatus,
  ExecutionRunType,
  ExecutionTraceEvent,
  ExecutionTraceEventCategory,
  ExecutionTraceEventId,
  ExecutionTraceEventType,
  FieldInventory,
  FieldInventoryExtractionMethod,
  FieldInventoryId,
  FieldInventorySourceKind,
  FieldPosition,
  MaskedValuePreview,
  MissingItem,
  MissingItemSeverity,
  MissingItemStatus,
  ModelSafeJsonValue,
  ModelSafeMetadata,
  ModelSafeScalar,
  OutputArtifactRef,
  PacketDocumentRef,
  PacketDocumentRole,
  ProviderFileRef,
  ReviewFlag,
  ReviewFlagType,
  SafeCanonicalSourceRef,
  SourceRef,
  SourceSystem,
  ValueRef,
  ValueRefId,
  ValueRefStatus,
  ValueRefTarget,
  ValueResolverKind,
  ValueResolverPolicy,
  WorkPacket,
  WorkPacketActorRef,
  WorkPacketId,
  WorkPacketKnownFact,
  WorkPacketSourceType,
  WorkPacketStatus,
  WorkPacketTaskContext,
  WorkPacketTaskTypeHint,
} from "@/lib/work-packets/types";

export {
  assertLocalDevGeneratedOutputPath,
  fillPdfFromCompletionPlan,
} from "@/lib/work-packets/pdf-fill-adapter";
export type {
  FillPdfFromCompletionPlanArgs,
  PdfFieldWriter,
  PdfFieldWriterInput,
  PdfFieldWriterResult,
  PdfFillAdapterResult,
  PdfFillResolvedValue,
  PdfFillTraceEntry,
  PdfFillTraceStatus,
  PdfFillValueResolver,
} from "@/lib/work-packets/pdf-fill-adapter";

export {
  PdfOptionMappingError,
  buildPdfOptionMappingProbePath,
  generatePdfOptionMappingProbes,
} from "@/lib/work-packets/pdf-option-mapping";
export type {
  GeneratePdfOptionMappingProbesArgs,
  PdfOptionMappingProbe,
  PdfOptionMappingProbeResult,
  PdfOptionProbeWriter,
  PdfOptionProbeWriterInput,
  PdfOptionProbeWriterResult,
} from "@/lib/work-packets/pdf-option-mapping";

export {
  inspectPdfFieldInventory,
  inspectPdfFieldInventoryFromFile,
} from "@/lib/work-packets/pdf-field-inventory";
export type { InspectPdfFieldInventoryOptions } from "@/lib/work-packets/pdf-field-inventory";

export {
  JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
  JON_SMITH_FIDELITY_TOA_TASK,
  JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
  JON_SMITH_FIDELITY_TOA_TEMPLATE_REF,
  buildJonSmithFidelityToaCompletionPlan,
  buildJonSmithFidelityToaDemo,
  buildJonSmithFidelityToaValueRefs,
  previewJonSmithFidelityToaResolverValues,
  resolveJonSmithFidelityToaFakeValue,
} from "@/lib/work-packets/dev-demo/jon-smith-fidelity-toa";
export type {
  JonSmithFidelityToaDemo,
  JonSmithFidelityToaResolvedValue,
  JonSmithFidelityToaResolverPreview,
} from "@/lib/work-packets/dev-demo/jon-smith-fidelity-toa";

export {
  JON_SMITH_FIDELITY_TOA_CONFIRMED_OPTION_MAPPINGS,
  JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
  JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_TARGETS,
  buildJonSmithFidelityToaOptionMappingProbes,
  exportValuesForTarget,
} from "@/lib/work-packets/dev-demo/fidelity-toa-option-mapping";
export type {
  JonSmithFidelityToaConfirmedOptionMapping,
  JonSmithFidelityToaOptionMappingTarget,
} from "@/lib/work-packets/dev-demo/fidelity-toa-option-mapping";

export {
  JON_SMITH_FIDELITY_TOA_OPTION_VISUAL_DEBUG_DIR,
  classifyJonSmithFidelityToaOptionVisuals,
} from "@/lib/work-packets/dev-demo/fidelity-toa-option-visuals";
export type {
  JonSmithFidelityToaOptionVisualReport,
  JonSmithFidelityToaOptionVisualTargetKey,
  PdfOptionVisualDiffCandidate,
  PdfOptionVisualTargetResult,
  PdfVisualDiffBounds,
  PdfVisualDiffPoint,
} from "@/lib/work-packets/dev-demo/fidelity-toa-option-visuals";

export {
  JON_SMITH_FIDELITY_TOA_EXPECTED_BLANK_FIELDS,
  JonSmithFidelityToaVerificationError,
  readPdfFieldValuesWithPypdf,
  verifyJonSmithFidelityToaFieldValues,
  verifyJonSmithFidelityToaOutputPdf,
} from "@/lib/work-packets/dev-demo/fidelity-toa-output-verification";
export type {
  JonSmithFidelityToaPdfFieldValues,
  JonSmithFidelityToaVerificationIssue,
  JonSmithFidelityToaVerificationSummary,
} from "@/lib/work-packets/dev-demo/fidelity-toa-output-verification";

export {
  JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
  JonSmithFidelityToaReviewArtifactError,
  assertJonSmithFidelityToaReviewArtifactIsSafe,
  assertLocalDevGeneratedJsonOutputPath,
  buildJonSmithFidelityToaReviewArtifact,
  writeJonSmithFidelityToaReviewArtifact,
} from "@/lib/work-packets/dev-demo/fidelity-toa-review-artifact";
export type {
  JonSmithFidelityToaReviewArtifact,
} from "@/lib/work-packets/dev-demo/fidelity-toa-review-artifact";

export {
  JonSmithFidelityToaReviewViewModelError,
  assertExecutionReviewViewModelIsSafe,
  buildExecutionReviewViewModelFromArtifact,
  loadJonSmithFidelityToaExecutionReviewViewModel,
} from "@/lib/work-packets/dev-demo/fidelity-toa-execution-review-view-model";
export type {
  ExecutionReviewPlanRowStatus,
  ExecutionReviewReference,
  ExecutionReviewViewModel,
  ExecutionReviewViewModelStatus,
} from "@/lib/work-packets/dev-demo/fidelity-toa-execution-review-view-model";
