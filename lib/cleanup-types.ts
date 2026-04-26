export type CleanupScope =
  | "single_file"
  | "folder_of_files"
  | "client_folder"
  | "multiple_client_folders";

export type CleanupMode =
  | "rename_only"
  | "reorganize_only"
  | "rename_and_reorganize";

export type CleanupFileStatus =
  | "needs_analysis"
  | "suggestion_ready"
  | "needs_review"
  | "complete";

export type CleanupFileState = {
  id: string;
  ownerEmail: string;
  fileId: string;
  sourceName: string;
  mimeType: string;
  modifiedTime: string | null;
  driveSize: string | null;
  currentLocation: string | null;
  proposedFilename: string | null;
  proposedLocation: string | null;
  recognizedFileType: string | null;
  documentTypeId: string | null;
  confidenceLabel: "High" | "Medium" | "Low" | null;
  reasons: string[];
  status: CleanupFileStatus;
  analysisProfile: string | null;
  analysisVersion: string | null;
  parserVersion: string | null;
  analyzedAt: string | null;
  completedAt: string | null;
  appliedFilingEventId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CleanupFileStateUpsertInput = {
  ownerEmail: string;
  fileId: string;
  sourceName: string;
  mimeType: string;
  modifiedTime: string | null;
  driveSize: string | null;
  currentLocation: string | null;
  proposedFilename: string | null;
  proposedLocation: string | null;
  recognizedFileType: string | null;
  documentTypeId: string | null;
  confidenceLabel: "High" | "Medium" | "Low" | null;
  reasons: string[];
  status: CleanupFileStatus;
  analysisProfile: string | null;
  analysisVersion: string | null;
  parserVersion: string | null;
  analyzedAt?: string | null;
  completedAt?: string | null;
  appliedFilingEventId?: string | null;
};

export type CleanupBrowserFileState = {
  status: CleanupFileStatus;
  currentLocation: string | null;
  proposedFilename?: string | null;
  proposedLocation?: string | null;
  recognizedFileType?: string | null;
  documentTypeId?: string | null;
  confidenceLabel?: "High" | "Medium" | "Low" | null;
  reasons?: string[];
  analyzedAt?: string | null;
  completedAt?: string | null;
  appliedFilingEventId?: string | null;
};

export type CleanupBrowserItem = {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
  cleanup?: CleanupBrowserFileState;
};

export type CleanupPreviewFileRow = {
  id: string;
  mimeType: string;
  sourceName: string;
  modifiedTime?: string;
  driveSize?: string;
  downloadByteLength: number | null;
  downloadSha1: string | null;
  previewSnapshotId: string | null;
  parserConflictSummary: string | null;
  contentSource: "pdf_text" | "pdf_ocr" | "image_ocr" | "metadata_only";
  textExcerpt: string | null;
  diagnosticText: string | null;
  pdfFields: Array<{ name: string; value: string }>;
  debug: {
    parserVersion: string;
    parserConflictSummary: string | null;
    documentSignal: string | null;
    ownershipClientCandidate: string | null;
    accountContextCandidate: string | null;
    accountLooseCandidate: string | null;
    taxKeywordDetected: boolean;
    yearCandidates: string[];
  };
  reasons: string[];
  currentLocation: string;
  proposedLocation: string;
  proposedFilename: string;
  proposedHouseholdFolder: string | null;
  proposedClientName: string | null;
  proposedClientName2: string | null;
  ownershipType: "single" | "joint";
  proposedClientFolder: string | null;
  proposedDocumentType: string;
  proposedDocumentSubtype: string | null;
  detectedDocumentType: string;
  detectedDocumentSubtype: string | null;
  confidenceLabel: "High" | "Medium" | "Low";
  statusLabel: "Ready to clean" | "Needs review";
  reason: string;
  documentTypeId:
    | "default"
    | "account_statement"
    | "money_movement_form"
    | "tax_return"
    | "tax_document"
    | "identity_document"
    | "planning_document"
    | "legal_document";
  detectedClient: string | null;
  extractedAccountLast4: string | null;
  extractedAccountType: string | null;
  extractedCustodian: string | null;
  extractedDocumentDate: string | null;
  extractedEntityName: string | null;
  extractedIdType: string | null;
  extractedTaxYear: string | null;
  detectedClient2: string | null;
};

export type CleanupPreviewData = {
  title: string;
  summary: string;
  selectionLabel: string;
  scopeCount: string;
  renameCount: string;
  moveCount: string;
  readyCount: number;
  blockedCount: number;
  executionSupported: boolean;
  canRun: boolean;
  notes: string[];
  clientOptions: string[];
  documentTypeOptions: string[];
  fileRows: CleanupPreviewFileRow[];
};
