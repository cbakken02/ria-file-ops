import { getFirmSettingsByOwnerEmail } from "@/lib/db";
import { ProductShell } from "@/components/product-shell";
import {
  getAppPrincipalFromSession,
  getLegacyOwnerEmail,
} from "@/lib/auth/principal";
import {
  DEFAULT_NAMING_CONVENTION,
  getReviewRuleOption,
  normalizeFolderTemplate,
} from "@/lib/setup-config";
import { parseNamingRules } from "@/lib/naming-rules";
import { requireSession } from "@/lib/session";
import {
  getCachedActiveStorageConnectionForSession,
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
  searchParams?: Promise<{
    dialog?: string;
    notice?: string;
    returnTo?: string;
    section?: string;
  }>;
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
  const closeHref = resolveSetupCloseHref(resolvedSearchParams?.returnTo);
  const session = await requireSession();
  const principal = getAppPrincipalFromSession(session);
  const ownerEmail = getLegacyOwnerEmail(principal);
  const activeConnection = getCachedActiveStorageConnectionForSession(session);
  const driveConnected = activeConnection?.status === "connected";
  const settings = getFirmSettingsByOwnerEmail(ownerEmail) ?? null;

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
          closeHref={closeHref}
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
        />
      </main>
    </ProductShell>
  );
}

function resolveSetupCloseHref(returnTo: string | undefined) {
  const candidate = returnTo?.trim();

  if (!candidate) {
    return "/dashboard";
  }

  if (candidate === "/preview") {
    return "/intake";
  }

  if (candidate === "/cleanup") {
    return "/clean-up";
  }

  if (
    candidate === "/dashboard" ||
    candidate === "/intake" ||
    candidate === "/clean-up" ||
    candidate === "/data-intelligence" ||
    candidate === "/history"
  ) {
    return candidate;
  }

  return "/dashboard";
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
