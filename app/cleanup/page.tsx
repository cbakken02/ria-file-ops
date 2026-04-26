import { ProductShell } from "@/components/product-shell";
import { StorageStatusPanel } from "@/components/storage-status-panel";
import { StorageSwitcher } from "@/components/storage-switcher";
import { getFirmSettingsByOwnerEmail } from "@/lib/db";
import { parseNamingRules } from "@/lib/naming-rules";
import { requireSession } from "@/lib/session";
import {
  getCachedStorageConnectionsForSession,
} from "@/lib/storage-connections";
import type { CleanupBrowserItem } from "@/lib/cleanup-types";
import { CleanupPlanner } from "./cleanup-planner";
import styles from "./page.module.css";

export default async function CleanupPage() {
  const session = await requireSession();
  const ownerEmail = session.user?.email ?? "";
  const storageConnections = getCachedStorageConnectionsForSession(session);
  const displayConnection =
    storageConnections.find((connection) => connection.isPrimary) ?? null;
  const settings = ownerEmail ? getFirmSettingsByOwnerEmail(ownerEmail) ?? null : null;
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
    ? "Cleanup can browse Drive after storage is reconnected."
    : "Connect storage to use Cleanup.";

  return (
    <ProductShell currentPath="/cleanup" session={session}>
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerIntro}>
            <p className={styles.eyebrow}>Cleanup</p>
            <h1>Rename and reorganize existing files and folders</h1>
          </div>
          <StorageSwitcher
            activeConnection={
              displayConnection
                ? {
                    id: displayConnection.id,
                    provider: displayConnection.provider,
                    accountName: displayConnection.accountName,
                    accountEmail: displayConnection.accountEmail,
                    isPrimary: displayConnection.isPrimary,
                    status: displayConnection.status,
                  }
                : null
            }
            connections={storageConnections.map((connection) => ({
              id: connection.id,
              provider: connection.provider,
              accountName: connection.accountName,
              accountEmail: connection.accountEmail,
              isPrimary: connection.isPrimary,
              status: connection.status,
            }))}
            currentPath="/cleanup"
            workspaceName={settings?.firmName ?? null}
          />
        </header>

        {!hasCachedStorageAccess ? (
          <div className={styles.cleanupLayout}>
            <section className={styles.selectionSection}>
              <StorageStatusPanel
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
