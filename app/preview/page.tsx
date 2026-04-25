import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductShell } from "@/components/product-shell";
import { StorageSwitcher } from "@/components/storage-switcher";
import {
  getClientMemoryRulesByOwnerEmail,
  getFilingEventsByOwnerEmail,
  getFirmSettingsByOwnerEmail,
  getReviewDecisionsByOwnerEmail,
} from "@/lib/db";
import { downloadDriveFile, listFilesInFolder } from "@/lib/google-drive";
import { buildProcessingPreview } from "@/lib/processing-preview";
import { writePreviewSnapshot } from "@/lib/preview-snapshot";
import { requireSession } from "@/lib/session";
import { getReviewRuleOption, normalizeFolderTemplate } from "@/lib/setup-config";
import { parseNamingRules } from "@/lib/naming-rules";
import {
  getStorageConnectionsForSession,
  getVerifiedActiveStorageConnectionForSession,
  storageConnectionHasWriteAccess,
} from "@/lib/storage-connections";
import { IntakeQueue } from "./intake-queue";
import { RefreshIntakeButton } from "./refresh-intake-button";
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
  const activeConnection = await getVerifiedActiveStorageConnectionForSession(session);
  const storageConnections = await getStorageConnectionsForSession(session);
  const displayConnection =
    storageConnections.find((connection) => connection.isPrimary) ?? null;
  const activeStorageProvider =
    displayConnection?.provider ?? activeConnection?.provider ?? null;
  const settings = ownerEmail ? getFirmSettingsByOwnerEmail(ownerEmail) ?? null : null;
  const namingRules = parseNamingRules(
    settings?.namingRulesJson,
    settings?.namingConvention,
  );
  const savedDecisions = ownerEmail ? getReviewDecisionsByOwnerEmail(ownerEmail) : [];
  const filingEvents = ownerEmail ? getFilingEventsByOwnerEmail(ownerEmail) : [];
  const clientMemoryRules = ownerEmail ? getClientMemoryRulesByOwnerEmail(ownerEmail) : [];
  const savedDecisionMap = new Map(savedDecisions.map((decision) => [decision.fileId, decision]));

  const canPreview =
    Boolean(activeConnection) &&
    Boolean(settings?.sourceFolderId);

  let sourceFiles: Awaited<ReturnType<typeof listFilesInFolder>> = [];
  let sourceFolderError: string | null = null;

  if (canPreview && activeConnection && settings?.sourceFolderId) {
    try {
      sourceFiles = await listFilesInFolder(
        activeConnection.accessToken,
        settings.sourceFolderId,
      );
    } catch (error) {
      sourceFolderError =
        error instanceof Error
          ? error.message
          : "The intake folder could not be loaded from Google Drive.";
    }
  }

  let destinationChildren: Awaited<ReturnType<typeof listFilesInFolder>> = [];
  let destinationFolderError: string | null = null;

  if (canPreview && activeConnection && settings?.destinationFolderId) {
    try {
      destinationChildren = await listFilesInFolder(
        activeConnection.accessToken,
        settings.destinationFolderId,
      );
    } catch (error) {
      destinationFolderError =
        error instanceof Error
          ? error.message
          : "The destination root could not be loaded from Google Drive.";
    }
  }

  const storageUnavailableMessage = displayConnection
    ? "Reconnect the active storage connection to load this workspace."
    : "Connect a storage to begin.";
  const liveQueueError =
    (!activeConnection && settings?.sourceFolderId
      ? storageUnavailableMessage
      : null) ??
    sourceFolderError ??
    destinationFolderError ??
    (session.authError
      ? "Your storage connection needs to be refreshed. Reconnect it if this keeps happening."
      : null);
  const hasVerifiedStorageAccess = Boolean(activeConnection) && !liveQueueError;
  const existingClientFolders = destinationChildren
    .filter((file) => file.mimeType === "application/vnd.google-apps.folder")
    .map((file) => file.name);

  const preview = liveQueueError
    ? {
        items: [],
        readyCount: 0,
        reviewCount: 0,
        folderTemplate: normalizeFolderTemplate(settings?.folderTemplate ?? ""),
        reviewRule: getReviewRuleOption(settings?.reviewInstruction),
      }
    : await buildProcessingPreview(
        sourceFiles,
        settings,
        async (fileId) => {
          if (!activeConnection) {
            throw new Error("Missing active storage connection.");
          }

          return downloadDriveFile(activeConnection.accessToken, fileId);
        },
        existingClientFolders,
        clientMemoryRules,
        { analysisMode: "preview" },
      );

  const readyItems = preview.items.filter((item) => item.status === "Ready to stage");

  if (
    !liveQueueError &&
    !notice &&
    ownerEmail &&
    activeConnection &&
    storageConnectionHasWriteAccess(activeConnection) &&
    settings?.destinationFolderId &&
    preview.reviewRule.value === "auto_file_high_confidence" &&
    readyItems.length > 0
  ) {
    redirect("/preview/auto-file");
  }

  if (!liveQueueError) {
    await writePreviewSnapshot({
      ownerEmail,
      sourceFolder: settings?.sourceFolderName ?? null,
      destinationRoot: settings?.destinationFolderName ?? null,
      reviewPosture: preview.reviewRule.title,
      readyCount: preview.readyCount,
      reviewCount: preview.reviewCount,
      items: preview.items,
    });
  }

  const reviewItems = preview.items.filter(
    (item) =>
      item.status === "Needs review" ||
      (savedDecisionMap.has(item.id) &&
        savedDecisionMap.get(item.id)?.status !== "filed"),
  );
  const filedItems =
    hasVerifiedStorageAccess && activeStorageProvider
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
          <RefreshIntakeButton
            activeTab={activeTab}
            disabled={!canPreview || Boolean(liveQueueError)}
          />
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

      {liveQueueError ? (
        <section className={styles.noteCard}>
          <strong>Storage access could not be verified</strong>
          <p>{liveQueueError}</p>
          <p>
            Intake counts and filed-item details stay hidden until storage access is
            restored.
          </p>
          <Link className={styles.secondaryAction} href="/setup?section=storage">
            Check storage connection
          </Link>
        </section>
      ) : null}

      {!settings?.sourceFolderId ? (
        <section className={styles.noteCard}>
          <strong>Choose a source folder first</strong>
          <p>
            Go back to settings and select the intake folder you want this intake queue
            to read from.
          </p>
          <Link className={styles.primaryAction} href="/setup">
            Open settings
          </Link>
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

        <IntakeQueue
          activeTab={activeTab}
          existingClientFolders={existingClientFolders}
          filedItems={filedItems}
          folderTemplate={folderTemplate}
          hasVerifiedStorage={hasVerifiedStorageAccess}
          namingRules={namingRules}
          readyItems={readyItems}
          reviewItems={reviewItems}
          savedDecisions={savedDecisions}
          storageUnavailableMessage={storageUnavailableMessage}
              sourceFolderName={settings.sourceFolderName ?? null}
            />
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
