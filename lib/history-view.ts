import type { FilingEvent } from "@/lib/db";

export type HistoryStatusFilter =
  | "all"
  | "approved"
  | "changed"
  | "renamed"
  | "moved"
  | "failed";
export type HistoryMoverFilter = "all" | "system" | "human";
export type HistorySortOption =
  | "newest"
  | "oldest"
  | "filename_az"
  | "client_az";

export function normalizeHistoryStatusFilter(
  value: string | null | undefined,
): HistoryStatusFilter {
  if (
    value === "approved" ||
    value === "changed" ||
    value === "renamed" ||
    value === "moved" ||
    value === "failed"
  ) {
    return value;
  }

  return "all";
}

export function normalizeHistoryMoverFilter(
  value: string | null | undefined,
): HistoryMoverFilter {
  if (value === "system" || value === "human") {
    return value;
  }

  return "all";
}

export function normalizeHistorySortOption(
  value: string | null | undefined,
): HistorySortOption {
  if (
    value === "oldest" ||
    value === "filename_az" ||
    value === "client_az"
  ) {
    return value;
  }

  return "newest";
}

export function filterHistoryEvents(
  events: FilingEvent[],
  options: {
    query?: string;
    status?: HistoryStatusFilter;
    mover?: HistoryMoverFilter;
  },
) {
  const normalizedQuery = options.query?.trim().toLowerCase() ?? "";
  const status = options.status ?? "all";
  const mover = options.mover ?? "all";

  return events.filter((event) => {
    const actionKind = getHistoryActionKind(event);

    if (status === "approved" && actionKind !== "review_approved") {
      return false;
    }

    if (
      status === "changed" &&
      actionKind !== "file_changed" &&
      actionKind !== "file_deleted" &&
      actionKind !== "file_filed"
    ) {
      return false;
    }

    if (status === "renamed" && !hasHistoryRename(event)) {
      return false;
    }

    if (status === "moved" && !hasHistoryMove(event)) {
      return false;
    }

    if (status === "failed" && actionKind !== "action_failed") {
      return false;
    }

    if (mover === "system" && event.actorType !== "automation") {
      return false;
    }

    if (mover === "human" && event.actorType === "automation") {
      return false;
    }

    if (normalizedQuery && !matchesHistorySearch(event, normalizedQuery)) {
      return false;
    }

    return true;
  });
}

export function sortHistoryEvents(events: FilingEvent[], sort: HistorySortOption) {
  return [...events].sort((left, right) => {
    if (sort === "oldest") {
      return left.createdAt.localeCompare(right.createdAt);
    }

    if (sort === "filename_az") {
      return getHistoryDisplayFilename(left).localeCompare(
        getHistoryDisplayFilename(right),
      );
    }

    if (sort === "client_az") {
      return (left.clientFolderName ?? "").localeCompare(
        right.clientFolderName ?? "",
      );
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function matchesHistorySearch(event: FilingEvent, normalizedQuery: string) {
  const haystack = [
    getHistoryActionLabel(event),
    event.sourceName,
    event.finalFilename,
    event.sourceMimeType,
    event.clientFolderName,
    event.topLevelFolderName,
    event.destinationRootName,
    event.storageProvider,
    event.sourceModifiedTime,
    event.sourceDriveSize,
    event.downloadByteLength !== null && event.downloadByteLength !== undefined
      ? String(event.downloadByteLength)
      : null,
    event.downloadSha1,
    event.parserVersion,
    event.parserConflictSummary,
    event.detectedClient,
    event.detectedClient2,
    event.detectedDocumentType,
    event.detectedOwnershipType,
    event.detectedAccountLast4,
    event.detectedAccountType,
    event.detectedCustodian,
    event.detectedTaxYear,
    event.detectedDocumentDate,
    event.detectedIdType,
    event.detectedEntityName,
    event.actorEmail,
    event.initiatedByEmail,
    event.batchId,
    event.fileId,
    event.errorMessage,
    buildDestinationPath(event),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

export function getHistoryDisplayFilename(event: FilingEvent) {
  return event.finalFilename ?? event.sourceName;
}

export type HistoryActionKind =
  | "review_approved"
  | "file_changed"
  | "file_filed"
  | "file_deleted"
  | "action_failed";

export function getHistoryActionKind(event: FilingEvent): HistoryActionKind {
  if (event.eventType === "review_approved") {
    return "review_approved";
  }

  if (event.eventType === "file_deleted") {
    return "file_deleted";
  }

  if (event.outcome === "failed" || event.eventType === "action_failed") {
    return "action_failed";
  }

  const renamed = hasHistoryRename(event);
  const moved = hasHistoryMove(event);

  if (renamed || moved) {
    return "file_changed";
  }

  return "file_filed";
}

export function getHistoryActionLabel(event: FilingEvent) {
  const badges = getHistoryActionBadges(event);
  const actionKind = getHistoryActionKind(event);

  if (actionKind === "review_approved") {
    return "Review approved";
  }

  if (actionKind === "file_deleted") {
    return "File deleted";
  }

  if (actionKind === "action_failed") {
    return "Action failed";
  }

  if (badges.length === 1) {
    return `File ${badges[0].toLowerCase()}`;
  }

  if (badges.length === 2) {
    return `File ${badges[0].toLowerCase()} and ${badges[1].toLowerCase()}`;
  }

  return "File changed";
}

export function getHistoryActionSummary(event: FilingEvent) {
  const actionKind = getHistoryActionKind(event);

  if (actionKind === "review_approved") {
    return event.finalFilename ?? event.sourceName;
  }

  if (actionKind === "file_deleted") {
    return event.sourceName;
  }

  if (actionKind === "action_failed") {
    return event.finalFilename ?? event.sourceName;
  }

  const renamed = hasHistoryRename(event);
  const moved = hasHistoryMove(event);

  if (renamed && moved) {
    return `${event.sourceName} -> ${getHistoryDisplayFilename(event)}`;
  }

  if (renamed) {
    return `${event.sourceName} -> ${getHistoryDisplayFilename(event)}`;
  }

  if (moved) {
    return buildDestinationPath(event) || getHistoryDisplayFilename(event);
  }

  return getHistoryDisplayFilename(event);
}

export function buildDestinationPath(event: FilingEvent) {
  return [
    event.destinationRootName,
    event.clientFolderName,
    event.topLevelFolderName,
    event.finalFilename,
  ]
    .filter(Boolean)
    .join(" / ");
}

export function displayHistoryActor(event: FilingEvent) {
  return event.actorType === "automation" ? "System" : event.actorEmail;
}

export function getHistoryActionBadges(event: FilingEvent) {
  const actionKind = getHistoryActionKind(event);

  if (actionKind === "review_approved") {
    return ["Approved"];
  }

  if (actionKind === "file_deleted") {
    return ["Deleted"];
  }

  if (actionKind === "action_failed") {
    return ["Failed"];
  }

  const badges: string[] = [];

  if (hasHistoryRename(event)) {
    badges.push("Renamed");
  }

  if (hasHistoryMove(event)) {
    badges.push("Moved");
  }

  return badges.length ? badges : ["Changed"];
}

export function hasHistoryRename(event: FilingEvent) {
  if (event.eventType === "review_approved" || event.eventType === "file_deleted") {
    return false;
  }

  const originalName = event.sourceName;
  const finalName = event.finalFilename ?? event.sourceName;
  return Boolean(originalName && finalName && originalName !== finalName);
}

export function hasHistoryMove(event: FilingEvent) {
  if (event.eventType === "review_approved" || event.eventType === "file_deleted") {
    return false;
  }

  const originalLocation =
    trimFilenameFromPath(event.originalPath) ||
    [event.originalClientFolder, event.originalTopLevelFolder]
      .filter(Boolean)
      .join(" / ");
  const finalLocation =
    trimFilenameFromPath(event.destinationPath) ||
    [event.finalClientFolder, event.finalTopLevelFolder]
      .filter(Boolean)
      .join(" / ");

  return Boolean(originalLocation && finalLocation && originalLocation !== finalLocation);
}

function trimFilenameFromPath(value: string | null) {
  if (!value) {
    return null;
  }

  const parts = value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return null;
  }

  parts.pop();
  return parts.join(" / ");
}

export function classifierSourceLabel(value: string | null) {
  if (value === "pdf_text") {
    return "PDF text";
  }

  if (value === "pdf_ocr") {
    return "OCR on scanned PDF";
  }

  if (value === "image_ocr") {
    return "OCR on image";
  }

  if (value === "metadata_only") {
    return "Metadata only";
  }

  return null;
}

export function parseClassifierReasons(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((reason): reason is string => typeof reason === "string")
      : [];
  } catch {
    return [];
  }
}
