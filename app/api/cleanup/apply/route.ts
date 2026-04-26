import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  getCleanupFileStatesByOwnerAndFileIds,
  getFirmSettingsByOwnerEmail,
  markCleanupFileStateComplete,
} from "@/lib/db";
import { filingCandidateFromCleanupState } from "@/lib/cleanup-file-state";
import { executeFilingBatch, type FilingCandidate } from "@/lib/filing";
import {
  getVerifiedActiveStorageConnectionForSession,
  storageConnectionHasWriteAccess,
} from "@/lib/storage-connections";

type ApplyRequestBody = {
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
        error:
          "Reconnect the active storage connection with write access before applying Cleanup suggestions.",
      },
      { status: 400 },
    );
  }

  const ownerEmail = session.user.email;
  const settings = getFirmSettingsByOwnerEmail(ownerEmail) ?? null;
  if (!settings?.destinationFolderId) {
    return Response.json(
      { error: "Choose a destination root in Settings before applying suggestions." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as ApplyRequestBody | null;
  const selectedIds = Array.isArray(body?.selectedIds)
    ? Array.from(new Set(body.selectedIds.filter(Boolean)))
    : [];

  if (selectedIds.length === 0) {
    return Response.json(
      { error: "Choose suggested files before applying Cleanup." },
      { status: 400 },
    );
  }

  try {
    const states = getCleanupFileStatesByOwnerAndFileIds(ownerEmail, selectedIds);
    const candidates = states
      .map((state) => filingCandidateFromCleanupState(state))
      .filter((candidate): candidate is FilingCandidate => Boolean(candidate));

    if (candidates.length === 0) {
      return Response.json(
        { error: "No selected files have ready Cleanup suggestions to apply." },
        { status: 400 },
      );
    }

    const result = await executeFilingBatch({
      accessToken: activeConnection.accessToken,
      actorEmail: ownerEmail,
      actorType: "user",
      candidates,
      ownerEmail,
      settings,
    });

    for (const success of result.successfulFiles) {
      markCleanupFileStateComplete({
        appliedFilingEventId: success.eventId,
        completedAt: success.completedAt,
        fileId: success.fileId,
        ownerEmail,
      });
    }

    revalidatePath("/cleanup");
    revalidatePath("/history");
    revalidatePath("/dashboard");
    revalidatePath("/preview");

    return Response.json({
      failedCount: result.failedCount,
      message: `Apply finished. ${result.succeededCount} succeeded and ${result.failedCount} failed.`,
      succeededCount: result.succeededCount,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Cleanup suggestions could not be applied.",
      },
      { status: 500 },
    );
  }
}
