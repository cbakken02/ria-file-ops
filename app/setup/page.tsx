import { getFirmSettingsByOwnerEmail } from "@/lib/db";
import { getDriveConnectionContext, listDriveFolders } from "@/lib/google-drive";
import { ProductShell } from "@/components/product-shell";
import {
  DEFAULT_NAMING_CONVENTION,
  getReviewRuleOption,
  normalizeFolderTemplate,
} from "@/lib/setup-config";
import { parseNamingRules } from "@/lib/naming-rules";
import { requireSession } from "@/lib/session";
import {
  getActiveStorageConnectionForSession,
  getStorageConnectionsForSession,
  getVerifiedActiveStorageConnectionForSession,
  storageConnectionHasWriteAccess,
} from "@/lib/storage-connections";
import { SetupForm } from "./setup-form";
import styles from "./page.module.css";

const validSections = new Set([
  "general",
  "storage",
  "naming",
  "intake",
  "cleanup",
  "security",
]);

export default async function SetupPage({
  searchParams,
}: {
  searchParams?: Promise<{ dialog?: string; notice?: string; section?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialSection = validSections.has(resolvedSearchParams?.section ?? "")
    ? (resolvedSearchParams?.section as
        | "general"
        | "storage"
        | "naming"
        | "intake"
        | "cleanup"
        | "security")
    : "general";
  const notice = resolvedSearchParams?.notice?.trim() || null;
  const initialDialog =
    resolvedSearchParams?.dialog === "data-handling"
      ? ("data-handling" as const)
      : null;
  const session = await requireSession();
  const ownerEmail = session.user?.email;
  const verifiedActiveConnection =
    await getVerifiedActiveStorageConnectionForSession(session);
  const [activeConnection, storageConnections] = await Promise.all([
    getActiveStorageConnectionForSession(session),
    getStorageConnectionsForSession(session),
  ]);
  const driveConnected = Boolean(verifiedActiveConnection);

  const [settings, driveFolders] = await Promise.all([
    ownerEmail
      ? Promise.resolve(getFirmSettingsByOwnerEmail(ownerEmail) ?? null)
      : Promise.resolve(null),
    verifiedActiveConnection
      ? listDriveFolders(verifiedActiveConnection.accessToken).catch(() => [])
      : Promise.resolve([]),
  ]);
  const driveContext = verifiedActiveConnection
    ? await getDriveConnectionContext({
        accessToken: verifiedActiveConnection.accessToken,
        destinationFolderId: settings?.destinationFolderId ?? null,
        sourceFolderId: settings?.sourceFolderId ?? null,
        fallbackDisplayName:
          verifiedActiveConnection.accountName ?? session.user?.name ?? null,
      }).catch(() => null)
    : null;

  const sourceFolderValue =
    settings?.sourceFolderId && settings?.sourceFolderName
      ? `${settings.sourceFolderId}::${settings.sourceFolderName}`
      : "";
  const destinationFolderValue =
    settings?.destinationFolderId && settings?.destinationFolderName
      ? `${settings.destinationFolderId}::${settings.destinationFolderName}`
      : "";
  const namingRules = parseNamingRules(
    settings?.namingRulesJson,
    settings?.namingConvention ?? DEFAULT_NAMING_CONVENTION,
  );

  return (
    <ProductShell currentPath="/setup" session={session}>
      <main className={styles.page}>
        <SetupForm
          initialDialog={initialDialog}
          initialSection={initialSection}
          notice={notice}
          driveConnected={driveConnected}
          driveFolders={driveFolders}
          initialSettings={{
            firmName: settings?.firmName ?? "",
            namingRules,
            sourceFolderValue,
            destinationFolderValue,
            folderTemplate: normalizeFolderTemplate(settings?.folderTemplate),
            reviewRule: getReviewRuleOption(settings?.reviewInstruction).value,
          }}
          activeStorageConnection={
            activeConnection
              ? {
                  accountEmail: activeConnection.accountEmail,
                  accountName: activeConnection.accountName,
                  connectedDriveLabel:
                    driveContext?.connectedDriveLabel ??
                    activeConnection.accountName ??
                    activeConnection.accountEmail ??
                    "Connected storage",
                  id: activeConnection.id,
                  isPrimary: activeConnection.isPrimary,
                  provider: activeConnection.provider,
                  providerLabel: getProviderLabel(activeConnection.provider),
                  status: activeConnection.status,
                  statusLabel:
                    activeConnection.status === "connected"
                      ? "Connected"
                      : "Needs reconnect",
                  writableLabel: storageConnectionHasWriteAccess(activeConnection)
                    ? "Writable"
                    : "Read-only",
                }
              : null
          }
          storageConnections={storageConnections.map((connection) => ({
            accountEmail: connection.accountEmail,
            accountName: connection.accountName,
            id: connection.id,
            isPrimary: connection.isPrimary,
            provider: connection.provider,
          }))}
        />
      </main>
    </ProductShell>
  );
}

function getProviderLabel(provider: string) {
  if (provider === "google_drive") {
    return "Google Drive";
  }

  if (provider === "sharefile") {
    return "Progress ShareFile";
  }

  if (provider === "sharepoint") {
    return "Microsoft SharePoint";
  }

  if (provider === "dropbox") {
    return "Dropbox";
  }

  return "Storage";
}
