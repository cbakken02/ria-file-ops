import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  getCleanupFileStatesByOwnerAndFileIds,
  getClientMemoryRulesByOwnerEmail,
  getFirmSettingsByOwnerEmail,
  upsertCleanupFileStateForOwner,
} from "@/lib/db";
import {
  cleanupStateInputFromPreviewRow,
  isCleanupStateFreshForFile,
} from "@/lib/cleanup-file-state";
import { buildCleanupPlan } from "@/lib/cleanup-preview";
import { getDriveFileMetadata } from "@/lib/google-drive";
import type { CleanupMode } from "@/lib/cleanup-types";
import { getVerifiedActiveStorageConnectionForSession } from "@/lib/storage-connections";

type AnalyzeRequestBody = {
  mode?: CleanupMode;
  selectedIds?: string[];
  targetKind?: "files" | "folders";
};

export async function POST(request: Request) {
  const session = await auth();
  const activeConnection = session
    ? await getVerifiedActiveStorageConnectionForSession(session)
    : null;

  if (!session?.user?.email || !activeConnection) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerEmail = session.user.email;
  const body = (await request.json().catch(() => null)) as AnalyzeRequestBody | null;
  const selectedIds = Array.isArray(body?.selectedIds)
    ? Array.from(new Set(body.selectedIds.filter(Boolean)))
    : [];
  const targetKind = body?.targetKind;
  const mode = body?.mode ?? "rename_and_reorganize";

  if (!targetKind || selectedIds.length === 0) {
    return Response.json(
      { error: "Choose files or folders before analyzing Cleanup suggestions." },
      { status: 400 },
    );
  }

  try {
    const settings = getFirmSettingsByOwnerEmail(ownerEmail) ?? null;
    const clientMemoryRules = getClientMemoryRulesByOwnerEmail(ownerEmail);
    let analyzedCount = 0;
    let skippedCount = 0;

    for (const selectedId of selectedIds) {
      if (targetKind === "files") {
        const metadata = await getDriveFileMetadata(
          activeConnection.accessToken,
          selectedId,
        );
        const existingState = getCleanupFileStatesByOwnerAndFileIds(ownerEmail, [
          selectedId,
        ])[0];

        if (
          existingState &&
          existingState.status !== "needs_analysis" &&
          isCleanupStateFreshForFile(existingState, metadata)
        ) {
          skippedCount += 1;
          continue;
        }
      }

      const plan = await buildCleanupPlan({
        accessToken: activeConnection.accessToken,
        clientMemoryRules,
        mode,
        scope: targetKind === "folders" ? "client_folder" : "single_file",
        selectedIds: [selectedId],
        settings,
      });

      for (const row of plan.preview.fileRows) {
        upsertCleanupFileStateForOwner(
          cleanupStateInputFromPreviewRow({
            ownerEmail,
            row,
          }),
        );
        analyzedCount += 1;
      }
    }

    revalidatePath("/cleanup");

    return Response.json({
      analyzedCount,
      message:
        skippedCount > 0
          ? `Analysis finished. ${analyzedCount} analyzed and ${skippedCount} unchanged skipped.`
          : `Analysis finished. ${analyzedCount} file${analyzedCount === 1 ? "" : "s"} analyzed.`,
      skippedCount,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Cleanup analysis could not be completed.",
      },
      { status: 500 },
    );
  }
}
