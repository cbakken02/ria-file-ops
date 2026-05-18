import { applyCleanupSuggestionsForIds } from "@/lib/cleanup-approval";
import { requireApiPrincipal } from "@/lib/auth/principal";

type ApplyRequestBody = {
  selectedIds?: unknown;
};

export async function POST(request: Request) {
  const principalResult = await requireApiPrincipal();
  if (!principalResult.ok) {
    return principalResult.response;
  }

  const body = (await request.json().catch(() => null)) as ApplyRequestBody | null;
  const selectedIds = Array.isArray(body?.selectedIds)
    ? Array.from(
        new Set(
          body.selectedIds
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean),
        ),
      )
    : [];

  if (selectedIds.length === 0) {
    return Response.json(
      { error: "Choose suggested files before applying Clean Up." },
      { status: 400 },
    );
  }

  try {
    const result = await applyCleanupSuggestionsForIds({ fileIds: selectedIds });
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
            : "Clean Up suggestions could not be applied.",
      },
      { status: 500 },
    );
  }
}
