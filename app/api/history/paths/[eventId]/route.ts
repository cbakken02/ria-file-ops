import { auth } from "@/auth";
import { getFilingEventByOwnerAndId, type FilingEvent } from "@/lib/db";
import { buildDriveItemPath, normalizeDriveDisplayPath } from "@/lib/google-drive";
import { getVerifiedActiveStorageConnectionForSession } from "@/lib/storage-connections";

export async function GET(
  _request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const session = await auth();

  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { eventId } = await context.params;
  const event = getFilingEventByOwnerAndId(session.user.email, eventId);

  if (!event) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const activeConnection = await getVerifiedActiveStorageConnectionForSession(session);

  const originalPath =
    normalizeDriveDisplayPath(event.originalPath) ||
    (activeConnection
      ? await resolveOriginalPath(activeConnection.accessToken, event).catch(
          () => fallbackOriginalPath(event),
        )
      : fallbackOriginalPath(event));

  const destinationPath =
    normalizeDriveDisplayPath(event.destinationPath) ||
    (activeConnection
      ? await resolveDestinationPath(activeConnection.accessToken, event).catch(
          () => fallbackDestinationPath(event),
        )
      : fallbackDestinationPath(event));

  return Response.json({
    destinationPath,
    originalPath,
  });
}

async function resolveOriginalPath(accessToken: string, event: FilingEvent) {
  const parentIds = safeParseParentIds(event.sourceParentIds);
  const parentFolderId = parentIds[0] ?? "root";

  return buildDriveItemPath({
    accessToken,
    parentFolderId,
    itemName: event.originalFilename ?? event.sourceName,
  });
}

async function resolveDestinationPath(accessToken: string, event: FilingEvent) {
  if (event.finalParentId) {
    return buildDriveItemPath({
      accessToken,
      parentFolderId: event.finalParentId,
      itemName: event.finalFilename ?? event.sourceName,
    });
  }

  return fallbackDestinationPath(event);
}

function fallbackOriginalPath(event: FilingEvent) {
  const path =
    [event.originalTopLevelFolder, event.originalFilename ?? event.sourceName]
      .filter(Boolean)
      .join(" / ") || "Not available";
  return normalizeDriveDisplayPath(path);
}

function fallbackDestinationPath(event: FilingEvent) {
  const path =
    [
      "My Drive",
      event.destinationRootName,
      event.clientFolderName,
      event.topLevelFolderName,
      event.finalFilename ?? event.sourceName,
    ]
      .filter(Boolean)
      .join(" / ") || "Not available";
  return normalizeDriveDisplayPath(path);
}

function safeParseParentIds(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as string[];
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}
