import { auth } from "@/auth";
import {
  getDriveFolderTrail,
  isGoogleDriveAccessFailure,
  listDriveBrowserItems,
} from "@/lib/google-drive";
import {
  getCleanupFileStatesByOwnerAndFileIds,
  getFilingEventsByOwnerEmail,
} from "@/lib/db";
import { resolveCleanupBrowserState } from "@/lib/cleanup-file-state";
import { getActiveStorageConnectionForSession } from "@/lib/storage-connections";

export async function GET(request: Request) {
  const session = await auth();
  const ownerEmail = session?.user?.email ?? null;
  const activeConnection = session
    ? await getActiveStorageConnectionForSession(session)
    : null;

  if (!ownerEmail || !activeConnection || activeConnection.status !== "connected") {
    return Response.json(
      { error: "Reconnect the active storage connection to browse files." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId")?.trim() || "root";
  const includeTrail = url.searchParams.get("includeTrail") !== "0";
  const folderName = url.searchParams.get("folderName")?.trim() || null;
  const folderPath = url.searchParams.get("folderPath")?.trim() || null;

  try {
    const itemsPromise = listDriveBrowserItems(activeConnection.accessToken, folderId);
    const trailPromise = includeTrail
      ? getDriveFolderTrail(activeConnection.accessToken, folderId)
      : Promise.resolve(null);
    const [items, trail] = await Promise.all([itemsPromise, trailPromise]);
    const currentLocation =
      folderPath ??
      formatCleanupCurrentLocation(trail) ??
      folderName ??
      trail?.at(-1)?.name ??
      (folderId === "root" ? "My Drive" : "Current folder");
    const fileItems = items.filter(
      (item) => item.mimeType !== "application/vnd.google-apps.folder",
    );
    const fileIds = fileItems.map((item) => item.id);
    const states = getCleanupFileStatesByOwnerAndFileIds(ownerEmail, fileIds);
    const statesByFileId = new Map(states.map((state) => [state.fileId, state]));
    const successfulFilingByFileId = new Map<
      string,
      {
        completedAt: string;
        destinationPath: string | null;
        eventId: string;
        fileId: string;
        finalFilename: string | null;
      }
    >();

    if (fileIds.length > 0) {
      const fileIdSet = new Set(fileIds);
      for (const event of getFilingEventsByOwnerEmail(ownerEmail)) {
        if (event.outcome !== "succeeded" || !fileIdSet.has(event.fileId)) {
          continue;
        }

        const existing = successfulFilingByFileId.get(event.fileId);
        if (existing && existing.completedAt >= event.createdAt) {
          continue;
        }

        successfulFilingByFileId.set(event.fileId, {
          completedAt: event.createdAt,
          destinationPath: event.destinationPath,
          eventId: event.id,
          fileId: event.fileId,
          finalFilename: event.finalFilename,
        });
      }
    }
    const enrichedItems = items.map((item) => {
      if (item.mimeType === "application/vnd.google-apps.folder") {
        return item;
      }

      return {
        ...item,
        cleanup: resolveCleanupBrowserState({
          currentLocation,
          file: item,
          latestSuccessfulFiling: successfulFilingByFileId.get(item.id) ?? null,
          state: statesByFileId.get(item.id),
        }),
      };
    });

    return Response.json({
      folderId,
      items: enrichedItems,
      ...(trail ? { trail } : {}),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The selected storage folder could not be loaded.",
      },
      { status: error instanceof Error && isGoogleDriveAccessFailure(error) ? 401 : 500 },
    );
  }
}

function formatCleanupCurrentLocation(
  trail: Array<{ id: string; name: string }> | null,
) {
  const names = (trail ?? [])
    .map((segment) => segment.name.trim())
    .filter(Boolean);

  if (names.length === 0) {
    return null;
  }

  const clientsIndex = names.findIndex((name) =>
    /^(\d+_)?clients$/i.test(name),
  );
  if (clientsIndex >= 0 && clientsIndex < names.length - 1) {
    return names.slice(clientsIndex + 1).join(" / ");
  }

  const visibleNames = names[0]?.toLowerCase() === "my drive"
    ? names.slice(1)
    : names;
  if (visibleNames.length >= 2) {
    return visibleNames.slice(-2).join(" / ");
  }

  return visibleNames[0] ?? names[0] ?? null;
}
