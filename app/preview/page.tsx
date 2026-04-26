import Link from "next/link";
import { ProductShell } from "@/components/product-shell";
import { StorageStatusPanel } from "@/components/storage-status-panel";
import { StorageSwitcher } from "@/components/storage-switcher";
import {
  getFilingEventsByOwnerEmail,
  getFirmSettingsByOwnerEmail,
  getReviewDecisionsByOwnerEmail,
} from "@/lib/db";
import { summarizePreviewNormalizationChanges } from "@/lib/processing-preview";
import {
  readPreviewSnapshot,
  restorePreviewItemsFromSnapshot,
} from "@/lib/preview-snapshot";
import { requireSession } from "@/lib/session";
import { getReviewRuleOption, normalizeFolderTemplate } from "@/lib/setup-config";
import { parseNamingRules } from "@/lib/naming-rules";
import { getCachedStorageConnectionsForSession } from "@/lib/storage-connections";
import { IntakeAutoRefresh } from "./intake-auto-refresh";
import { IntakeQueue } from "./intake-queue";
import styles from "./page.module.css";

export default async function PreviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string; tab?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const notice = resolvedSearchParams?.notice;
  const activeTab = normalizeTab(resolvedSearchParams?.tab);
  const session = await requireSession();
  const ownerEmail = session.user?.email;
  const storageConnections = getCachedStorageConnectionsForSession(session);
  const displayConnection =
    storageConnections.find((connection) => connection.isPrimary) ?? null;
  const activeStorageProvider = displayConnection?.provider ?? null;
  const settings = ownerEmail ? getFirmSettingsByOwnerEmail(ownerEmail) ?? null : null;
  const namingRules = parseNamingRules(
    settings?.namingRulesJson,
    settings?.namingConvention,
  );
  const savedDecisions = ownerEmail ? getReviewDecisionsByOwnerEmail(ownerEmail) : [];
  const filingEvents = ownerEmail ? getFilingEventsByOwnerEmail(ownerEmail) : [];
  const savedDecisionMap = new Map(savedDecisions.map((decision) => [decision.fileId, decision]));
  const snapshot = await readPreviewSnapshot(ownerEmail);
  const snapshotItems = restorePreviewItemsFromSnapshot(snapshot);

  const canRefreshIntake =
    Boolean(settings?.sourceFolderId) &&
    Boolean(displayConnection) &&
    displayConnection?.status === "connected";
  const storageStatusTitle = getIntakeStorageStatusTitle(displayConnection);
  const storageStatusSummary = getIntakeStorageStatusSummary(displayConnection);
  const liveQueueError =
    settings?.sourceFolderId && !canRefreshIntake ? storageStatusSummary : null;
  const existingClientFolders: string[] = [];
  const preview = {
    items: snapshotItems,
    readyCount: snapshotItems.filter((item) => item.status === "Ready to stage").length,
    reviewCount: snapshotItems.filter((item) => item.status === "Needs review").length,
    normalizationSummary: summarizePreviewNormalizationChanges(snapshotItems),
    folderTemplate: normalizeFolderTemplate(settings?.folderTemplate ?? ""),
    reviewRule: getReviewRuleOption(settings?.reviewInstruction),
  };

  const readyItems = preview.items.filter((item) => item.status === "Ready to stage");
  const reviewItems = preview.items.filter(
    (item) =>
      item.status === "Needs review" ||
      (savedDecisionMap.has(item.id) &&
        savedDecisionMap.get(item.id)?.status !== "filed"),
  );
  const filedItems =
    activeStorageProvider
      ? filingEvents.filter(
          (event) =>
            event.outcome === "succeeded" &&
            event.storageProvider === activeStorageProvider,
        )
      : [];
  const folderTemplate = normalizeFolderTemplate(settings?.folderTemplate ?? "");

  return (
    <ProductShell currentPath="/preview" session={session}>
      <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerIntro}>
          <p className={styles.eyebrow}>Intake</p>
          <h1>Live intake queue</h1>
          <p className={styles.subhead}>
            Review exceptions and file ready items.
          </p>
        </div>
        <div className={styles.headerActions}>
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
            currentPath="/preview"
            workspaceName={settings?.firmName ?? null}
          />
        </div>
      </header>

      {notice ? (
        <section className={styles.noticeCard}>
          <strong>Intake update</strong>
          <p>{notice}</p>
        </section>
      ) : null}

      <IntakeAutoRefresh activeTab={activeTab} enabled={canRefreshIntake} />

      {liveQueueError ? (
        <section className={styles.noteCard}>
          <strong>{storageStatusTitle}</strong>
          <p>{liveQueueError}</p>
        </section>
      ) : null}

      {!displayConnection ? (
        <section className={styles.noteCard}>
          <strong>Connect storage</strong>
          <p>Connect Google Drive in Settings before choosing an intake folder.</p>
          <Link className={styles.primaryAction} href="/setup?section=storage">
            Open storage settings
          </Link>
        </section>
      ) : displayConnection.status !== "connected" ? (
        <section className={styles.noteCard}>
          <strong>Reconnect storage</strong>
          <p>
            Storage is linked, but it needs to be reconnected before Intake can
            refresh from Drive.
          </p>
          <Link className={styles.primaryAction} href="/setup?section=storage">
            Open storage settings
          </Link>
        </section>
      ) : !settings?.sourceFolderId ? (
        <section className={styles.noteCard}>
          <strong>Storage connected. Choose an intake folder.</strong>
          <p>
            Choose an intake/source folder in Settings. Page navigation will keep
            using cached state until you refresh the browser page.
          </p>
          <Link className={styles.primaryAction} href="/setup?section=intake">
            Open settings
          </Link>
        </section>
      ) : null}

      {settings?.sourceFolderId && preview.items.length === 0 ? (
        <section className={styles.noteCard}>
          <strong>
            {snapshot
              ? "Cached intake preview needs a browser refresh"
              : "Refresh the browser page when you are ready"}
          </strong>
          <p>
            Sidebar navigation no longer scans Drive. Refresh this browser page to
            read the source folder and update this queue.
          </p>
        </section>
      ) : null}

      {settings?.sourceFolderId ? (
        <>
        <section className={styles.queueSection}>
            <div className={styles.tabBar}>
              {[
                {
                  id: "all",
                  label: "All Unfiled",
                  count: reviewItems.length + readyItems.length,
                },
                { id: "review", label: "Needs Review", count: reviewItems.length },
                { id: "ready", label: "Ready to File", count: readyItems.length },
                { id: "filed", label: "Filed", count: filedItems.length },
              ].map((tab) => (
                <Link
                  key={tab.id}
                  className={
                    activeTab === tab.id ? styles.activeTabLink : styles.tabLink
                  }
                  href={`/preview?tab=${tab.id}`}
                >
                  <span className={styles.tabLabel}>{tab.label}</span>
                  <strong className={styles.tabCount}>{tab.count}</strong>
                </Link>
              ))}
            </div>

            {activeTab === "filed" ? (
              <div className={styles.queueActionBar}>
                <div className={styles.actionGroup}>
                  <Link className={styles.secondaryAction} href="/history">
                    Open full audit log
                  </Link>
                </div>
              </div>
            ) : null}

            {liveQueueError && preview.items.length === 0 ? (
              <StorageStatusPanel
                title={storageStatusTitle}
                message={storageStatusSummary}
              />
            ) : (
        <IntakeQueue
          activeTab={activeTab}
          existingClientFolders={existingClientFolders}
          filedItems={filedItems}
          folderTemplate={folderTemplate}
          namingRules={namingRules}
          readyItems={readyItems}
          reviewItems={reviewItems}
          savedDecisions={savedDecisions}
          sourceFolderName={settings.sourceFolderName ?? null}
            />
            )}
          </section>
        </>
      ) : null}
      </main>
    </ProductShell>
  );
}

function normalizeTab(value?: string) {
  if (value === "review" || value === "ready" || value === "filed") {
    return value;
  }

  return "all";
}

function getIntakeStorageStatusTitle(
  connection: { status: "connected" | "needs_reauth" } | null,
) {
  if (!connection) {
    return "Connect storage";
  }

  return connection.status === "connected" ? "Storage connected" : "Reconnect storage";
}

function getIntakeStorageStatusSummary(
  connection: { status: "connected" | "needs_reauth" } | null,
) {
  if (!connection) {
    return "Connect storage to use Intake.";
  }

  if (connection.status !== "connected") {
    return "Intake can show the last cached refresh, but storage must be reconnected before scanning Drive again.";
  }

  return "Storage is connected. Choose an intake/source folder in Settings before refreshing the browser page.";
}
