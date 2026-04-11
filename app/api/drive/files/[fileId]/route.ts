import { auth } from "@/auth";
import { downloadDriveFile, getDriveFileMetadata } from "@/lib/google-drive";
import { getVerifiedActiveStorageConnectionForSession } from "@/lib/storage-connections";

function safeFilename(value: string) {
  return value.replace(/["\r\n]/g, "_");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const session = await auth();
  const activeConnection = session
    ? await getVerifiedActiveStorageConnectionForSession(session)
    : null;

  if (!session?.user || !activeConnection) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { fileId } = await context.params;

  try {
    const [metadata, buffer] = await Promise.all([
      getDriveFileMetadata(activeConnection.accessToken, fileId),
      downloadDriveFile(activeConnection.accessToken, fileId),
    ]);

    return new Response(buffer, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${safeFilename(metadata.name)}"`,
        "Content-Length": String(buffer.byteLength),
        "Content-Type": metadata.mimeType || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Unable to load that file preview.", { status: 404 });
  }
}
