import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  getClientMemoryRulesByOwnerEmail,
  getFirmSettingsByOwnerEmail,
} from "@/lib/db";
import {
  applyCleanupOverrides,
  buildCleanupPlan,
  type CleanupOverride,
} from "@/lib/cleanup-preview";
import { executeFilingBatch } from "@/lib/filing";
import type { CleanupMode, CleanupScope } from "@/lib/cleanup-types";
import {
  getVerifiedActiveStorageConnectionForSession,
  storageConnectionHasWriteAccess,
} from "@/lib/storage-connections";

type RunRequestBody = {
  mode?: CleanupMode;
  overrides?: CleanupOverride[];
  scope?: CleanupScope;
  selectedIds?: string[];
};

export async function POST(request: Request) {
  const session = await auth();
  const activeConnection = session
    ? await getVerifiedActiveStorageConnectionForSession(session)
    : null;

  if (!session?.user?.email || !activeConnection) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!storageConnectionHasWriteAccess(activeConnection)) {
    return Response.json(
      {
        error: "Reconnect the active storage connection with write access before running Cleanup.",
      },
      { status: 400 },
    );
  }

  const ownerEmail = session.user.email;
  const settings = getFirmSettingsByOwnerEmail(ownerEmail) ?? null;

  if (!settings?.destinationFolderId) {
    return Response.json(
      {
        error: "Choose a destination root in Settings before running Cleanup.",
      },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as RunRequestBody | null;
  const scope = body?.scope;
  const mode = body?.mode;
  const overrides = Array.isArray(body?.overrides) ? body?.overrides : [];
  const selectedIds = Array.isArray(body?.selectedIds) ? body?.selectedIds : [];

  if (!scope || !mode || selectedIds.length === 0) {
    return Response.json(
      {
        error: "Choose a file or folder before running Cleanup.",
      },
      { status: 400 },
    );
  }

  if (scope !== "single_file" && scope !== "folder_of_files") {
    return Response.json(
      {
        error:
          "Cleanup execution is live for single files and folders of files first. Larger folder reorganization stays preview-only for now.",
      },
      { status: 400 },
    );
  }

  try {
    const plan = await buildCleanupPlan({
      accessToken: activeConnection.accessToken,
      clientMemoryRules: getClientMemoryRulesByOwnerEmail(ownerEmail),
      mode,
      scope,
      selectedIds,
      settings,
    });

    const filingCandidates = applyCleanupOverrides({
      filingCandidates: plan.filingCandidates,
      overrides,
    });

    if (!plan.preview.executionSupported || filingCandidates.length === 0) {
      return Response.json(
        {
          error:
            plan.preview.blockedCount > 0
              ? "Cleanup cannot run yet because some files still need review in the preview."
              : "Nothing in this selection is ready to clean yet.",
        },
        { status: 400 },
      );
    }

    const result = await executeFilingBatch({
      accessToken: activeConnection.accessToken,
      ownerEmail,
      actorEmail: ownerEmail,
      actorType: "user",
      settings,
      candidates: filingCandidates,
    });

    revalidatePath("/cleanup");
    revalidatePath("/history");
    revalidatePath("/dashboard");
    revalidatePath("/preview");

    return Response.json({
      failedCount: result.failedCount,
      message: `Cleanup finished. ${result.succeededCount} succeeded and ${result.failedCount} failed.`,
      succeededCount: result.succeededCount,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Cleanup could not be completed.",
      },
      { status: 500 },
    );
  }
}
