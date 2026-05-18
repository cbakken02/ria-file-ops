import { auth } from "@/auth";
import { getApiPrincipalFromSession } from "@/lib/auth/principal";
import { listDriveFolders } from "@/lib/google-drive";
import { getVerifiedActiveStorageConnectionForSession } from "@/lib/storage-connections";

export async function GET() {
  const session = await auth();
  const principalResult = await getApiPrincipalFromSession(session);

  if (!principalResult.ok || !session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeConnection =
    await getVerifiedActiveStorageConnectionForSession(session);

  if (!activeConnection) {
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
