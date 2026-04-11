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
    label: "Tax return",
    filenameToken: "Tax_Return",
    topLevelFolder: "Planning",
  },
  {
    label: "Tax document",
    filenameToken: "Tax_Document",
    topLevelFolder: "Planning",
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
  return (
    CLEANUP_DOCUMENT_PRESETS.find((preset) => preset.label === label)?.filenameToken ??
    "Document"
  );
}

export function getCleanupTopLevelFolderForDocumentType(label: string) {
  return (
    CLEANUP_DOCUMENT_PRESETS.find((preset) => preset.label === label)?.topLevelFolder ??
    "Review"
  );
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

function extractDateToken(filename: string) {
  const match = filename.match(/\b\d{4}-\d{2}-\d{2}\b/);
  return match?.[0] ?? "Undated";
}
