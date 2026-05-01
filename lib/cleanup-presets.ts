import { getDocumentTypeIdFromLabel } from "@/lib/naming-rules";

export const CLEANUP_DOCUMENT_PRESETS = [
  {
    label: "Account statement",
    filenameToken: "Account_Statement",
    topLevelFolder: "Accounts",
  },
  {
    label: "Money movement form",
    filenameToken: "Money_Movement",
    topLevelFolder: "Money Movement",
  },
  {
    label: "Identity document",
    filenameToken: "Client_ID",
    topLevelFolder: "Client Info",
  },
  {
    label: "Tax document",
    filenameToken: "Tax_Document",
    topLevelFolder: "Tax",
  },
  {
    label: "Planning / advice document",
    filenameToken: "Planning_Document",
    topLevelFolder: "Planning",
  },
  {
    label: "Meeting notes",
    filenameToken: "Meeting_Notes",
    topLevelFolder: "Planning",
  },
  {
    label: "Legal / estate document",
    filenameToken: "Legal_Document",
    topLevelFolder: "Planning",
  },
  {
    label: "General PDF",
    filenameToken: "Document",
    topLevelFolder: "Review",
  },
  {
    label: "Needs inspection",
    filenameToken: "Review_Item",
    topLevelFolder: "Review",
  },
] as const;

export function getCleanupDocumentTypeOptions() {
  return CLEANUP_DOCUMENT_PRESETS.map((preset) => preset.label);
}

export function getCleanupFilenameTokenForDocumentType(label: string) {
  const exact = CLEANUP_DOCUMENT_PRESETS.find((preset) => preset.label === label);
  if (exact) {
    return exact.filenameToken;
  }

  if (getDocumentTypeIdFromLabel(label) === "tax_document") {
    return sanitizeCleanupFilenameToken(label || "Tax Document");
  }

  return "Document";
}

export function getCleanupTopLevelFolderForDocumentType(label: string) {
  const exact = CLEANUP_DOCUMENT_PRESETS.find((preset) => preset.label === label);
  if (exact) {
    return exact.topLevelFolder;
  }

  const documentTypeId = getDocumentTypeIdFromLabel(label);
  if (documentTypeId === "account_statement") {
    return "Accounts";
  }
  if (documentTypeId === "money_movement_form") {
    return "Money Movement";
  }
  if (documentTypeId === "identity_document") {
    return "Client Info";
  }
  if (documentTypeId === "tax_document") {
    return "Tax";
  }
  if (documentTypeId === "planning_document" || documentTypeId === "legal_document") {
    return "Planning";
  }

  return "Review";
}

export function buildCleanupFilename(input: {
  clientFolder: string | null;
  documentType: string;
  sourceName: string;
  fallbackFilename?: string | null;
}) {
  const extension = detectExtension(input.sourceName || input.fallbackFilename || "");
  const dateToken = extractDateToken(input.fallbackFilename ?? input.sourceName);
  const clientToken = input.clientFolder?.trim() || "Needs_Client_Match";
  const documentToken = getCleanupFilenameTokenForDocumentType(input.documentType);

  return `${clientToken}_${documentToken}_${dateToken}${extension}`;
}

function detectExtension(filename: string) {
  const match = filename.match(/(\.[A-Za-z0-9]+)$/);
  return match?.[1] ?? "";
}

function sanitizeCleanupFilenameToken(label: string) {
  const normalized = label
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9\s'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized ? normalized.replace(/\s+/g, "_") : "Document";
}

function extractDateToken(filename: string) {
  const match = filename.match(/\b\d{4}-\d{2}-\d{2}\b/);
  return match?.[0] ?? "Undated";
}
