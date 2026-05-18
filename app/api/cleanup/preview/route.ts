import { auth } from "@/auth";
import { getApiPrincipalFromSession } from "@/lib/auth/principal";
import {
  getClientMemoryRulesByOwnerEmail,
  getFirmSettingsByOwnerEmail,
} from "@/lib/db";
import { buildCleanupPreview } from "@/lib/cleanup-preview";
import type { CleanupMode, CleanupScope } from "@/lib/cleanup-types";
import {
  formatGoogleDriveFolderAccessError,
  getGoogleDriveAccessErrorStatus,
} from "@/lib/google-drive";
import {
  markStorageConnectionNeedsReauth,
  resolveActiveStorageAuthorizationForSession,
} from "@/lib/storage-connections";

type PreviewRequestBody = {
  mode?: CleanupMode;
  scope?: CleanupScope;
  selectedIds?: string[];
};

export async function POST(request: Request) {
  const session = await auth();
  const principalResult = getApiPrincipalFromSession(session);
  if (!principalResult.ok) {
    return Response.json(
      { error: "Sign in before generating a cleanup preview." },
      { status: 401 },
    );
  }

  const storageAuthorization = await resolveActiveStorageAuthorizationForSession(
    session,
    {
      reconnectMessage:
        "Reconnect the active storage connection before generating a cleanup preview.",
      signInMessage: "Sign in before generating a cleanup preview.",
    },
  );

  if (!storageAuthorization.ok) {
    return Response.json(
      { error: storageAuthorization.error },
      { status: storageAuthorization.status },
    );
  }

  const { connection: activeConnection, ownerEmail } = storageAuthorization;
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
    const status = getGoogleDriveAccessErrorStatus(error);
    if (status === 401) {
      markStorageConnectionNeedsReauth(activeConnection);
    }

    return Response.json(
      {
        error:
          status === 401
            ? formatGoogleDriveFolderAccessError(error, "selected folder")
            : error instanceof Error
              ? error.message
              : "Clean Up preview could not be generated.",
      },
      { status },
    );
  }
}
