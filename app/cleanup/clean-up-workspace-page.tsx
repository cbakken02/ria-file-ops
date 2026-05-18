import { ProductShell } from "@/components/product-shell";
import { StorageStatusPanel } from "@/components/storage-status-panel";
import { WorkspaceStorageStatus } from "@/components/workspace-storage-status";
import {
  getAppPrincipalFromSession,
  getLegacyOwnerEmail,
} from "@/lib/auth/principal";
import { getFirmSettingsByOwnerEmail } from "@/lib/db";
import { parseNamingRules } from "@/lib/naming-rules";
import { requireSession } from "@/lib/session";
import {
  getActiveStorageConnectionForSession,
} from "@/lib/storage-connections";
import type { CleanupBrowserItem } from "@/lib/cleanup-types";
import { CleanupPlanner } from "./cleanup-planner";
import styles from "./page.module.css";

export async function CleanUpWorkspacePage({
  currentPath,
}: {
  currentPath: "/clean-up";
}) {
  const session = await requireSession();
  const principal = getAppPrincipalFromSession(session);
  const ownerEmail = getLegacyOwnerEmail(principal);
  const displayConnection = await getActiveStorageConnectionForSession(session);
  const settings = getFirmSettingsByOwnerEmail(ownerEmail) ?? null;
  const namingRules = parseNamingRules(
    settings?.namingRulesJson,
    settings?.namingConvention,
  );
  const rootBrowserFolderId = "root";
  const rootBrowserFolderName = "My Drive";
  const initialCurrentFolderId = settings?.destinationFolderId ?? rootBrowserFolderId;
  const initialFolderTrail: Array<{ id: string; name: string }> = [];
  const initialBrowserItems: CleanupBrowserItem[] = [];
  const hasCachedStorageAccess = displayConnection?.status === "connected";
  const inactiveStorageTitle = displayConnection
    ? "Reconnect storage"
    : "Connect storage";
  const inactiveStorageMessage = displayConnection
    ? "Clean Up can browse Drive after storage is reconnected."
    : "Connect storage to use Clean Up.";

  return (
    <ProductShell currentPath={currentPath} session={session}>
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerIntro}>
          <p className={styles.eyebrow}>Clean Up</p>
            <h1>Rename and reorganize existing files and folders</h1>
          </div>
          <WorkspaceStorageStatus connection={displayConnection} />
        </header>

        {!hasCachedStorageAccess ? (
          <div className={styles.cleanupLayout}>
            <section className={styles.selectionSection}>
              <StorageStatusPanel
                actionHref="/setup?section=workspace&returnTo=%2Fclean-up"
                title={inactiveStorageTitle}
                message={inactiveStorageMessage}
              />
            </section>
          </div>
        ) : (
          <CleanupPlanner
            hasActiveStorage={hasCachedStorageAccess}
            inactiveStorageMessage={inactiveStorageMessage}
            inactiveStorageTitle={inactiveStorageTitle}
            rootBrowserFolderId={rootBrowserFolderId}
            rootBrowserFolderName={rootBrowserFolderName}
            initialCurrentFolderId={initialCurrentFolderId}
            initialFolderTrail={initialFolderTrail}
            initialBrowserItems={initialBrowserItems}
            namingRules={namingRules}
          />
        )}
      </main>
    </ProductShell>
  );
}
