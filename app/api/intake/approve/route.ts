import { approvePreviewItemsForIds, normalizePreviewTab } from "@/lib/intake-approval";

type ApproveRequestBody = {
  fileIds?: unknown;
  tab?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ApproveRequestBody | null;
  const tab =
    typeof body?.tab === "string" ? normalizePreviewTab(body.tab) : "all";
  const fileIds = Array.isArray(body?.fileIds)
    ? Array.from(
        new Set(
          body.fileIds
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean),
        ),
      )
    : [];

  if (fileIds.length === 0) {
    return Response.json(
      { error: "Choose one or more intake items before approving." },
      { status: 400 },
    );
  }

  try {
    const result = await approvePreviewItemsForIds({ fileIds, tab });
    return Response.json(
      {
        ...result,
        ...(result.statusCode >= 400 ? { error: result.notice } : {}),
        message: result.notice,
      },
      { status: result.statusCode },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The selected intake files could not be approved.",
      },
      { status: 500 },
    );
  }
}
