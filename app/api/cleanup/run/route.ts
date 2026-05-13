import type { CleanupOverride } from "@/lib/cleanup-preview";
import { runCleanupPlanForIds } from "@/lib/cleanup-approval";
import type { CleanupMode, CleanupScope } from "@/lib/cleanup-types";

type RunRequestBody = {
  mode?: CleanupMode;
  overrides?: CleanupOverride[];
  scope?: CleanupScope;
  selectedIds?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as RunRequestBody | null;
  const scope = body?.scope;
  const mode = body?.mode;
  const overrides = Array.isArray(body?.overrides) ? body.overrides : [];
  const selectedIds = Array.isArray(body?.selectedIds)
    ? Array.from(
        new Set(
          body.selectedIds
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean),
        ),
      )
    : [];

  if (!scope || !mode || selectedIds.length === 0) {
    return Response.json(
      {
        error: "Choose a file or folder before running Clean Up.",
      },
      { status: 400 },
    );
  }

  if (scope !== "single_file" && scope !== "folder_of_files") {
    return Response.json(
      {
        error:
          "Clean Up execution is live for single files and folders of files first. Larger folder reorganization stays preview-only for now.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runCleanupPlanForIds({
      mode,
      overrides,
      scope,
      selectedIds,
    });

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
            : "Clean Up could not be completed.",
      },
      { status: 500 },
    );
  }
}
