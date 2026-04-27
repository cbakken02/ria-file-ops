"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  approvePreviewItemAction,
  approveSelectedPreviewItemsAction,
} from "@/app/preview/actions";
import { saveReviewDecisionAction } from "@/app/review/actions";
import { FileKindIcon } from "@/components/file-kind-icon";
import type { FilingEvent, ReviewDecision } from "@/lib/db";
import { getCleanupTopLevelFolderForDocumentType } from "@/lib/cleanup-presets";
import {
  buildDocumentFilenamePlan,
  getClientDisplayName,
  getDetectedDocumentSubtype,
  getDocumentSubtypeOptions,
  getDocumentTypeIdFromLabel,
  getNamingDocumentTypeLabel,
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
  savedDecisions: ReviewDecision[];
  folderTemplate: string[];
  namingRules: NamingRulesConfig;
  existingClientFolders: string[];
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
  savedDecisions,
  folderTemplate,
  namingRules,
  existingClientFolders,
  sourceFolderName,
}: IntakeQueueProps) {
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
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
  const visiblePreviewItems = useMemo(() => {
    if (activeTab === "review") {
      return reviewItems;
    }

    if (activeTab === "ready") {
      return readyItems;
    }

    if (activeTab === "filed") {
      return [];
    }

    return [...reviewItems, ...readyItems];
  }, [activeTab, readyItems, reviewItems]);
  const visiblePreviewItemIds = useMemo(
    () => new Set(visiblePreviewItems.map((item) => item.id)),
    [visiblePreviewItems],
  );
  const selectedVisibleItemIds = selectedItemIds.filter((id) =>
    visiblePreviewItemIds.has(id),
  );
  const selectedReadyItemIds = selectedVisibleItemIds.filter(
    (id) => previewItemMap.get(id)?.status === "Ready to stage",
  );
  const selectedCount = selectedVisibleItemIds.length;
  const selectedReadyCount = selectedReadyItemIds.length;
  const allVisibleItemsSelected =
    visiblePreviewItems.length > 0 && selectedCount === visiblePreviewItems.length;

  function toggleSelectedItem(itemId: string, selected: boolean) {
    setSelectedItemIds((current) => {
      if (selected) {
        return current.includes(itemId) ? current : [...current, itemId];
      }

      return current.filter((id) => id !== itemId);
    });
  }

  function toggleVisibleSelection() {
    setSelectedItemIds((current) => {
      if (allVisibleItemsSelected) {
        return current.filter((id) => !visiblePreviewItemIds.has(id));
      }

      const next = new Set(current);
      visiblePreviewItems.forEach((item) => next.add(item.id));
      return Array.from(next);
    });
  }

  let rows: ReactNode;

  if (activeTab === "review") {
    rows = reviewItems.length ? (
      reviewItems.map((item) =>
        renderPreviewRow(
          item,
          savedDecisionMap.get(item.id),
          setActiveModal,
          sourceFolderName,
          activeTab,
          selectedItemIds.includes(item.id),
          toggleSelectedItem,
        ),
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
        renderPreviewRow(
          item,
          savedDecisionMap.get(item.id),
          setActiveModal,
          sourceFolderName,
          activeTab,
          selectedItemIds.includes(item.id),
          toggleSelectedItem,
        ),
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
        renderPreviewRow(
          item,
          savedDecisionMap.get(item.id),
          setActiveModal,
          sourceFolderName,
          activeTab,
          selectedItemIds.includes(item.id),
          toggleSelectedItem,
        ),
      ),
      ...readyItems.map((item) =>
        renderPreviewRow(
          item,
          savedDecisionMap.get(item.id),
          setActiveModal,
          sourceFolderName,
          activeTab,
          selectedItemIds.includes(item.id),
          toggleSelectedItem,
        ),
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
      {activeTab !== "filed" ? (
        <div className={styles.queueActionBar}>
          <div className={styles.actionGroup}>
            {visiblePreviewItems.length > 0 ? (
              <button
                className={styles.secondaryAction}
                onClick={toggleVisibleSelection}
                type="button"
              >
                {allVisibleItemsSelected ? "Clear selection" : "Select All"}
              </button>
            ) : null}
            <form
              action={approveSelectedPreviewItemsAction}
              className={styles.inlineActionForm}
            >
              <input name="tab" type="hidden" value={activeTab} />
              {selectedReadyItemIds.map((itemId) => (
                <input key={itemId} name="fileId" type="hidden" value={itemId} />
              ))}
              {selectedReadyCount > 0 ? (
                <button className={styles.primaryAction} type="submit">
                  {`Approve Selected (${selectedReadyCount})`}
                </button>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
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
  sourceFolderName: string | null,
  activeTab: IntakeQueueProps["activeTab"],
  isSelected: boolean,
  onToggleSelected: (itemId: string, selected: boolean) => void,
) {
  const displayedClientFolder =
    savedDecision?.reviewedClientFolder ??
    item.resolvedHouseholdFolder ??
    item.suggestedHouseholdFolder;
  const displayedTopLevelFolder =
    savedDecision?.reviewedTopLevelFolder ?? item.proposedTopLevelFolder;
  const displayedFilename = savedDecision?.reviewedFilename ?? item.proposedFilename;
  const originalLocation = sourceFolderName ?? "Intake folder";
  const proposedLocation = displayedClientFolder
    ? `${displayedClientFolder} / ${displayedTopLevelFolder}`
    : `Needs review / ${displayedTopLevelFolder}`;
  const uploadedLabel = item.createdTime
    ? formatDriveTimestamp(item.createdTime)
    : "Refresh to load";
  const canApprove = Boolean(
    displayedClientFolder && displayedTopLevelFolder && displayedFilename,
  );
  const showApprove = item.status === "Ready to stage";
  const isSuggestedNewClient =
    typeof displayedClientFolder === "string" &&
    displayedClientFolder.length > 0 &&
    !savedDecision?.reviewedClientFolder &&
    item.clientResolutionStatus === "created_new";

  return (
    <article key={item.id} className={styles.queueRow}>
      <div className={styles.rowContent}>
        <label className={styles.selectionControl}>
          <input
            aria-label={`Select ${item.sourceName}`}
            checked={isSelected}
            onChange={(event) => onToggleSelected(item.id, event.target.checked)}
            type="checkbox"
          />
        </label>
        <div className={styles.rowIdentity}>
          <div className={styles.fileComparisonGrid}>
            <div className={styles.fileComparisonBlock}>
              <span className={styles.comparisonLabel}>Original name</span>
              <div className={styles.fileTitleRow}>
                <FileKindIcon
                  className={styles.fileKindIcon}
                  mimeType={item.mimeType}
                  name={item.sourceName}
                />
                <h3 className={`${styles.fileName} ${styles.originalFileName}`}>
                  {item.sourceName}
                </h3>
              </div>
              <span className={styles.locationFact}>
                <strong>Original location</strong>
                {originalLocation}
              </span>
              <span className={styles.locationFact}>
                <strong>Uploaded to Drive</strong>
                {uploadedLabel}
              </span>
            </div>
            <div className={styles.fileComparisonBlock}>
              <span className={styles.comparisonLabel}>Proposed file name</span>
              <code className={styles.proposedFileName}>{displayedFilename}</code>
              <span className={styles.locationFact}>
                <strong>Proposed location</strong>
                {proposedLocation}
              </span>
              <span className={styles.locationFact}>
                <strong>Recognized file type</strong>
                {getNamingDocumentTypeLabel(item.documentTypeId)}
              </span>
              {isSuggestedNewClient ? (
                <span className={styles.newClientFlag}>Possible new household</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className={styles.rowActions}>
          <button
            className={`${styles.secondaryAction} ${styles.rowActionButton} ${styles.rowActionReview}`}
            onClick={() => setActiveModal({ kind: "preview", itemId: item.id })}
            type="button"
          >
            Review
          </button>
          {showApprove ? (
            <form action={approvePreviewItemAction} className={styles.inlineActionForm}>
              <input name="fileId" type="hidden" value={item.id} />
              <input name="tab" type="hidden" value={activeTab} />
              <button
                className={`${styles.primaryAction} ${styles.rowActionButton} ${styles.rowActionApprove}`}
                disabled={!canApprove}
                type="submit"
              >
                Approve
              </button>
            </form>
          ) : null}
        </div>
      </div>
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
  documentSubtype: string;
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

function getDocumentTypeOptions() {
  return getNamingDocumentTypeOptions().map((option) => option.label);
}

function getDocumentSubtype(
  documentTypeId: NamingRuleDocumentType,
  detectedDocumentType: string,
) {
  return getDetectedDocumentSubtype(documentTypeId, detectedDocumentType) ?? "";
}

function resolveFilenameDocumentLabel(plan: PreviewPlanState) {
  return plan.documentSubtype
    ? plan.documentSubtype
    : plan.documentType;
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
    documentTypeId: getDocumentTypeIdFromLabel(plan.documentType),
    documentTypeLabel: resolveFilenameDocumentLabel(plan),
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
    documentType:
      savedDecision?.detectedDocumentType ??
      getNamingDocumentTypeLabel(item.documentTypeId),
    documentSubtype: getDocumentSubtype(
      item.documentTypeId,
      savedDecision?.reviewedDocumentSubtype ??
        savedDecision?.detectedDocumentSubtype ??
        item.detectedDocumentType,
    ),
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
    () => getDocumentTypeOptions(),
    [],
  );
  const activeDocumentTypeId = getDocumentTypeIdFromLabel(plan.documentType);
  const documentSubtypeOptions = useMemo(
    () => getDocumentSubtypeOptions(activeDocumentTypeId, plan.documentSubtype),
    [activeDocumentTypeId, plan.documentSubtype],
  );
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
                  name="detectedDocumentSubtype"
                  type="hidden"
                  value={plan.documentSubtype}
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

                      {plan.documentSubtype ? (
                        <label className={styles.planRow}>
                          <span className={styles.planRowLabel}>Subtype</span>
                          <div className={styles.planRowControl}>
                            <select
                              className={styles.planRowSelect}
                              disabled={!canEdit}
                              name="reviewedDocumentSubtype"
                              onChange={(event) =>
                                updateDerivedPlan(
                                  { documentSubtype: event.target.value },
                                  { deriveFilename: true },
                                )
                              }
                              value={plan.documentSubtype}
                            >
                              {documentSubtypeOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>
                        </label>
                      ) : null}

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
                          <span className={styles.planRowLabel}>Extraction result</span>
                          <div className={styles.planRowValue}>
                            {labelForContentSource(item.contentSource)}
                          </div>
                        </div>
                        {getDiagnosticFieldEntries({
                          accountLast4: plan.accountLast4,
                          accountType: plan.accountType,
                          analysisProfile: item.analysisProfile,
                          analysisRanAt: item.analysisRanAt,
                          analysisSource: item.analysisSource,
                          aiAttempted: item.debug.aiAttempted,
                          aiEnabled: item.debug.aiEnabled,
                          aiFailureReason: item.debug.aiFailureReason,
                          aiModel: item.debug.aiModel,
                          aiPromptVersion: item.debug.aiPromptVersion,
                          aiRawAccountType: item.debug.aiRawAccountType,
                          aiRawCustodian: item.debug.aiRawCustodian,
                          aiRawDetectedClient: item.debug.aiRawDetectedClient,
                          aiRawDetectedClient2: item.debug.aiRawDetectedClient2,
                          aiRawSummary: item.debug.aiRawSummary,
                          aiUsed: item.debug.aiUsed,
                          accountTypeWasNormalized: item.debug.accountTypeWasNormalized,
                          cacheWrittenAt: item.cacheWrittenAt,
                          client: item.detectedClient,
                          client2: item.detectedClient2,
                          custodianWasNormalized: item.debug.custodianWasNormalized,
                          custodian: plan.custodian,
                          downloadByteLength: item.downloadByteLength,
                          downloadSha1: item.downloadSha1,
                          driveModifiedTime: item.modifiedTime,
                          driveSize: item.driveSize,
                          documentDate: plan.documentDate,
                          entityName: plan.entityName,
                          fieldOwnership: item.debug.fieldOwnership,
                          fileId: item.id,
                          idType: plan.idType,
                          ownershipType: plan.ownershipType,
                          pdfExtractionAttempts: item.debug.pdfExtractionAttempts,
                          parserVersion: item.debug.parserVersion,
                          parserConflictSummary: item.parserConflictSummary,
                          phase1ReviewPriority: item.phase1ReviewPriority,
                          phase1ReviewFlags: item.phase1ReviewFlags,
                          documentSignal: item.debug.documentSignal,
                          statementClientSource: item.debug.statementClientSource,
                          statementClientCandidate: item.debug.statementClientCandidate,
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
  analysisProfile?: PreviewItem["analysisProfile"] | null;
  analysisSource?: PreviewItem["analysisSource"] | null;
  analysisRanAt?: string | null;
  cacheWrittenAt?: string | null;
  aiEnabled?: boolean;
  aiAttempted?: boolean;
  aiUsed?: boolean;
  aiFailureReason?: string | null;
  aiModel?: string | null;
  aiPromptVersion?: string | null;
  aiRawSummary?: string | null;
  aiRawDetectedClient?: string | null;
  aiRawDetectedClient2?: string | null;
  aiRawCustodian?: string | null;
  aiRawAccountType?: string | null;
  custodianWasNormalized?: boolean | null;
  accountTypeWasNormalized?: boolean | null;
  phase1ReviewFlags?: PreviewItem["phase1ReviewFlags"];
  phase1ReviewPriority?: PreviewItem["phase1ReviewPriority"];
  parserVersion?: string | null;
  parserConflictSummary?: string | null;
  documentSignal?: string | null;
  fieldOwnership?: PreviewItem["debug"]["fieldOwnership"];
  pdfExtractionAttempts?: PreviewItem["debug"]["pdfExtractionAttempts"];
  statementClientSource?: PreviewItem["debug"]["statementClientSource"] | null;
  statementClientCandidate?: string | null;
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
    ["Analysis", formatAnalysisProfile(input.analysisProfile)],
    ["Analysis source", formatAnalysisSource(input.analysisSource)],
    ["Analysis ran", formatDiagnosticTimestamp(input.analysisRanAt)],
    ["Cache written", formatDiagnosticTimestamp(input.cacheWrittenAt)],
    [
      "AI status",
      formatAIStatus({
        analysisProfile: input.analysisProfile,
        aiEnabled: input.aiEnabled,
        aiAttempted: input.aiAttempted,
        aiUsed: input.aiUsed,
        aiFailureReason: input.aiFailureReason,
      }),
    ],
    ["AI mapping enabled", formatBooleanDiagnostic(input.aiEnabled)],
    ["AI mapping attempted", formatBooleanDiagnostic(input.aiAttempted)],
    ["AI mapping used", formatBooleanDiagnostic(input.aiUsed)],
    ["AI failure", input.aiFailureReason],
    ["AI model", input.aiModel],
    ["AI prompt version", input.aiPromptVersion],
    ["AI evidence summary", input.aiRawSummary],
    ["Raw AI client", input.aiRawDetectedClient],
    ["Raw AI client 2", input.aiRawDetectedClient2],
    ["Raw AI custodian", input.aiRawCustodian],
    ["Final custodian", input.custodian],
    ["Custodian normalized", formatBooleanDiagnostic(input.custodianWasNormalized)],
    ["Raw AI account type", input.aiRawAccountType],
    ["Final account type", input.accountType],
    [
      "Account type normalized",
      formatBooleanDiagnostic(input.accountTypeWasNormalized),
    ],
    ["Phase 1 review priority", formatPhase1ReviewPriority(input.phase1ReviewPriority)],
    ["Phase 1 review flags", formatPhase1ReviewFlags(input.phase1ReviewFlags)],
    ["Field ownership", formatFieldOwnershipSummary(input.fieldOwnership)],
    ["Extraction attempts", formatPdfExtractionAttempts(input.pdfExtractionAttempts)],
    ["Parser version", input.parserVersion],
    ["Parser conflict", input.parserConflictSummary],
    ["Document signal", input.documentSignal],
    ["Statement client source", formatStatementClientSource(input.statementClientSource)],
    ["Statement client candidate", input.statementClientCandidate],
    ["File ID", input.fileId],
    ["Drive modified", formatDiagnosticTimestamp(input.driveModifiedTime)],
    ["Drive size", formatByteCount(input.driveSize)],
    ["Downloaded bytes", formatByteCount(input.downloadByteLength)],
    ["Downloaded SHA1", formatHash(input.downloadSha1)],
    ["Detected client", input.client],
    ["Detected client 2", input.client2],
    ["Ownership", input.ownershipType],
    ["Account last 4", input.accountLast4],
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

function formatAnalysisSource(
  value: PreviewItem["analysisSource"] | null | undefined,
) {
  if (value === "fresh_analysis") {
    return "Fresh analysis";
  }

  if (value === "loaded_from_cache") {
    return "Loaded from cache";
  }

  return null;
}

function formatAnalysisProfile(
  value: PreviewItem["analysisProfile"] | null | undefined,
) {
  const profile = value as string | null | undefined;

  if (profile === "ai_assisted" || profile === "preview_ai_primary") {
    return "AI-assisted mapping";
  }

  if (profile === "deterministic_fallback" || profile === "legacy") {
    return "Deterministic fallback";
  }

  if (profile === "cleanup_workflow" || profile === "cleanup_explorer") {
    return "Cleanup workflow state";
  }

  return profile ?? null;
}

function formatBooleanDiagnostic(value: boolean | null | undefined) {
  if (value === true) {
    return "Yes";
  }

  if (value === false) {
    return "No";
  }

  return null;
}

function formatPdfExtractionAttempts(
  attempts: PreviewItem["debug"]["pdfExtractionAttempts"] | null | undefined,
) {
  if (!attempts?.length) {
    return null;
  }

  return attempts
    .map((attempt) => {
      const metrics = [
        attempt.textLength !== null ? `${attempt.textLength} chars` : null,
        attempt.fieldCount !== null ? `${attempt.fieldCount} fields` : null,
      ].filter(Boolean);
      const suffix = [
        metrics.length ? `(${metrics.join(", ")})` : null,
        attempt.detail,
      ]
        .filter(Boolean)
        .join(" ");
      return suffix
        ? `${attempt.extractor}: ${attempt.status} ${suffix}`
        : `${attempt.extractor}: ${attempt.status}`;
    })
    .join("; ");
}

function formatAIStatus(input: {
  analysisProfile?: PreviewItem["analysisProfile"] | null;
  aiEnabled?: boolean;
  aiAttempted?: boolean;
  aiUsed?: boolean;
  aiFailureReason?: string | null;
}) {
  const deterministic =
    input.analysisProfile === "deterministic_fallback" ||
    input.analysisProfile === "legacy";

  if (input.aiAttempted && input.aiUsed) {
    return "AI mapping used";
  }

  if (input.aiAttempted && input.aiFailureReason) {
    return "AI mapping failed; deterministic fallback used";
  }

  if (
    !input.aiAttempted &&
    input.aiFailureReason &&
    /provider is not configured/i.test(input.aiFailureReason)
  ) {
    return "AI mapping unavailable; provider not configured";
  }

  if (!input.aiAttempted && input.aiFailureReason) {
    return "Deterministic fallback used";
  }

  if (input.aiAttempted) {
    return "AI mapping attempted";
  }

  if (!input.aiEnabled || deterministic) {
    return "Deterministic fallback used";
  }

  return "AI mapping enabled but not used";
}

function formatStatementClientSource(
  value: PreviewItem["debug"]["statementClientSource"] | null | undefined,
) {
  if (!value) {
    return null;
  }

  if (value === "none") {
    return "None";
  }

  if (value === "fields_or_joint_clients") {
    return "Fields / joint clients";
  }

  if (value === "anchored_header") {
    return "Anchored header";
  }

  if (value === "owner_address_block_lines") {
    return "Owner/address block (lines)";
  }

  if (value === "owner_address_block_inline") {
    return "Owner/address block (inline)";
  }

  if (value === "header_block_name") {
    return "Header block name";
  }

  if (value === "generic_text_fallback") {
    return "Generic text fallback";
  }

  if (value === "generic_first_page_fallback") {
    return "Generic first-page fallback";
  }

  return value;
}

function formatPhase1ReviewPriority(
  value: PreviewItem["phase1ReviewPriority"] | null | undefined,
) {
  if (!value) {
    return null;
  }

  return value[0]?.toUpperCase() + value.slice(1);
}

function formatFieldOwnershipSummary(
  fieldOwnership: PreviewItem["debug"]["fieldOwnership"] | null | undefined,
) {
  if (!fieldOwnership) {
    return null;
  }

  const entries = Object.entries(fieldOwnership)
    .map(([field, ownership]) =>
      ownership?.owner ? `${field}=${ownership.owner}` : null,
    )
    .filter((entry): entry is string => Boolean(entry))
    .sort((left, right) => left.localeCompare(right));

  return entries.length ? entries.join(", ") : null;
}

function formatPhase1ReviewFlags(
  flags: PreviewItem["phase1ReviewFlags"] | null | undefined,
) {
  if (!flags?.length) {
    return null;
  }

  return flags
    .map((flag) => {
      if (flag === "document_date_conflict") {
        return "Conflicting or ambiguous document date signals";
      }
      if (flag === "missing_custodian_on_valid_statement") {
        return "Missing custodian on otherwise valid statement";
      }
      if (flag === "missing_account_type_on_valid_statement") {
        return "Missing account type on otherwise valid statement";
      }
      if (flag === "custodian_differs_from_raw_ai") {
        return "Raw AI custodian differs from final custodian";
      }
      if (flag === "account_type_differs_from_raw_ai") {
        return "Raw AI account type differs from final account type";
      }

      return flag;
    })
    .join(", ");
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

function formatDriveTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
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
