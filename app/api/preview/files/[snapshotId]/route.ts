import { auth } from "@/auth";
import { readPreviewFileSnapshot } from "@/lib/preview-file-snapshots";

function safeFilename(value: string) {
  return value.replace(/["\r\n]/g, "_");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const session = await auth();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { snapshotId } = await context.params;
  const snapshot = await readPreviewFileSnapshot(snapshotId);

  if (!snapshot) {
    return new Response("Preview snapshot not found.", { status: 404 });
  }

  return new Response(snapshot.buffer, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${safeFilename(snapshot.meta.sourceName)}"`,
      "Content-Length": String(snapshot.buffer.byteLength),
      "Content-Type": snapshot.meta.mimeType || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
