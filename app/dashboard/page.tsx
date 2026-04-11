import { FileKindIcon } from "@/components/file-kind-icon";
import { ProductShell } from "@/components/product-shell";
import {
  getFilingEventsByOwnerEmail,
  getFirmSettingsByOwnerEmail,
  getReviewDecisionsByOwnerEmail,
} from "@/lib/db";
import { listFilesInFolder } from "@/lib/google-drive";
import { readPreviewSnapshot } from "@/lib/preview-snapshot";
import { requireSession } from "@/lib/session";
import { getActiveStorageConnectionForSession } from "@/lib/storage-connections";
import styles from "./page.module.css";

export default async function DashboardPage() {
  const session = await requireSession();
  const ownerEmail = session.user?.email ?? "";
  const activeConnection = await getActiveStorageConnectionForSession(session);

  const [settings, previewSnapshot, reviewDecisions, filingEvents] = await Promise.all([
    ownerEmail
      ? Promise.resolve(getFirmSettingsByOwnerEmail(ownerEmail) ?? null)
      : Promise.resolve(null),
    readPreviewSnapshot(),
    ownerEmail
      ? Promise.resolve(getReviewDecisionsByOwnerEmail(ownerEmail))
      : Promise.resolve([]),
    ownerEmail
      ? Promise.resolve(getFilingEventsByOwnerEmail(ownerEmail))
      : Promise.resolve([]),
  ]);

  const destinationChildren =
    activeConnection &&
    settings?.destinationFolderId
      ? await listFilesInFolder(activeConnection.accessToken, settings.destinationFolderId).catch(
          () => [],
        )
      : [];

  const successfulEvents = filingEvents.filter((event) => event.outcome === "succeeded");
  const failedEvents = filingEvents.filter((event) => event.outcome === "failed");
  const autoFiledCount = successfulEvents.filter(
    (event) => event.actorType === "automation",
  ).length;
  const readyCount = previewSnapshot?.readyCount ?? 0;
  const reviewCount = previewSnapshot?.reviewCount ?? 0;
  const previewItems = previewSnapshot?.items ?? [];
  const approvedCount = reviewDecisions.filter(
    (decision) => decision.status === "approved",
  ).length;
  const queueTotal = readyCount + reviewCount;
  const processedFilesCount = successfulEvents.length + queueTotal + failedEvents.length;

  const destinationClientFolders = destinationChildren.filter(
    (file) => file.mimeType === "application/vnd.google-apps.folder",
  );
  const clientFolderNames = new Set(
    [
      ...destinationClientFolders.map((folder) => folder.name),
      ...successfulEvents
        .map((event) => event.clientFolderName)
        .filter((value): value is string => Boolean(value)),
    ].filter(Boolean),
  );
  const clientFolderCount = clientFolderNames.size;
  const automationRate =
    successfulEvents.length > 0
      ? autoFiledCount / successfulEvents.length
      : queueTotal > 0
        ? readyCount / queueTotal
        : 0;

  const autoSavedMinutes =
    sumSavedMinutes(
      successfulEvents.filter((event) => event.actorType === "automation"),
      "auto_filed",
    ) + sumSavedMinutes(previewItems.filter((item) => item.status === "Ready to stage"), "ready");
  const reviewSavedMinutes =
    sumSavedMinutes(
      successfulEvents.filter((event) => event.actorType !== "automation"),
      "review_filed",
    ) + sumSavedMinutes(
      previewItems.filter(
        (item) =>
          item.status === "Needs review" &&
          !(item.suggestedClientFolder && !item.resolvedClientFolder),
      ),
      "review_pending",
    );
  const newClientSavedMinutes = sumSavedMinutes(
    previewItems.filter(
      (item) =>
        item.status === "Needs review" &&
        Boolean(item.suggestedClientFolder && !item.resolvedClientFolder),
    ),
    "new_client",
  );
  const failedSavedMinutes = sumSavedMinutes(failedEvents, "failed");
  const estimatedMinutesSaved =
    autoSavedMinutes +
    reviewSavedMinutes +
    newClientSavedMinutes +
    failedSavedMinutes;

  const recentEvents = [...filingEvents]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);

  return (
    <ProductShell currentPath="/dashboard" session={session}>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Dashboard</p>
            <h1>Operational pulse.</h1>
          </div>
          <div className={styles.headerMeta}>
            <span>{settings?.sourceFolderName ?? "Source not set"}</span>
            <span>{previewSnapshot?.generatedAt ? formatTimestamp(previewSnapshot.generatedAt) : "No live snapshot yet"}</span>
          </div>
        </header>

        <section className={styles.heroGrid}>
          <section className={styles.impactSection}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.panelLabel}>Estimated time saved</p>
              </div>
              <span className={styles.metaBadge}>Weighted estimate</span>
            </div>

            <div className={styles.impactValueWrap}>
              <div className={styles.impactValue} tabIndex={0}>
                {formatTimeSaved(estimatedMinutesSaved)}
              </div>
              <div className={styles.impactTooltip}>
                Based on {formatWholeNumber(processedFilesCount)} files touched so
                far, weighted by document type and workflow stage. Money movement
                forms save more time than simple IDs, while new-client and review
                items count as partial savings instead of full automation.
              </div>
            </div>

            <div className={styles.metaRow}>
              <div className={styles.metaStat}>
                <span>Automation rate</span>
                <strong>{formatPercent(automationRate)}</strong>
              </div>
              <div className={styles.metaStat}>
                <span>Files touched</span>
                <strong>{formatWholeNumber(processedFilesCount)}</strong>
              </div>
              <div className={styles.metaStat}>
                <span>Client folders</span>
                <strong>{formatWholeNumber(clientFolderCount)}</strong>
              </div>
            </div>
          </section>
        </section>

        <section className={styles.dashboardGrid}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.panelLabel}>Recent activity</p>
                <h2>Latest filing actions</h2>
              </div>
            </div>

            {recentEvents.length ? (
              <div className={styles.activityList}>
                {recentEvents.map((event) => (
                  <div key={event.id} className={styles.activityRow}>
                    <div className={styles.activityMain}>
                      <div className={styles.activityFileRow}>
                        <FileKindIcon
                          className={styles.activityFileIcon}
                          mimeType={event.sourceMimeType}
                          name={event.finalFilename ?? event.sourceName}
                        />
                        <strong>{event.finalFilename ?? event.sourceName}</strong>
                      </div>
                      <p>
                        {event.outcome === "succeeded"
                          ? `${event.clientFolderName ?? "Unknown client"} / ${event.topLevelFolderName ?? "Unknown folder"}`
                          : event.errorMessage ?? "Needs review"}
                      </p>
                    </div>
                    <div className={styles.activityMeta}>
                      <span
                        className={
                          event.outcome === "succeeded"
                            ? styles.goodBadge
                            : styles.warnBadge
                        }
                      >
                        {event.outcome === "succeeded"
                          ? event.actorType === "automation"
                            ? "System"
                            : "Reviewed"
                          : "Error"}
                      </span>
                      <small>{formatTimestamp(event.createdAt)}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.placeholder}>
                Once files start moving, the latest activity will show up here.
              </p>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.panelLabel}>Queue totals</p>
                <h2>Current workload</h2>
              </div>
            </div>

            <div className={styles.summaryGrid}>
              <div className={styles.summaryCell}>
                <span>Ready now</span>
                <strong>{formatWholeNumber(readyCount)}</strong>
              </div>
              <div className={styles.summaryCell}>
                <span>Needs review</span>
                <strong>{formatWholeNumber(reviewCount)}</strong>
              </div>
              <div className={styles.summaryCell}>
                <span>Approved</span>
                <strong>{formatWholeNumber(approvedCount)}</strong>
              </div>
              <div className={styles.summaryCell}>
                <span>Failed</span>
                <strong>{formatWholeNumber(failedEvents.length)}</strong>
              </div>
            </div>
          </section>
        </section>
      </main>
    </ProductShell>
  );
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatTimeSaved(minutes: number) {
  if (minutes >= 60) {
    return `${(minutes / 60).toFixed(minutes >= 600 ? 0 : 1)} hrs`;
  }

  return `${Math.round(minutes)} min`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatWholeNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function sumSavedMinutes(
  items: Array<{ detectedDocumentType?: string | null }>,
  stage: "auto_filed" | "review_filed" | "ready" | "review_pending" | "new_client" | "failed",
) {
  return items.reduce((sum, item) => {
    const baseMinutes = baseMinutesForDocumentType(item.detectedDocumentType ?? null);
    return sum + baseMinutes * savingsFactorForStage(stage);
  }, 0);
}

function baseMinutesForDocumentType(value: string | null) {
  const normalized = value?.toLowerCase() ?? "";

  if (normalized.includes("money movement")) {
    return 5.5;
  }

  if (normalized.includes("account statement")) {
    return 4.5;
  }

  if (normalized.includes("identity") || normalized.includes("client document")) {
    return 3.2;
  }

  if (normalized.includes("planning")) {
    return 4.1;
  }

  if (normalized.includes("review")) {
    return 3.6;
  }

  return 3.8;
}

function savingsFactorForStage(
  stage: "auto_filed" | "review_filed" | "ready" | "review_pending" | "new_client" | "failed",
) {
  switch (stage) {
    case "auto_filed":
      return 1;
    case "ready":
      return 0.9;
    case "review_filed":
      return 0.5;
    case "review_pending":
      return 0.35;
    case "new_client":
      return 0.25;
    case "failed":
      return 0.1;
    default:
      return 0;
  }
}
