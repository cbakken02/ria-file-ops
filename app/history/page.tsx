import Link from "next/link";
import { FileKindIcon } from "@/components/file-kind-icon";
import { ProductShell } from "@/components/product-shell";
import { StorageStatusPanel } from "@/components/storage-status-panel";
import { StorageSwitcher } from "@/components/storage-switcher";
import { HistoryEventsList } from "@/app/history/history-events";
import { getFilingEventsByOwnerEmail } from "@/lib/db";
import {
  displayHistoryActor,
  filterHistoryEvents,
  getHistoryActionKind,
  getHistoryDisplayFilename,
  hasHistoryMove,
  hasHistoryRename,
  normalizeHistoryMoverFilter,
  normalizeHistorySortOption,
  normalizeHistoryStatusFilter,
  sortHistoryEvents,
  type HistoryMoverFilter,
  type HistorySortOption,
  type HistoryStatusFilter,
} from "@/lib/history-view";
import { requireSession } from "@/lib/session";
import {
  getCachedStorageConnectionsForSession,
} from "@/lib/storage-connections";
import styles from "./page.module.css";

type HistoryMode = "events" | "batches";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: Promise<{
    mode?: string;
    q?: string;
    mover?: string;
    sort?: string;
    status?: string;
  }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const query = resolvedSearchParams?.q?.trim() ?? "";
  const mode = normalizeHistoryMode(resolvedSearchParams?.mode);
  const status = normalizeHistoryStatusFilter(resolvedSearchParams?.status);
  const mover = normalizeHistoryMoverFilter(resolvedSearchParams?.mover);
  const sort = normalizeHistorySortOption(resolvedSearchParams?.sort);
  const session = await requireSession();
  const ownerEmail = session.user?.email ?? "";
  const storageConnections = getCachedStorageConnectionsForSession(session);
  const displayConnection =
    storageConnections.find((connection) => connection.isPrimary) ?? null;
  const activeStorageProvider = displayConnection?.provider ?? null;
  const hasCachedStorageAccess = displayConnection?.status === "connected";
  const historyStatusTitle = displayConnection
    ? "Reconnect storage"
    : "Connect storage";
  const historyStatusSummary = displayConnection
    ? "Filing history can show cached events, but live exports need a reconnect."
    : "Connect storage to use Filing History.";
  const allEvents =
    ownerEmail && hasCachedStorageAccess && activeStorageProvider
      ? getFilingEventsByOwnerEmail(ownerEmail).filter(
          (event) => event.storageProvider === activeStorageProvider,
        )
      : [];
  const queriedEvents = filterHistoryEvents(allEvents, {
    mover: "all",
    query,
    status: "all",
  });
  const baseEvents = filterHistoryEvents(queriedEvents, {
    mover,
    status: "all",
  });
  const events = sortHistoryEvents(
    filterHistoryEvents(baseEvents, { status }),
    sort,
  );
  const batchGroups = sortBatchGroups(
    groupBatchEvents(baseEvents.filter((event) => event.eventType !== "review_approved")),
    sort,
  );
  const systemCount = queriedEvents.filter(
    (event) => event.actorType === "automation",
  ).length;
  const renamedCount = queriedEvents.filter(hasHistoryRename).length;
  const movedCount = queriedEvents.filter(hasHistoryMove).length;
  const failedCount = queriedEvents.filter(
    (event) => getHistoryActionKind(event) === "action_failed",
  ).length;
  const exportHref = buildExportHref({
    mover,
    query,
    sort,
    status: mode === "events" ? status : "all",
  });

  return (
    <ProductShell currentPath="/history" session={session}>
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerIntro}>
            <p className={styles.eyebrow}>Audit trail</p>
            <h1>Filing history</h1>
          </div>
          <div className={styles.headerActions}>
            {hasCachedStorageAccess ? (
              <Link className={styles.exportButton} href={exportHref}>
                Export CSV
              </Link>
            ) : null}
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
              currentPath="/history"
            />
          </div>
        </header>

        <section className={styles.controlsRow}>
          <form action="/history" className={styles.searchForm}>
            <input name="mode" type="hidden" value={mode} />
            <input
              name="status"
              type="hidden"
              value={mode === "events" ? status : "all"}
            />
            <input
              aria-label="Search audit history"
              className={styles.searchInput}
              defaultValue={query}
              name="q"
              placeholder="Search file, action, client, folder, or actor"
              type="search"
            />
            <div className={styles.filterGroup}>
              <label className={styles.selectLabel}>
                <span>Moved by</span>
                <select
                  className={styles.controlSelect}
                  defaultValue={mover}
                  name="mover"
                >
                  <option value="all">Everyone</option>
                  <option value="system">System</option>
                  <option value="human">People</option>
                </select>
              </label>

              <label className={styles.selectLabel}>
                <span>Sort</span>
                <select
                  className={styles.controlSelect}
                  defaultValue={sort}
                  name="sort"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="filename_az">Filename A-Z</option>
                  <option value="client_az">Client A-Z</option>
                </select>
              </label>
            </div>

            <div className={styles.actionCluster}>
              <button className={styles.searchButton} type="submit">
                Apply
              </button>
              <div className={styles.clearSlot}>
                {hasActiveFilters({ mover, query, sort, status }) ? (
                  <Link className={styles.clearLink} href="/history">
                    Clear
                  </Link>
                ) : (
                  <span
                    aria-hidden="true"
                    className={styles.clearPlaceholder}
                  >
                    Clear
                  </span>
                )}
              </div>
            </div>
          </form>
        </section>

        <section className={styles.statsRow}>
          <Link
            aria-current={
              mode === "events" && status === "all" && mover === "all"
                ? "page"
                : undefined
            }
            className={
              mode === "events" && status === "all" && mover === "all"
                ? styles.activeStatPill
                : styles.statPill
            }
            href={buildHistoryHref({
              mode: "events",
              mover: "all",
              query,
              sort,
              status: "all",
            })}
          >
            <span>All Actions</span>
            <strong>{formatWholeNumber(queriedEvents.length)}</strong>
          </Link>
          <Link
            aria-current={
              mode === "events" && status === "all" && mover === "system"
                ? "page"
                : undefined
            }
            className={
              mode === "events" && status === "all" && mover === "system"
                ? styles.activeStatPill
                : styles.statPill
            }
            href={buildHistoryHref({
              mode: "events",
              mover: "system",
              query,
              sort,
              status: "all",
            })}
          >
            <span>System Actions</span>
            <strong>{formatWholeNumber(systemCount)}</strong>
          </Link>
          <Link
            aria-current={
              mode === "events" && status === "renamed" && mover === "all"
                ? "page"
                : undefined
            }
            className={
              mode === "events" && status === "renamed" && mover === "all"
                ? styles.activeStatPill
                : styles.statPill
            }
            href={buildHistoryHref({
              mode: "events",
              mover: "all",
              query,
              sort,
              status: "renamed",
            })}
          >
            <span>Renamed</span>
            <strong>{formatWholeNumber(renamedCount)}</strong>
          </Link>
          <Link
            aria-current={
              mode === "events" && status === "moved" && mover === "all"
                ? "page"
                : undefined
            }
            className={
              mode === "events" && status === "moved" && mover === "all"
                ? styles.activeStatPill
                : styles.statPill
            }
            href={buildHistoryHref({
              mode: "events",
              mover: "all",
              query,
              sort,
              status: "moved",
            })}
          >
            <span>Moved</span>
            <strong>{formatWholeNumber(movedCount)}</strong>
          </Link>
          <Link
            aria-current={
              mode === "events" && status === "failed" && mover === "all"
                ? "page"
                : undefined
            }
            className={
              mode === "events" && status === "failed" && mover === "all"
                ? styles.activeStatPill
                : styles.statPill
            }
            href={buildHistoryHref({
              mode: "events",
              mover: "all",
              query,
              sort,
              status: "failed",
            })}
          >
            <span>Failed</span>
            <strong>{formatWholeNumber(failedCount)}</strong>
          </Link>
        </section>

        {hasCachedStorageAccess && mode === "events" && events.length ? (
          <HistoryEventsList events={events} />
        ) : null}

        {hasCachedStorageAccess && mode === "batches" && batchGroups.length ? (
          <section className={styles.historyList}>
            {batchGroups.map((group) => (
              <details className={styles.historyRow} key={group.batchId}>
                <summary className={styles.rowSummary}>
                  <div className={styles.rowLeft}>
                    <div className={styles.rowTitleWrap}>
                      <strong className={styles.rowTitle}>Batch {group.batchId}</strong>
                    </div>
                    <div className={styles.rowMeta}>
                      <span>{formatWholeNumber(group.events.length)} files</span>
                      <span>{formatWholeNumber(group.filedCount)} filed</span>
                      <span>{formatWholeNumber(group.failedCount)} failed</span>
                      <span>{group.clientLabel}</span>
                    </div>
                  </div>

                  <div className={styles.rowRight}>
                    <span className={styles.batchBadge}>Grouped batch</span>
                    <time className={styles.timestamp}>
                      {formatTimestamp(group.latestAt)}
                    </time>
                  </div>
                </summary>

                <div className={styles.rowDetails}>
                  <div className={styles.detailGrid}>
                    <div className={styles.detailCell}>
                      <span>Triggered by</span>
                      <strong>{group.triggeredBy}</strong>
                    </div>
                    <div className={styles.detailCell}>
                      <span>Moved by</span>
                      <strong>{group.movedBy}</strong>
                    </div>
                    <div className={styles.detailCell}>
                      <span>Date range</span>
                      <strong>
                        {formatTimestamp(group.earliestAt)} to{" "}
                        {formatTimestamp(group.latestAt)}
                      </strong>
                    </div>
                    <div className={styles.detailCell}>
                      <span>Folders touched</span>
                      <strong>{group.folderSummary}</strong>
                    </div>
                  </div>

                  <div className={styles.batchEventList}>
                    {group.events.map((event) => (
                      <div className={styles.batchEventRow} key={event.id}>
                        <div className={styles.batchEventFile}>
                          <FileKindIcon
                            className={styles.batchEventFileIcon}
                            mimeType={event.sourceMimeType}
                            name={getHistoryDisplayFilename(event)}
                          />
                          <strong>{getHistoryDisplayFilename(event)}</strong>
                        </div>
                        <span>{event.clientFolderName ?? "No client folder"}</span>
                        <span>{event.topLevelFolderName ?? "No top-level folder"}</span>
                        <span
                          className={
                            event.outcome === "succeeded"
                              ? styles.goodBadge
                              : styles.warnBadge
                          }
                        >
                          {event.outcome === "succeeded" ? "Filed" : "Failed"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </section>
        ) : null}

        {!hasCachedStorageAccess ? (
          <StorageStatusPanel
            className={styles.contentState}
            title={historyStatusTitle}
            message={historyStatusSummary}
          />
        ) : (mode === "events" && !events.length) ||
          (mode === "batches" && !batchGroups.length) ? (
          <section className={styles.emptyState}>
            <strong>
              {hasActiveFilters({ mover, query, sort, status })
                ? "No matching audit history"
                : "No filing history yet"}
            </strong>
            <p>
              {hasActiveFilters({ mover, query, sort, status })
                ? "Try a different search term or clear the filter."
                : "Filed items and errors will appear here once the system starts moving documents."}
            </p>
          </section>
        ) : null}
      </main>
    </ProductShell>
  );
}

function formatWholeNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function normalizeHistoryMode(value: string | null | undefined): HistoryMode {
  return value === "batches" ? "batches" : "events";
}

function hasActiveFilters({
  mover,
  query,
  sort,
  status,
}: {
  mover: HistoryMoverFilter;
  query: string;
  sort: HistorySortOption;
  status: HistoryStatusFilter;
}) {
  return Boolean(
    query || status !== "all" || mover !== "all" || sort !== "newest",
  );
}

function buildHistoryHref({
  mode,
  mover,
  query,
  sort,
  status,
}: {
  mode: HistoryMode;
  mover: HistoryMoverFilter;
  query: string;
  sort: HistorySortOption;
  status: HistoryStatusFilter;
}) {
  const params = new URLSearchParams();

  if (mode !== "events") {
    params.set("mode", mode);
  }

  if (query) {
    params.set("q", query);
  }

  if (status !== "all" && mode === "events") {
    params.set("status", status);
  }

  if (mover !== "all") {
    params.set("mover", mover);
  }

  if (sort !== "newest") {
    params.set("sort", sort);
  }

  const queryString = params.toString();
  return queryString ? `/history?${queryString}` : "/history";
}

function buildExportHref({
  mover,
  query,
  sort,
  status,
}: {
  mover: HistoryMoverFilter;
  query: string;
  sort: HistorySortOption;
  status: HistoryStatusFilter;
}) {
  const params = new URLSearchParams();

  if (query) {
    params.set("q", query);
  }

  if (status !== "all") {
    params.set("status", status);
  }

  if (mover !== "all") {
    params.set("mover", mover);
  }

  if (sort !== "newest") {
    params.set("sort", sort);
  }

  const queryString = params.toString();
  return queryString
    ? `/api/history/export?${queryString}`
    : "/api/history/export";
}

function groupBatchEvents(events: ReturnType<typeof filterHistoryEvents>) {
  const groups = new Map<
    string,
    {
      batchId: string;
      earliestAt: string;
      latestAt: string;
      events: typeof events;
      failedCount: number;
      filedCount: number;
      folderSummary: string;
      clientLabel: string;
      movedBy: string;
      triggeredBy: string;
    }
  >();

  for (const event of events) {
    const existing = groups.get(event.batchId);

    if (!existing) {
      groups.set(event.batchId, {
        batchId: event.batchId,
        earliestAt: event.createdAt,
        latestAt: event.createdAt,
        events: [event],
        failedCount: event.outcome === "failed" ? 1 : 0,
        filedCount: event.outcome === "succeeded" ? 1 : 0,
        folderSummary: "",
        clientLabel: "",
        movedBy: "",
        triggeredBy: "",
      });
      continue;
    }

    existing.events.push(event);
    if (event.createdAt < existing.earliestAt) {
      existing.earliestAt = event.createdAt;
    }
    if (event.createdAt > existing.latestAt) {
      existing.latestAt = event.createdAt;
    }
    if (event.outcome === "succeeded") {
      existing.filedCount += 1;
    } else {
      existing.failedCount += 1;
    }
  }

  return [...groups.values()].map((group) => {
    const clientFolders = uniqueNonEmpty(group.events.map((event) => event.clientFolderName));
    const topLevelFolders = uniqueNonEmpty(
      group.events.map((event) => event.topLevelFolderName),
    );
    const movers = uniqueNonEmpty(group.events.map((event) => displayHistoryActor(event)));
    const triggers = uniqueNonEmpty(group.events.map((event) => event.initiatedByEmail));

    return {
      ...group,
      events: [...group.events].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
      clientLabel:
        clientFolders.length === 1
          ? clientFolders[0]
          : clientFolders.length > 1
            ? `${clientFolders.length} client folders`
            : "No client folder",
      folderSummary:
        topLevelFolders.length === 1
          ? topLevelFolders[0]
          : topLevelFolders.length > 1
            ? `${topLevelFolders.length} top-level folders`
            : "No folder",
      movedBy: movers.join(", ") || "Unknown",
      triggeredBy: triggers.join(", ") || "Unknown",
    };
  });
}

function sortBatchGroups(
  groups: ReturnType<typeof groupBatchEvents>,
  sort: HistorySortOption,
) {
  return [...groups].sort((left, right) => {
    if (sort === "oldest") {
      return left.latestAt.localeCompare(right.latestAt);
    }

    if (sort === "filename_az") {
      return left.batchId.localeCompare(right.batchId);
    }

    if (sort === "client_az") {
      return left.clientLabel.localeCompare(right.clientLabel);
    }

    return right.latestAt.localeCompare(left.latestAt);
  });
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
