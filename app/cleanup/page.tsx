import { ProductShell } from "@/components/product-shell";
import { StorageSwitcher } from "@/components/storage-switcher";
import { getFirmSettingsByOwnerEmail } from "@/lib/db";
import { getDriveFolderTrail, listDriveBrowserItems } from "@/lib/google-drive";
import { parseNamingRules } from "@/lib/naming-rules";
import { requireSession } from "@/lib/session";
import {
  getStorageConnectionsForSession,
  getVerifiedActiveStorageConnectionForSession,
} from "@/lib/storage-connections";
import { CleanupPlanner } from "./cleanup-planner";
import styles from "./page.module.css";

export default async function CleanupPage() {
  const session = await requireSession();
  const ownerEmail = session.user?.email ?? "";
  const activeConnection = await getVerifiedActiveStorageConnectionForSession(session);
  const storageConnections = await getStorageConnectionsForSession(session);
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
  let initialFolderTrail: Array<{ id: string; name: string }> = [];
  let initialBrowserItems: Awaited<ReturnType<typeof listDriveBrowserItems>> = [];
  let initialStorageError: string | null = null;

  if (activeConnection?.accessToken) {
    try {
      [initialFolderTrail, initialBrowserItems] = await Promise.all([
        getDriveFolderTrail(activeConnection.accessToken, initialCurrentFolderId),
        listDriveBrowserItems(activeConnection.accessToken, initialCurrentFolderId),
      ]);
    } catch (error) {
      initialStorageError =
        error instanceof Error
          ? error.message
          : "The selected storage folder could not be loaded.";
    }
  }

  const hasVerifiedStorageAccess = Boolean(activeConnection) && !initialStorageError;

  return (
    <ProductShell currentPath="/cleanup" session={session}>
      <main className={styles.page}>
        <header className={styles.header}>
        <div className={styles.headerIntro}>
          <p className={styles.eyebrow}>Cleanup</p>
          <h1>Clean up existing files and folders.</h1>
          <p className={styles.subhead}>
            Select a file or folder to make a change.
          </p>
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

        <CleanupPlanner
          hasActiveStorage={hasVerifiedStorageAccess}
          inactiveStorageMessage={
            initialStorageError ??
            (displayConnection
              ? "Reconnect the active storage connection to browse existing files."
              : "Connect a storage to begin.")
          }
          rootBrowserFolderId={rootBrowserFolderId}
          rootBrowserFolderName={rootBrowserFolderName}
          initialCurrentFolderId={initialCurrentFolderId}
          initialFolderTrail={initialFolderTrail}
          initialBrowserItems={initialBrowserItems}
          namingRules={namingRules}
        />
      </main>
    </ProductShell>
  );
}
