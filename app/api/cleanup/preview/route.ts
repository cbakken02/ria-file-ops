import { auth } from "@/auth";
import {
  getClientMemoryRulesByOwnerEmail,
  getFirmSettingsByOwnerEmail,
} from "@/lib/db";
import { buildCleanupPreview } from "@/lib/cleanup-preview";
import type { CleanupMode, CleanupScope } from "@/lib/cleanup-types";
import { getVerifiedActiveStorageConnectionForSession } from "@/lib/storage-connections";

type PreviewRequestBody = {
  mode?: CleanupMode;
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

  const ownerEmail = session.user.email;
  const body = (await request.json().catch(() => null)) as PreviewRequestBody | null;
  const scope = body?.scope;
  const mode = body?.mode;
  const selectedIds = Array.isArray(body?.selectedIds) ? body?.selectedIds : [];

  if (!scope || !mode || selectedIds.length === 0) {
    return Response.json(
      {
        error: "Choose a file or folder before generating a cleanup preview.",
      },
      { status: 400 },
    );
  }

  try {
    const [settings, clientMemoryRules] = await Promise.all([
      getFirmSettingsByOwnerEmail(ownerEmail) ?? null,
      getClientMemoryRulesByOwnerEmail(ownerEmail),
    ]);

    const preview = await buildCleanupPreview({
      accessToken: activeConnection.accessToken,
      clientMemoryRules,
      mode,
      scope,
      selectedIds,
      settings,
    });

    return Response.json(preview);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Cleanup preview could not be generated.",
      },
      { status: 500 },
    );
  }
}
