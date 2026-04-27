import { getFirmSettingsByOwnerEmail } from "@/lib/db";
import { ProductShell } from "@/components/product-shell";
import {
  DEFAULT_NAMING_CONVENTION,
  getReviewRuleOption,
  normalizeFolderTemplate,
} from "@/lib/setup-config";
import { parseNamingRules } from "@/lib/naming-rules";
import { requireSession } from "@/lib/session";
import {
  getCachedActiveStorageConnectionForSession,
  getCachedStorageConnectionsForSession,
  storageConnectionHasWriteAccess,
} from "@/lib/storage-connections";
import { SetupForm } from "./setup-form";
import styles from "./page.module.css";

const validSections = new Set([
  "workspace",
  "rules",
  "workflow",
  "privacy",
]);

type SettingsSectionId = "workspace" | "rules" | "workflow" | "privacy";

const sectionAliases: Record<string, SettingsSectionId> = {
  cleanup: "workflow",
  general: "workspace",
  intake: "workspace",
  naming: "rules",
  privacy: "privacy",
  rules: "rules",
  security: "privacy",
  storage: "workspace",
  workflow: "workflow",
  workspace: "workspace",
};

export default async function SetupPage({
  searchParams,
}: {
  searchParams?: Promise<{ dialog?: string; notice?: string; section?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedSection = resolvedSearchParams?.section?.trim() ?? "";
  const initialSection = validSections.has(requestedSection)
    ? (requestedSection as SettingsSectionId)
    : sectionAliases[requestedSection] ?? "workspace";
  const notice = resolvedSearchParams?.notice?.trim() || null;
  const initialDialog =
    resolvedSearchParams?.dialog === "data-handling"
      ? ("data-handling" as const)
      : null;
  const session = await requireSession();
  const ownerEmail = session.user?.email;
  const activeConnection = getCachedActiveStorageConnectionForSession(session);
  const storageConnections = getCachedStorageConnectionsForSession(session);
  const driveConnected = activeConnection?.status === "connected";
  const settings = ownerEmail ? getFirmSettingsByOwnerEmail(ownerEmail) ?? null : null;

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
          driveFolders={[]}
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
