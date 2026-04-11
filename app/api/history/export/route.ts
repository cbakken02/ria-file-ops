import { auth } from "@/auth";
import { getFilingEventsByOwnerEmail } from "@/lib/db";
import {
  buildDestinationPath,
  classifierSourceLabel,
  displayHistoryActor,
  filterHistoryEvents,
  getHistoryActionLabel,
  normalizeHistoryMoverFilter,
  normalizeHistorySortOption,
  normalizeHistoryStatusFilter,
  sortHistoryEvents,
} from "@/lib/history-view";
import {
  getStorageConnectionsForSession,
  getVerifiedActiveStorageConnectionForSession,
} from "@/lib/storage-connections";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.email) {
    return new Response("Unauthorized", { status: 401 });
  }

  const activeConnection = await getVerifiedActiveStorageConnectionForSession(session);
  const storageConnections = await getStorageConnectionsForSession(session);
  const displayConnection =
    storageConnections.find((connection) => connection.isPrimary) ?? null;
  const activeStorageProvider =
    displayConnection?.provider ?? activeConnection?.provider ?? null;

  if (!activeConnection || !activeStorageProvider) {
    return new Response(
      "Reconnect the active storage connection to export filing history.",
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const status = normalizeHistoryStatusFilter(url.searchParams.get("status"));
  const mover = normalizeHistoryMoverFilter(url.searchParams.get("mover"));
  const sort = normalizeHistorySortOption(url.searchParams.get("sort"));
  const events = getFilingEventsByOwnerEmail(session.user.email).filter(
    (event) => event.storageProvider === activeStorageProvider,
  );
  const filteredEvents = sortHistoryEvents(
    filterHistoryEvents(events, { mover, query, status }),
    sort,
  );

  const csv = [
    [
      "created_at",
      "action",
      "outcome",
      "moved_by",
      "triggered_by",
      "source_name",
      "final_filename",
      "client_folder",
      "top_level_folder",
      "destination_root",
      "destination_path",
      "storage_provider",
      "source_mime_type",
      "source_modified_time",
      "source_drive_size",
      "download_byte_length",
      "download_sha1",
      "parser_version",
      "parser_conflict_summary",
      "document_type",
      "detected_client",
      "classifier_confidence",
      "evidence_source",
      "batch_id",
      "file_id",
      "review_decision_id",
      "error_message",
    ],
    ...filteredEvents.map((event) => [
      event.createdAt,
      getHistoryActionLabel(event),
      event.outcome,
      displayHistoryActor(event),
      event.initiatedByEmail ?? "",
      event.sourceName,
      event.finalFilename ?? "",
      event.clientFolderName ?? "",
      event.topLevelFolderName ?? "",
      event.destinationRootName ?? "",
      buildDestinationPath(event),
      event.storageProvider,
      event.sourceMimeType,
      event.sourceModifiedTime ?? "",
      event.sourceDriveSize ?? "",
      event.downloadByteLength !== null && event.downloadByteLength !== undefined
        ? String(event.downloadByteLength)
        : "",
      event.downloadSha1 ?? "",
      event.parserVersion ?? "",
      event.parserConflictSummary ?? "",
      event.detectedDocumentType ?? "",
      event.detectedClient ?? "",
      event.classifierConfidence !== null && event.classifierConfidence !== undefined
        ? String(event.classifierConfidence)
        : "",
      classifierSourceLabel(event.classifierContentSource),
      event.batchId,
      event.fileId,
      event.reviewDecisionId ?? "",
      event.errorMessage ?? "",
    ]),
  ]
    .map((row) => row.map((value) => toCsvCell(value ?? "")).join(","))
    .join("\n");

  const filename =
    query || status !== "all" || mover !== "all" || sort !== "newest"
      ? `ria-file-history-${slugify(
          [query, status !== "all" ? status : "", mover !== "all" ? mover : "", sort !== "newest" ? sort : ""]
            .filter(Boolean)
            .join("-"),
        )}.csv`
      : "ria-file-history.csv";

  return new Response(csv, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}

function toCsvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
