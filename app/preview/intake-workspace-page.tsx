import Link from "next/link";
import { ProductShell } from "@/components/product-shell";
import { StorageStatusPanel } from "@/components/storage-status-panel";
import { WorkspaceStorageStatus } from "@/components/workspace-storage-status";
import { refreshIntakeAction } from "@/app/preview/actions";
import {
  getFilingEventsByOwnerEmail,
  getFirmSettingsByOwnerEmail,
  getReviewDecisionsByOwnerEmail,
} from "@/lib/db";
import {
  getAppPrincipalFromSession,
  getLegacyOwnerEmail,
} from "@/lib/auth/principal";
import { summarizePreviewNormalizationChanges } from "@/lib/processing-preview";
import {
  readPreviewSnapshot,
  restorePreviewItemsFromSnapshot,
  type PreviewSnapshot,
} from "@/lib/preview-snapshot";
import { requireSession } from "@/lib/session";
import { getReviewRuleOption, normalizeFolderTemplate } from "@/lib/setup-config";
import { parseNamingRules } from "@/lib/naming-rules";
import { getActiveStorageConnectionForSession } from "@/lib/storage-connections";
import { IntakeQueue } from "./intake-queue";
import styles from "./page.module.css";

export async function IntakeWorkspacePage({
  currentPath,
  searchParams,
}: {
  currentPath: "/intake";
  searchParams?: Promise<{
    notice?: string;
    scanStatus?: string;
    tab?: string;
  }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const notice = resolvedSearchParams?.notice;
  const scanStatus = normalizeScanStatus(resolvedSearchParams?.scanStatus);
  const activeTab = normalizeTab(resolvedSearchParams?.tab);
  const session = await requireSession();
  const principal = getAppPrincipalFromSession(session);
  const ownerEmail = getLegacyOwnerEmail(principal);
  const displayConnection = await getActiveStorageConnectionForSession(session);
  const activeStorageProvider = displayConnection?.provider ?? null;
  const settings = getFirmSettingsByOwnerEmail(ownerEmail) ?? null;
  const namingRules = parseNamingRules(
    settings?.namingRulesJson,
    settings?.namingConvention,
  );
  const savedDecisions = getReviewDecisionsByOwnerEmail(ownerEmail);
  const filingEvents = getFilingEventsByOwnerEmail(ownerEmail);
  const savedDecisionMap = new Map(savedDecisions.map((decision) => [decision.fileId, decision]));
  const snapshot = await readPreviewSnapshot(ownerEmail);
  const snapshotItems = restorePreviewItemsFromSnapshot(snapshot);

  const canRescanIntake =
    Boolean(settings?.sourceFolderId) &&
    Boolean(displayConnection) &&
    displayConnection?.status === "connected";
  const storageStatusTitle = getIntakeStorageStatusTitle(displayConnection);
  const storageStatusSummary = getIntakeStorageStatusSummary(displayConnection);
  const liveQueueError =
    settings?.sourceFolderId && !canRescanIntake ? storageStatusSummary : null;
  const lastScanError = scanStatus === "error" ? notice ?? null : null;
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
    <ProductShell currentPath={currentPath} session={session}>
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
          <WorkspaceStorageStatus connection={displayConnection} />
        </div>
      </header>

      {notice ? (
        <section className={styles.noticeCard}>
          <strong>Intake update</strong>
          <p>{notice}</p>
        </section>
      ) : null}

      <section className={styles.scanStatusPanel}>
        <div className={styles.scanStatusHeader}>
          <div>
            <p className={styles.cardEyebrow}>Source scan</p>
            <h2>Drive source folder</h2>
          </div>
          {canRescanIntake ? (
            <form action={refreshIntakeAction}>
              <input name="tab" type="hidden" value={activeTab} />
              <button className={styles.primaryAction} type="submit">
                Rescan source folder
              </button>
            </form>
          ) : displayConnection?.provider === "google_drive" ? (
            <Link className={styles.primaryAction} href="/api/storage/google/start">
              Reconnect Google Drive
            </Link>
          ) : (
            <Link
              className={styles.primaryAction}
              href="/setup?section=workspace&returnTo=%2Fintake"
            >
              Connect Google Drive
            </Link>
          )}
        </div>
        <dl className={styles.scanStatusGrid}>
          <div>
            <dt>Provider</dt>
            <dd>{getProviderLabel(displayConnection?.provider ?? null)}</dd>
          </div>
          <div>
            <dt>Google account</dt>
            <dd>
              {displayConnection?.accountEmail ??
                displayConnection?.accountName ??
                "Not connected"}
            </dd>
          </div>
          <div>
            <dt>Source folder</dt>
            <dd>
              {settings?.sourceFolderName ?? "Not selected"}
              {settings?.sourceFolderId ? (
                <span>{settings.sourceFolderId}</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Last completed rescan</dt>
            <dd>{formatScanTime(snapshot?.generatedAt ?? null)}</dd>
          </div>
          <div>
            <dt>Displayed queue</dt>
            <dd>{getCacheStateLabel(snapshot, preview.items.length)}</dd>
          </div>
          <div>
            <dt>Last error</dt>
            <dd>{lastScanError ?? "None"}</dd>
          </div>
        </dl>
        {settings?.sourceFolderId ? (
          <p className={styles.scanStatusHelp}>
            Browser refresh shows the saved queue from the last completed rescan.
            Use Rescan source folder to check Drive for new or changed files.
          </p>
        ) : null}
      </section>

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
          <Link
            className={styles.primaryAction}
            href="/setup?section=workspace&returnTo=%2Fintake"
          >
            Open workspace settings
          </Link>
        </section>
      ) : displayConnection.status !== "connected" ? (
        <section className={styles.noteCard}>
          <strong>Reconnect storage</strong>
          <p>
            Storage is linked, but it needs to be reconnected before Intake can
            refresh from Drive.
          </p>
          <Link
            className={styles.primaryAction}
            href="/setup?section=workspace&returnTo=%2Fintake"
          >
            Open workspace settings
          </Link>
        </section>
      ) : !settings?.sourceFolderId ? (
        <section className={styles.noteCard}>
          <strong>Storage connected. Choose an intake folder.</strong>
          <p>
            Choose an intake/source folder in Settings before rescanning Drive.
          </p>
          <Link
            className={styles.primaryAction}
            href="/setup?section=workspace&returnTo=%2Fintake"
          >
            Open settings
          </Link>
        </section>
      ) : null}

      {settings?.sourceFolderId && preview.items.length === 0 ? (
        <section className={styles.noteCard}>
          <strong>Rescan the source folder when you are ready</strong>
          <p>
            Intake will call Google Drive from the server, rebuild the queue from
            the live source folder listing, and show any folder-specific error here.
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
                  href={`/intake?tab=${tab.id}`}
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

function normalizeScanStatus(value?: string) {
  return value === "success" || value === "error" ? value : null;
}

function getProviderLabel(provider: string | null) {
  if (provider === "google_drive") {
    return "Google Drive";
  }

  if (!provider) {
    return "Not connected";
  }

  return provider;
}

function formatScanTime(value: string | null) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getCacheStateLabel(
  snapshot: PreviewSnapshot | null,
  itemCount: number,
) {
  if (!snapshot) {
    return "No saved queue yet";
  }

  if (itemCount === 0) {
    return "Last rescan found no unfiled items";
  }

  return `Saved queue with ${itemCount} item${itemCount === 1 ? "" : "s"}`;
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

  return "Storage is connected. Choose an intake/source folder in Settings before rescanning Drive.";
}
