"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { saveReviewDecisionAction } from "@/app/review/actions";
import { FileKindIcon } from "@/components/file-kind-icon";
import type { FilingEvent, ReviewDecision } from "@/lib/db";
import { getCleanupTopLevelFolderForDocumentType } from "@/lib/cleanup-presets";
import {
  buildDocumentFilenamePlan,
  getClientDisplayName,
  getDocumentTypeIdFromLabel,
  getNamingDocumentTypeOptions,
  type NamingRuleDocumentType,
  type NamingRulesConfig,
  type NamingTokenId,
} from "@/lib/naming-rules";
import type { PreviewItem } from "@/lib/processing-preview";
import styles from "./page.module.css";

type IntakeQueueProps = {
  activeTab: "all" | "review" | "ready" | "filed";
  reviewItems: PreviewItem[];
  readyItems: PreviewItem[];
  filedItems: FilingEvent[];
  hasVerifiedStorage: boolean;
  savedDecisions: ReviewDecision[];
  folderTemplate: string[];
  namingRules: NamingRulesConfig;
  existingClientFolders: string[];
  storageUnavailableMessage: string;
  sourceFolderName: string | null;
};

type ActiveModal =
  | { kind: "preview"; itemId: string }
  | { kind: "filed"; eventId: string }
  | null;

export function IntakeQueue({
  activeTab,
  reviewItems,
  readyItems,
  filedItems,
  hasVerifiedStorage,
  savedDecisions,
  folderTemplate,
  namingRules,
  existingClientFolders,
  storageUnavailableMessage,
  sourceFolderName,
}: IntakeQueueProps) {
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const savedDecisionMap = useMemo(
    () => new Map(savedDecisions.map((decision) => [decision.fileId, decision])),
    [savedDecisions],
  );
  const previewItems = useMemo(
    () => [...reviewItems, ...readyItems],
    [readyItems, reviewItems],
  );
  const previewItemMap = useMemo(
    () => new Map(previewItems.map((item) => [item.id, item])),
    [previewItems],
  );
  const filedItemMap = useMemo(
    () => new Map(filedItems.map((event) => [event.id, event])),
    [filedItems],
  );
  const activePreviewItem =
    activeModal?.kind === "preview"
      ? previewItemMap.get(activeModal.itemId) ?? null
      : null;
  const activeSavedDecision = activePreviewItem
    ? savedDecisionMap.get(activePreviewItem.id)
    : undefined;
  const activeFiledItem =
    activeModal?.kind === "filed"
      ? filedItemMap.get(activeModal.eventId) ?? null
      : null;

  let rows: ReactNode;

  if (!hasVerifiedStorage) {
    rows = (
      <article className={styles.noteCard}>
        <strong>{storageUnavailableMessage}</strong>
        <p>No intake or filing details are shown until storage access is restored.</p>
      </article>
    );
  } else if (activeTab === "review") {
    rows = reviewItems.length ? (
      reviewItems.map((item) =>
        renderPreviewRow(item, savedDecisionMap.get(item.id), setActiveModal),
      )
    ) : (
      <article className={styles.noteCard}>
        <strong>No review items right now</strong>
        <p>No files need manual changes.</p>
      </article>
    );
  } else if (activeTab === "ready") {
    rows = readyItems.length ? (
      readyItems.map((item) =>
        renderPreviewRow(item, savedDecisionMap.get(item.id), setActiveModal),
      )
    ) : (
      <article className={styles.noteCard}>
        <strong>No ready-to-file items right now</strong>
        <p>No high-confidence files are waiting.</p>
      </article>
    );
  } else if (activeTab === "filed") {
    rows = filedItems.length ? (
      filedItems.map((event) => renderFiledRow(event, setActiveModal))
    ) : (
      <article className={styles.noteCard}>
        <strong>No filed items yet</strong>
        <p>Completed moves will appear here.</p>
      </article>
    );
  } else {
    const allRows = [
      ...reviewItems.map((item) =>
        renderPreviewRow(item, savedDecisionMap.get(item.id), setActiveModal),
      ),
      ...readyItems.map((item) =>
        renderPreviewRow(item, savedDecisionMap.get(item.id), setActiveModal),
      ),
    ];

    rows = allRows.length ? (
      allRows
    ) : (
      <article className={styles.noteCard}>
        <strong>No unfiled items right now</strong>
        <p>The intake queue is clear.</p>
      </article>
    );
  }

  return (
    <>
      <section className={styles.queueList}>{rows}</section>

      {activePreviewItem ? (
        <PreviewItemModal
          key={activePreviewItem.id}
          existingClientFolders={existingClientFolders}
          folderTemplate={folderTemplate}
          item={activePreviewItem}
          namingRules={namingRules}
          savedDecision={activeSavedDecision}
          sourceFolderName={sourceFolderName}
          onClose={() => setActiveModal(null)}
        />
      ) : null}

      {activeFiledItem ? (
        <FiledItemModal
          event={activeFiledItem}
          onClose={() => setActiveModal(null)}
          sourceFolderName={sourceFolderName}
        />
      ) : null}
    </>
  );
}

function renderPreviewRow(
  item: PreviewItem,
  savedDecision: ReviewDecision | undefined,
  setActiveModal: (value: ActiveModal) => void,
) {
  const displayedClientFolder =
    savedDecision?.reviewedClientFolder ??
    item.resolvedHouseholdFolder ??
    item.suggestedHouseholdFolder;
  const displayedTopLevelFolder =
    savedDecision?.reviewedTopLevelFolder ?? item.proposedTopLevelFolder;
  const displayedFilename = savedDecision?.reviewedFilename ?? item.proposedFilename;
  const isSuggestedNewClient =
    typeof displayedClientFolder === "string" &&
    displayedClientFolder.length > 0 &&
    !savedDecision?.reviewedClientFolder &&
    item.clientResolutionStatus === "created_new";
  const rowStatusLabel =
    savedDecision?.status === "approved"
      ? "Approved"
      : savedDecision
        ? "Draft saved"
        : item.status;

  return (
    <article key={item.id} className={styles.queueRow}>
      <button
        className={styles.rowButton}
        onClick={() => setActiveModal({ kind: "preview", itemId: item.id })}
        type="button"
      >
        <div className={styles.rowIdentity}>
          <p className={styles.cardEyebrow}>{item.detectedDocumentType}</p>
          <div className={styles.fileTitleRow}>
            <FileKindIcon
              className={styles.fileKindIcon}
              mimeType={item.mimeType}
              name={item.sourceName}
            />
            <h3 className={styles.fileName}>{item.sourceName}</h3>
          </div>
          <div className={styles.inlineFacts}>
            <span>
              <strong>Household</strong>
              {displayedClientFolder ?? "Needs review"}
            </span>
            <span>
              <strong>Folder</strong>
              {displayedTopLevelFolder}
            </span>
            <span>
              <strong>Filename</strong>
              <code>{displayedFilename}</code>
            </span>
            {isSuggestedNewClient ? (
              <span className={styles.newClientFlag}>Possible new household</span>
            ) : null}
          </div>
        </div>

        <div className={styles.rowStatusCluster}>
          <span className={styles.sourceTag}>
            {labelForContentSource(item.contentSource)}
          </span>
          <span
            className={
              savedDecision?.status === "approved" || item.status === "Ready to stage"
                ? styles.goodBadge
                : styles.warnBadge
            }
          >
            {rowStatusLabel}
          </span>
        </div>
      </button>
    </article>
  );
}

function renderFiledRow(
  event: FilingEvent,
  setActiveModal: (value: ActiveModal) => void,
) {
  return (
    <article key={event.id} className={styles.queueRow}>
      <button
        className={styles.rowButton}
        onClick={() => setActiveModal({ kind: "filed", eventId: event.id })}
        type="button"
      >
        <div className={styles.rowIdentity}>
          <p className={styles.cardEyebrow}>Filed item</p>
          <div className={styles.fileTitleRow}>
            <FileKindIcon
              className={styles.fileKindIcon}
              mimeType={event.sourceMimeType}
              name={event.finalFilename || event.sourceName}
            />
            <h3 className={styles.fileName}>{event.finalFilename || event.sourceName}</h3>
          </div>
          <div className={styles.inlineFacts}>
            <span>
              <strong>Moved by</strong>
              {displayFiledActor(event)}
            </span>
            <span>
              <strong>Household</strong>
              {event.clientFolderName ?? "Unknown"}
            </span>
            <span>
              <strong>Folder</strong>
              {event.topLevelFolderName ?? "Unknown"}
            </span>
          </div>
        </div>

        <div className={styles.rowStatusCluster}>
          <span className={styles.sourceTag}>
            Filed on {formatFilingTimestamp(event.createdAt)}
          </span>
          <span className={styles.goodBadge}>Filed</span>
        </div>
      </button>
    </article>
  );
}

type EditableTokenFieldKey =
  | "accountType"
  | "accountLast4"
  | "custodian"
  | "taxYear"
  | "documentDate"
  | "idType"
  | "entityName";

type EditableNamingTokenId = Exclude<
  NamingTokenId,
  | "last_name"
  | "first_name"
  | "client2_last_name"
  | "client2_first_name"
  | "document_type"
>;

type PreviewPlanState = {
  householdFolder: string;
  clientName: string;
  clientName2: string;
  ownershipType: "single" | "joint";
  documentType: string;
  topLevelFolder: string;
  proposedFilename: string;
  accountType: string;
  accountLast4: string;
  custodian: string;
  taxYear: string;
  documentDate: string;
  idType: string;
  entityName: string;
};

const editableTokenFieldOrder: EditableNamingTokenId[] = [
  "account_type",
  "account_last4",
  "custodian",
  "tax_year",
  "document_date",
  "id_type",
  "entity_name",
];

const editableTokenFieldMap: Record<
  EditableNamingTokenId,
  { key: EditableTokenFieldKey; label: string }
> = {
  account_type: {
    key: "accountType",
    label: "Account type",
  },
  account_last4: {
    key: "accountLast4",
    label: "Account last 4",
  },
  custodian: {
    key: "custodian",
    label: "Custodian",
  },
  tax_year: {
    key: "taxYear",
    label: "Tax year",
  },
  document_date: {
    key: "documentDate",
    label: "Document date",
  },
  id_type: {
    key: "idType",
    label: "ID type",
  },
  entity_name: {
    key: "entityName",
    label: "Entity name",
  },
};

function getVisibleTokenFields(
  rules: NamingRulesConfig,
  documentTypeId: NamingRuleDocumentType,
) {
  const activeTokens = rules.rules[documentTypeId] ?? rules.rules.default;
  return editableTokenFieldOrder
    .filter((tokenId) => activeTokens.includes(tokenId))
    .map((tokenId) => ({
      id: tokenId,
      ...editableTokenFieldMap[tokenId],
    }));
}

function getDocumentTypeOptions(currentLabel: string) {
  const options = getNamingDocumentTypeOptions().map((option) => option.label);
  if (currentLabel && !options.includes(currentLabel)) {
    return [currentLabel, ...options];
  }

  return options;
}

function resolveTopLevelFolderForDocumentType(
  documentType: string,
  folderTemplate: string[],
  fallbackFolder: string,
) {
  const suggested = getCleanupTopLevelFolderForDocumentType(documentType);
  const match = folderTemplate.find(
    (folder) => folder.toLowerCase() === suggested.toLowerCase(),
  );
  return match ?? fallbackFolder;
}

function buildPreviewFilename(
  plan: PreviewPlanState,
  item: PreviewItem,
  rules: NamingRulesConfig,
) {
  return buildDocumentFilenamePlan({
    accountLast4: plan.accountLast4 || null,
    accountType: plan.accountType || null,
    clientName: plan.clientName.trim() || null,
    clientName2: plan.clientName2.trim() || null,
    custodian: plan.custodian || null,
    detectedClient: item.detectedClient,
    detectedClient2: item.detectedClient2,
    documentDate: plan.documentDate || null,
    documentTypeLabel: plan.documentType,
    entityName: plan.entityName || null,
    extension: detectExtension(item.sourceName),
    fallbackName: item.proposedFilename,
    householdFolder: plan.householdFolder.trim() || null,
    idType: plan.idType || null,
    ownershipType: plan.ownershipType,
    rules,
    sourceName: item.sourceName,
    taxYear: plan.taxYear || null,
  });
}

function PreviewItemModal({
  item,
  savedDecision,
  folderTemplate,
  namingRules,
  existingClientFolders,
  sourceFolderName,
  onClose,
}: {
  item: PreviewItem;
  savedDecision?: ReviewDecision;
  folderTemplate: string[];
  namingRules: NamingRulesConfig;
  existingClientFolders: string[];
  sourceFolderName: string | null;
  onClose: () => void;
}) {
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [plan, setPlan] = useState<PreviewPlanState>(() => ({
    accountLast4: item.extractedAccountLast4 ?? "",
    accountType: item.extractedAccountType ?? "",
    clientName:
      savedDecision?.reviewedClientName ??
      (getClientDisplayName({
        detectedClient: item.detectedClient,
        clientFolder:
          savedDecision?.reviewedClientFolder ??
          item.resolvedHouseholdFolder ??
          item.suggestedHouseholdFolder ??
          "",
      }) ||
        ""),
    clientName2: savedDecision?.reviewedClientName2 ?? item.detectedClient2 ?? "",
    householdFolder:
      savedDecision?.reviewedClientFolder ??
      item.resolvedHouseholdFolder ??
      item.suggestedHouseholdFolder ??
      "",
    custodian: item.extractedCustodian ?? "",
    documentDate: item.extractedDocumentDate ?? "",
    documentType: savedDecision?.detectedDocumentType ?? item.detectedDocumentType,
    entityName: item.extractedEntityName ?? "",
    idType: item.extractedIdType ?? "",
    ownershipType: savedDecision?.reviewedOwnershipType ?? item.ownershipType,
    proposedFilename: savedDecision?.reviewedFilename ?? item.proposedFilename,
    taxYear: item.extractedTaxYear ?? "",
    topLevelFolder:
      savedDecision?.reviewedTopLevelFolder ?? item.proposedTopLevelFolder,
  }));
  const suggestionListId = useMemo(
    () => `intake-client-folders-${item.id.replace(/[^A-Za-z0-9_-]/g, "")}`,
    [item.id],
  );
  const documentTypeOptions = useMemo(
    () => getDocumentTypeOptions(plan.documentType),
    [plan.documentType],
  );
  const activeDocumentTypeId = getDocumentTypeIdFromLabel(plan.documentType);
  const visibleTokenFields = useMemo(
    () => getVisibleTokenFields(namingRules, activeDocumentTypeId),
    [activeDocumentTypeId, namingRules],
  );
  const normalizedHouseholdFolder = plan.householdFolder.trim();
  const looksLikeNewClient =
    Boolean(normalizedHouseholdFolder) &&
    !existingClientFolders.includes(normalizedHouseholdFolder);
  const proposedLocation = normalizedHouseholdFolder
    ? `${normalizedHouseholdFolder} / ${plan.topLevelFolder}`
    : `Needs review / ${plan.topLevelFolder}`;
  const canEdit = item.status === "Needs review" || Boolean(savedDecision);
  const currentLocation = sourceFolderName ?? "Intake folder";

  useEffect(() => {
    Object.values(textareaRefs.current).forEach((textarea) => {
      if (!textarea) {
        return;
      }

      textarea.style.height = "0px";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
  }, [plan.proposedFilename]);

  function updateDerivedPlan(
    patch: Partial<PreviewPlanState>,
    options?: {
      deriveFilename?: boolean;
      deriveFolder?: boolean;
    },
  ) {
    setPlan((current) => {
      const next = { ...current, ...patch };

      if (options?.deriveFolder) {
        next.topLevelFolder = resolveTopLevelFolderForDocumentType(
          next.documentType,
          folderTemplate,
          current.topLevelFolder,
        );
      }

      if (options?.deriveFilename) {
        next.proposedFilename = buildPreviewFilename(next, item, namingRules);
      }

      return next;
    });
  }

  return (
    <div className={styles.intakeModalOverlay} onClick={onClose} role="presentation">
      <div
        aria-modal="true"
        className={styles.intakeModal}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className={styles.intakeModalHeader}>
          <div>
            <p className={styles.panelLabel}>
              {savedDecision?.status === "approved"
                ? "Approved item"
                : savedDecision
                  ? "Draft item"
                  : item.status}
            </p>
            <div className={styles.modalTitleRow}>
              <FileKindIcon
                className={styles.modalFileKindIcon}
                mimeType={item.mimeType}
                name={item.sourceName}
              />
              <h2>{plan.proposedFilename}</h2>
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

        <div className={styles.intakeModalGrid}>
          <div className={styles.modalSideColumn}>
            <section className={styles.modalSection}>
              <div className={styles.modalSectionHeader}>
                <p className={styles.panelLabel}>File plan</p>
              </div>

              <form action={saveReviewDecisionAction} className={styles.intakeModalForm}>
                <input name="fileId" type="hidden" value={item.id} />
                <input name="sourceName" type="hidden" value={item.sourceName} />
                <input name="mimeType" type="hidden" value={item.mimeType} />
                <input
                  name="modifiedTime"
                  type="hidden"
                  value={item.modifiedTime ?? ""}
                />
                <input
                  name="detectedClient"
                  type="hidden"
                  value={item.detectedClient ?? ""}
                />
                <input
                  name="detectedClient2"
                  type="hidden"
                  value={item.detectedClient2 ?? ""}
                />
                <input
                  name="originalClientName"
                  type="hidden"
                  value={item.detectedClient ?? ""}
                />
                <input
                  name="originalClientName2"
                  type="hidden"
                  value={item.detectedClient2 ?? ""}
                />
                <input
                  name="originalOwnershipType"
                  type="hidden"
                  value={item.ownershipType}
                />
                <input
                  name="detectedDocumentType"
                  type="hidden"
                  value={plan.documentType}
                />
                <input
                  name="originalClientFolder"
                  type="hidden"
                  value={
                    (item.resolvedHouseholdFolder ?? item.suggestedHouseholdFolder) || ""
                  }
                />
                <input
                  name="originalTopLevelFolder"
                  type="hidden"
                  value={item.proposedTopLevelFolder}
                />
                <input
                  name="originalFilename"
                  type="hidden"
                  value={item.proposedFilename}
                />

                <div className={styles.editFieldsStack}>
                  <div className={styles.planSection}>
                    <p className={styles.planSectionLabel}>Classification</p>
                    <div className={styles.planRows}>
                      <label className={styles.planRow}>
                        <span className={styles.planRowLabel}>Household</span>
                        <div className={styles.planRowControl}>
                          <input
                            className={styles.planRowInput}
                            disabled={!canEdit}
                            list={suggestionListId}
                            name="reviewedClientFolder"
                            onChange={(event) =>
                              updateDerivedPlan(
                                { householdFolder: event.target.value },
                              )
                            }
                            type="text"
                            value={plan.householdFolder}
                          />
                          <datalist id={suggestionListId}>
                            {existingClientFolders.map((folder) => (
                              <option key={folder} value={folder} />
                            ))}
                          </datalist>
                        </div>
                      </label>

                      <label className={styles.planRow}>
                        <span className={styles.planRowLabel}>Client</span>
                        <div className={styles.planRowControl}>
                          <input
                            className={styles.planRowInput}
                            disabled={!canEdit}
                            name="reviewedClientName"
                            onChange={(event) =>
                              updateDerivedPlan(
                                { clientName: event.target.value },
                                { deriveFilename: true },
                              )
                            }
                            type="text"
                            value={plan.clientName}
                          />
                        </div>
                      </label>

                      <label className={styles.planRow}>
                        <span className={styles.planRowLabel}>Client 2</span>
                        <div className={styles.planRowControl}>
                          <input
                            className={styles.planRowInput}
                            disabled={!canEdit}
                            name="reviewedClientName2"
                            onChange={(event) =>
                              updateDerivedPlan(
                                { clientName2: event.target.value },
                                { deriveFilename: true },
                              )
                            }
                            type="text"
                            value={plan.clientName2}
                          />
                        </div>
                      </label>

                      <label className={styles.planRow}>
                        <span className={styles.planRowLabel}>Ownership</span>
                        <div className={styles.planRowControl}>
                          <select
                            className={styles.planRowSelect}
                            disabled={!canEdit}
                            name="reviewedOwnershipType"
                            onChange={(event) =>
                              updateDerivedPlan(
                                {
                                  ownershipType: event.target.value as "single" | "joint",
                                },
                                { deriveFilename: true },
                              )
                            }
                            value={plan.ownershipType}
                          >
                            <option value="single">Single</option>
                            <option value="joint">Joint</option>
                          </select>
                        </div>
                      </label>

                      <label className={styles.planRow}>
                        <span className={styles.planRowLabel}>Document type</span>
                        <div className={styles.planRowControl}>
                          <select
                            className={styles.planRowSelect}
                            disabled={!canEdit}
                            onChange={(event) =>
                              updateDerivedPlan(
                                { documentType: event.target.value },
                                { deriveFilename: true, deriveFolder: true },
                              )
                            }
                            value={plan.documentType}
                          >
                            {documentTypeOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </div>
                      </label>

                      <label className={styles.planRow}>
                        <span className={styles.planRowLabel}>Top-level folder</span>
                        <div className={styles.planRowControl}>
                          <select
                            className={styles.planRowSelect}
                            disabled={!canEdit}
                            name="reviewedTopLevelFolder"
                            onChange={(event) =>
                              updateDerivedPlan({ topLevelFolder: event.target.value })
                            }
                            value={plan.topLevelFolder}
                          >
                            {folderTemplate.map((folder) => (
                              <option key={folder} value={folder}>
                                {folder}
                              </option>
                            ))}
                          </select>
                        </div>
                      </label>
                    </div>
                    {looksLikeNewClient ? (
                      <p className={styles.inlineWarning}>
                        Filing this will create a new household folder.
                      </p>
                    ) : null}
                  </div>

                  {visibleTokenFields.length ? (
                    <div className={styles.planSection}>
                      <p className={styles.planSectionLabel}>Naming fields</p>
                      <div className={styles.planRows}>
                        {visibleTokenFields.map((field) => (
                          <label key={field.id} className={styles.planRow}>
                            <span className={styles.planRowLabel}>{field.label}</span>
                            <div className={styles.planRowControl}>
                              <input
                                className={styles.planRowInput}
                                disabled={!canEdit}
                                onChange={(event) =>
                                  updateDerivedPlan(
                                    { [field.key]: event.target.value } as Partial<PreviewPlanState>,
                                    { deriveFilename: true },
                                  )
                                }
                                type="text"
                                value={plan[field.key]}
                              />
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className={styles.planSection}>
                    <p className={styles.planSectionLabel}>Name</p>
                    <div className={styles.planRows}>
                      <div className={styles.planRow}>
                        <span className={styles.planRowLabel}>Current</span>
                        <div className={styles.planRowValue}>{item.sourceName}</div>
                      </div>
                      <label className={styles.planRow}>
                        <span className={styles.planRowLabel}>Proposed</span>
                        <div className={styles.planRowControl}>
                          <textarea
                            className={styles.planRowTextarea}
                            disabled={!canEdit}
                            name="reviewedFilename"
                            onChange={(event) =>
                              updateDerivedPlan({ proposedFilename: event.target.value })
                            }
                            ref={(node) => {
                              textareaRefs.current.filename = node;
                            }}
                            rows={1}
                            value={plan.proposedFilename}
                          />
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className={styles.planSection}>
                    <p className={styles.planSectionLabel}>Location</p>
                    <div className={styles.planRows}>
                      <div className={styles.planRow}>
                        <span className={styles.planRowLabel}>Current</span>
                        <div className={styles.planRowValue}>{currentLocation}</div>
                      </div>
                      <div className={styles.planRow}>
                        <span className={styles.planRowLabel}>Proposed</span>
                        <div className={styles.planRowValue}>{proposedLocation}</div>
                      </div>
                    </div>
                  </div>

                  <details className={styles.diagnosticDetails}>
                    <summary className={styles.diagnosticSummary}>Diagnostics</summary>
                    <div className={styles.planSection}>
                      <div className={styles.planRows}>
                        <div className={styles.planRow}>
                          <span className={styles.planRowLabel}>Source</span>
                          <div className={styles.planRowValue}>
                            {labelForContentSource(item.contentSource)}
                          </div>
                        </div>
                        {getDiagnosticFieldEntries({
                          accountLast4: plan.accountLast4,
                          accountType: plan.accountType,
                          client: item.detectedClient,
                          client2: item.detectedClient2,
                          custodian: plan.custodian,
                          downloadByteLength: item.downloadByteLength,
                          downloadSha1: item.downloadSha1,
                          driveModifiedTime: item.modifiedTime,
                          driveSize: item.driveSize,
                          documentDate: plan.documentDate,
                          entityName: plan.entityName,
                          fileId: item.id,
                          idType: plan.idType,
                          ownershipType: plan.ownershipType,
                          parserConflictSummary: item.parserConflictSummary,
                          taxYear: plan.taxYear,
                        }).map((entry) => (
                          <div key={entry.label} className={styles.planRow}>
                            <span className={styles.planRowLabel}>{entry.label}</span>
                            <div className={styles.planRowValue}>{entry.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {item.pdfFields.length ? (
                      <div className={styles.planSection}>
                        <p className={styles.planSectionLabel}>PDF fields</p>
                        <div className={styles.planRows}>
                          {item.pdfFields.map((field, index) => (
                            <div key={`${field.name}-${index}`} className={styles.planRow}>
                              <span className={styles.planRowLabel}>{field.name}</span>
                              <div className={styles.planRowValue}>{field.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className={styles.diagnosticTextBlock}>
                      <span className={styles.planRowLabel}>Extracted text</span>
                      <pre className={styles.diagnosticText}>
                        {item.diagnosticText || item.textExcerpt || "No extracted text available."}
                      </pre>
                    </div>
                  </details>
                </div>

                {canEdit ? (
                  <div className={styles.previewActionsDock}>
                    <button
                      className={styles.secondaryAction}
                      name="decisionStatus"
                      type="submit"
                      value="draft"
                    >
                      Save draft
                    </button>
                    <button
                      className={styles.primaryAction}
                      name="decisionStatus"
                      type="submit"
                      value="approved"
                    >
                      Approve for staging
                    </button>
                  </div>
                ) : null}
              </form>
            </section>
          </div>

          <section className={styles.previewPanel}>
            <div className={styles.documentPreviewPane}>
              <iframe
                className={styles.documentPreviewFrame}
                src={
                  item.previewSnapshotId
                    ? `/api/preview/files/${item.previewSnapshotId}?rev=${encodeURIComponent(
                        item.downloadSha1 ?? item.modifiedTime ?? item.previewSnapshotId,
                      )}`
                    : `/api/drive/files/${item.id}?rev=${encodeURIComponent(
                        item.downloadSha1 ?? item.modifiedTime ?? item.id,
                      )}`
                }
                title={item.sourceName}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function FiledItemModal({
  event,
  sourceFolderName,
  onClose,
}: {
  event: FilingEvent;
  sourceFolderName: string | null;
  onClose: () => void;
}) {
  return (
    <div className={styles.intakeModalOverlay} onClick={onClose} role="presentation">
      <div
        aria-modal="true"
        className={styles.intakeModal}
        onClick={(event_) => event_.stopPropagation()}
        role="dialog"
      >
        <div className={styles.intakeModalHeader}>
          <div>
            <p className={styles.panelLabel}>Filed item</p>
            <div className={styles.modalTitleRow}>
              <FileKindIcon
                className={styles.modalFileKindIcon}
                mimeType={event.sourceMimeType}
                name={event.finalFilename || event.sourceName}
              />
              <h2>{event.finalFilename || event.sourceName}</h2>
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

        <div className={styles.intakeModalGrid}>
          <div className={styles.modalSideColumn}>
            <section className={styles.modalSection}>
              <div className={styles.modalSectionHeader}>
                <p className={styles.panelLabel}>File plan</p>
              </div>

              <div className={styles.editFieldsStack}>
                <div className={styles.planSection}>
                  <p className={styles.planSectionLabel}>Name</p>
                  <div className={styles.planRows}>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Current</span>
                      <div className={styles.planRowValue}>{event.sourceName}</div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Final</span>
                      <div className={styles.planRowValue}>
                        {event.finalFilename || event.sourceName}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.planSection}>
                  <p className={styles.planSectionLabel}>Location</p>
                  <div className={styles.planRows}>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Current</span>
                      <div className={styles.planRowValue}>
                        {sourceFolderName ?? "Intake folder"}
                      </div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Final</span>
                      <div className={styles.planRowValue}>
                        {buildFiledDestination(event) || "Not available"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.planSection}>
                  <p className={styles.planSectionLabel}>Audit</p>
                  <div className={styles.planRows}>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Moved by</span>
                      <div className={styles.planRowValue}>{displayFiledActor(event)}</div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Status</span>
                      <div className={styles.planRowValue}>Filed</div>
                    </div>
                    <div className={styles.planRow}>
                      <span className={styles.planRowLabel}>Filed on</span>
                      <div className={styles.planRowValue}>
                        {formatFilingTimestamp(event.createdAt)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.previewActionsDock}>
                <Link className={styles.secondaryAction} href="/history">
                  Open audit log
                </Link>
              </div>
            </section>
          </div>

          <section className={styles.previewPanel}>
            <div className={styles.documentPreviewPane}>
              <iframe
                className={styles.documentPreviewFrame}
                src={`/api/drive/files/${event.fileId}`}
                title={event.finalFilename || event.sourceName}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function detectExtension(filename: string) {
  const match = filename.match(/(\.[A-Za-z0-9]+)$/);
  return match?.[1] ?? "";
}

function labelForContentSource(contentSource: PreviewItem["contentSource"]) {
  if (contentSource === "pdf_text") {
    return "Read from PDF text";
  }

  if (contentSource === "pdf_ocr") {
    return "OCR on scanned PDF";
  }

  if (contentSource === "image_ocr") {
    return "OCR on image";
  }

  return "Metadata only";
}

function getDiagnosticFieldEntries(input: {
  fileId?: string | null;
  driveModifiedTime?: string | null;
  driveSize?: string | null;
  downloadByteLength?: number | null;
  downloadSha1?: string | null;
  parserConflictSummary?: string | null;
  client?: string | null;
  client2?: string | null;
  ownershipType?: string | null;
  accountType?: string | null;
  accountLast4?: string | null;
  custodian?: string | null;
  taxYear?: string | null;
  documentDate?: string | null;
  idType?: string | null;
  entityName?: string | null;
}) {
  return [
    ["Parser conflict", input.parserConflictSummary],
    ["File ID", input.fileId],
    ["Drive modified", formatDiagnosticTimestamp(input.driveModifiedTime)],
    ["Drive size", formatByteCount(input.driveSize)],
    ["Downloaded bytes", formatByteCount(input.downloadByteLength)],
    ["Downloaded SHA1", formatHash(input.downloadSha1)],
    ["Detected client", input.client],
    ["Detected client 2", input.client2],
    ["Ownership", input.ownershipType],
    ["Account type", input.accountType],
    ["Account last 4", input.accountLast4],
    ["Custodian", input.custodian],
    ["Tax year", input.taxYear],
    ["Document date", input.documentDate],
    ["ID type", input.idType],
    ["Entity name", input.entityName],
  ].map(([label, value]) => ({
    label,
    value: formatDiagnosticValue(value),
  }));
}

function formatDiagnosticValue(value: string | null | undefined) {
  return value && value.trim() ? value : "Not detected";
}

function formatDiagnosticTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(parsed);
}

function formatByteCount(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return String(value);
  }

  return `${new Intl.NumberFormat("en-US").format(numericValue)} bytes`;
}

function formatHash(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.length > 16 ? `${value.slice(0, 16)}…` : value;
}

function formatFilingTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function displayFiledActor(event: FilingEvent) {
  if (event.actorType === "automation") {
    return "System";
  }

  return event.actorEmail;
}

function buildFiledDestination(event: FilingEvent) {
  return [
    event.destinationRootName,
    event.clientFolderName,
    event.topLevelFolderName,
    event.finalFilename,
  ]
    .filter(Boolean)
    .join(" / ");
}
