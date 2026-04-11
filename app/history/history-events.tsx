"use client";

import { useEffect, useState } from "react";
import { FileKindIcon } from "@/components/file-kind-icon";
import type { FilingEvent } from "@/lib/db";
import { normalizeDriveDisplayPath } from "@/lib/google-drive";
import {
  buildDestinationPath,
  classifierSourceLabel,
  displayHistoryActor,
  getHistoryActionBadges,
  getHistoryActionLabel,
  getHistoryDisplayFilename,
  parseClassifierReasons,
} from "@/lib/history-view";
import styles from "./page.module.css";

type HistoryEventsListProps = {
  events: FilingEvent[];
};

export function HistoryEventsList({ events }: HistoryEventsListProps) {
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const activeEvent =
    activeEventId === null
      ? null
      : events.find((event) => event.id === activeEventId) ?? null;

  return (
    <>
      <section className={styles.historyList}>
        {events.map((event) => {
          const finalName = getHistoryDisplayFilename(event);
          const actor = displayHistoryActor(event);
          const actionBadges = getHistoryActionBadges(event);

          return (
            <article className={styles.historyRow} key={event.id}>
              <button
                className={styles.rowButton}
                onClick={() => setActiveEventId(event.id)}
                type="button"
              >
                <div className={styles.eventRowSummary}>
                  <div className={styles.rowTitleWrap}>
                    <FileKindIcon
                      className={styles.fileKindIcon}
                      mimeType={event.sourceMimeType}
                      name={finalName}
                    />
                    <span className={styles.rowTitle}>{finalName}</span>
                  </div>

                  <div className={styles.rowActionBadges}>
                    {actionBadges.map((badge) => (
                      <span className={styles.rowActionBadge} key={badge}>
                        {badge}
                      </span>
                    ))}
                  </div>

                  <span className={styles.eventActor}>By {actor}</span>

                  <time className={styles.eventTimestamp}>
                    {formatHistoryTimestamp(event.createdAt)}
                  </time>
                </div>
              </button>
            </article>
          );
        })}
      </section>

      {activeEvent ? (
        <HistoryEventModal
          event={activeEvent}
          onClose={() => setActiveEventId(null)}
        />
      ) : null}
    </>
  );
}

function HistoryEventModal({
  event,
  onClose,
}: {
  event: FilingEvent;
  onClose: () => void;
}) {
  const [resolvedPaths, setResolvedPaths] = useState({
    destinationPath: normalizeDriveDisplayPath(event.destinationPath),
    originalPath: normalizeDriveDisplayPath(event.originalPath),
  });

  useEffect(() => {
    function handleKeyDown(event_: KeyboardEvent) {
      if (event_.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    async function loadPaths() {
      try {
        const response = await fetch(`/api/history/paths/${event.id}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          destinationPath?: string | null;
          originalPath?: string | null;
        };

        if (!cancelled) {
          setResolvedPaths({
            destinationPath: normalizeDriveDisplayPath(
              data.destinationPath ?? event.destinationPath,
            ),
            originalPath: normalizeDriveDisplayPath(
              data.originalPath ?? event.originalPath,
            ),
          });
        }
      } catch {
        // Keep inline fallback values if path resolution fails.
      }
    }

    void loadPaths();

    return () => {
      cancelled = true;
    };
  }, [event.destinationPath, event.id, event.originalPath]);

  const actor = displayHistoryActor(event);
  const finalName = getHistoryDisplayFilename(event);
  const actionLabel = getHistoryActionLabel(event);
  const classifierLabel = classifierSourceLabel(event.classifierContentSource);
  const reasonList = parseClassifierReasons(event.classifierReasons);
  const auditIdentifierRows = [
    ["Storage", event.storageProvider],
    ["File ID", event.fileId],
    ["Review decision", event.reviewDecisionId],
    ["MIME type", event.sourceMimeType],
    ["Drive modified", event.sourceModifiedTime],
    ["Drive size", formatByteCount(event.sourceDriveSize)],
    ["Downloaded bytes", formatByteCount(event.downloadByteLength)],
    ["Downloaded SHA1", event.downloadSha1],
    ["Parser version", event.parserVersion],
    ["Parser conflict", event.parserConflictSummary],
  ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;

  return (
    <div className={styles.historyModalOverlay} onClick={onClose} role="presentation">
      <div
        aria-modal="true"
        className={styles.historyModal}
        onClick={(event_) => event_.stopPropagation()}
        role="dialog"
      >
        <div className={styles.historyModalHeader}>
          <div>
            <p className={styles.panelLabel}>Audit item</p>
            <div className={styles.modalTitleRow}>
              <FileKindIcon
                className={styles.modalFileKindIcon}
                mimeType={event.sourceMimeType}
                name={finalName}
              />
              <div>
                <h2>{actionLabel}</h2>
                <p className={styles.modalSubtitle}>{finalName}</p>
              </div>
            </div>
          </div>
          <button
            className={styles.modalCloseButton}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <div className={styles.historyModalGrid}>
          <div className={styles.historyModalSideColumn}>
            <section className={styles.historyModalSection}>
              <div className={styles.historyModalSectionHeader}>
                <p className={styles.panelLabel}>File plan</p>
              </div>

              <div className={styles.planStack}>
                <div className={styles.planSection}>
                  <p className={styles.planSectionLabel}>Name</p>
                  <div className={styles.planRows}>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Original</span>
                      <div className={styles.planRowValue}>{event.sourceName}</div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Final</span>
                      <div className={styles.planRowValue}>{finalName}</div>
                    </div>
                  </div>
                </div>

                <div className={styles.planSection}>
                  <p className={styles.planSectionLabel}>Location</p>
                  <div className={styles.planRows}>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Original</span>
                      <div className={styles.planRowValue}>
                        {resolvedPaths.originalPath || "Not available"}
                      </div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Destination</span>
                      <div className={styles.planRowValue}>
                        {resolvedPaths.destinationPath ||
                          buildDestinationPath(event) ||
                          "Not available"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.planSection}>
                  <p className={styles.planSectionLabel}>Audit</p>
                  <div className={styles.planRows}>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Action</span>
                      <div className={styles.planRowValue}>{actionLabel}</div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Status</span>
                      <div className={styles.planRowValue}>
                        {event.outcome === "succeeded" ? "Completed" : "Failed"}
                      </div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Moved by</span>
                      <div className={styles.planRowValue}>{actor}</div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Triggered by</span>
                      <div className={styles.planRowValue}>
                        {event.initiatedByEmail ?? actor}
                      </div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Batch</span>
                      <div className={styles.planRowValue}>{event.batchId}</div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Event time</span>
                      <div className={styles.planRowValue}>
                        {formatHistoryTimestamp(event.createdAt)}
                      </div>
                    </div>
                    {event.sourceModifiedTime ? (
                      <div className={styles.planRow}>
                        <span className={styles.planRowLabel}>Source modified</span>
                        <div className={styles.planRowValue}>
                          {formatHistoryTimestamp(event.sourceModifiedTime)}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {event.detectedDocumentType ||
                event.detectedClient ||
                classifierLabel ||
                event.classifierConfidence !== null ||
                reasonList.length ||
                event.classifierExcerpt ? (
                  <div className={styles.planSection}>
                    <p className={styles.planSectionLabel}>Classifier evidence</p>
                    <div className={styles.planRows}>
                      {classifierLabel ? (
                        <div className={styles.planRow}>
                          <span className={styles.planRowLabel}>Source</span>
                          <div className={styles.planRowValue}>{classifierLabel}</div>
                        </div>
                      ) : null}
                      {event.detectedDocumentType ? (
                        <div className={styles.planRow}>
                          <span className={styles.planRowLabel}>Type</span>
                          <div className={styles.planRowValue}>
                            {event.detectedDocumentType}
                          </div>
                        </div>
                      ) : null}
                      {event.detectedClient ? (
                        <div className={styles.planRow}>
                          <span className={styles.planRowLabel}>Client</span>
                          <div className={styles.planRowValue}>{event.detectedClient}</div>
                        </div>
                      ) : null}
                      {event.classifierConfidence !== null ? (
                        <div className={styles.planRow}>
                          <span className={styles.planRowLabel}>Confidence</span>
                          <div className={styles.planRowValue}>
                            {Math.round(event.classifierConfidence * 100)}%
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {reasonList.length ? (
                      <ul className={styles.reasonList}>
                        {reasonList.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}

                    {event.classifierExcerpt ? (
                      <p className={styles.excerptBox}>{event.classifierExcerpt}</p>
                    ) : null}
                  </div>
                ) : null}

                {event.errorMessage ? (
                  <div className={styles.planSection}>
                    <p className={styles.planSectionLabel}>Error</p>
                    <p className={styles.errorBox}>{event.errorMessage}</p>
                  </div>
                ) : null}

                {auditIdentifierRows.length ? (
                  <details className={styles.advancedDetails}>
                    <summary className={styles.advancedSummary}>Advanced</summary>
                    <div className={styles.planSection}>
                      <p className={styles.planSectionLabel}>Audit identifiers</p>
                      <div className={styles.planRows}>
                        {auditIdentifierRows.map(([label, value]) => (
                          <div className={styles.planRow} key={label}>
                            <span className={styles.planRowLabel}>{label}</span>
                            <div className={styles.planRowValue}>{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                ) : null}
              </div>
            </section>
          </div>

          <section className={styles.historyPreviewPanel}>
            <div className={styles.documentPreviewPane}>
              <iframe
                className={styles.documentPreviewFrame}
                src={`/api/drive/files/${event.fileId}`}
                title={finalName}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function formatHistoryTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatByteCount(value: number | string | null) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(typeof value === "string" ? value : "", 10);

  if (!Number.isFinite(parsed)) {
    return typeof value === "string" ? value : String(value);
  }

  return `${new Intl.NumberFormat("en-US").format(parsed)} bytes`;
}
