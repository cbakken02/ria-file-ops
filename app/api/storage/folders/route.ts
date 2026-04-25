import { auth } from "@/auth";
import { listDriveFolders } from "@/lib/google-drive";
import { getVerifiedActiveStorageConnectionForSession } from "@/lib/storage-connections";

export async function GET() {
  const session = await auth();
  const activeConnection = session
    ? await getVerifiedActiveStorageConnectionForSession(session)
    : null;

  if (!session?.user?.email || !activeConnection) {
    return Response.json(
      { error: "Reconnect storage before loading Drive folders." },
      { status: 401 },
    );
  }

  try {
    const folders = await listDriveFolders(activeConnection.accessToken);

    return Response.json({
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        mimeType: folder.mimeType,
        modifiedTime: folder.modifiedTime ?? null,
        parents: folder.parents ?? [],
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Drive folders could not be loaded.",
      },
      { status: 500 },
    );
  }
}
