import { auth } from "@/auth";
import { getDriveFolderTrail, listDriveBrowserItems } from "@/lib/google-drive";
import { getVerifiedActiveStorageConnectionForSession } from "@/lib/storage-connections";

export async function GET(request: Request) {
  const session = await auth();
  const activeConnection = session
    ? await getVerifiedActiveStorageConnectionForSession(session)
    : null;

  if (!session?.user || !activeConnection) {
    return Response.json(
      { error: "Reconnect the active storage connection to browse files." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId")?.trim() || "root";

  try {
    const [items, trail] = await Promise.all([
      listDriveBrowserItems(activeConnection.accessToken, folderId),
      getDriveFolderTrail(activeConnection.accessToken, folderId),
    ]);

    return Response.json({
      folderId,
      items,
      trail,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The selected storage folder could not be loaded.",
      },
      { status: 500 },
    );
  }
}
