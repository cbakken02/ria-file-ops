"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileKindIcon } from "@/components/file-kind-icon";
import {
  getCleanupTopLevelFolderForDocumentType,
} from "@/lib/cleanup-presets";
import {
  buildDocumentFilenamePlan,
  getClientDisplayName,
  getDocumentTypeIdFromLabel,
  getNamingDocumentTypeOptions,
  type NamingRulesConfig,
  type NamingTokenId,
} from "@/lib/naming-rules";
import type {
  CleanupBrowserItem,
  CleanupMode,
  CleanupPreviewData,
  CleanupPreviewFileRow,
  CleanupScope,
} from "@/lib/cleanup-types";
import styles from "./page.module.css";

type CleanupPlannerProps = {
  hasActiveStorage: boolean;
  inactiveStorageMessage: string;
  inactiveStorageTitle: string;
  rootBrowserFolderId: string;
  rootBrowserFolderName: string;
  initialCurrentFolderId: string;
  initialFolderTrail: Array<{ id: string; name: string }>;
  initialBrowserItems: CleanupBrowserItem[];
  namingRules: NamingRulesConfig;
};

const scopeOptions: Array<{
  value: CleanupScope;
  label: string;
}> = [
  {
    value: "single_file",
    label: "Single file",
  },
  {
    value: "folder_of_files",
    label: "Folder of files",
  },
  {
    value: "client_folder",
    label: "Household folder",
  },
  {
    value: "multiple_client_folders",
    label: "Multiple households",
  },
];

const modeOptions: Array<{
  value: CleanupMode;
  label: string;
}> = [
  {
    value: "rename_only",
    label: "Rename files only",
  },
  {
    value: "reorganize_only",
    label: "Reorganize only",
  },
  {
    value: "rename_and_reorganize",
    label: "Rename + reorganize",
  },
];

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

type CleanupRowActionKind = "analyze" | "review" | "apply" | "complete";

type EditableCleanupRow = {
  id: string;
  proposedHouseholdFolder: string;
  proposedClientName: string;
  proposedClientName2: string;
  ownershipType: "single" | "joint";
  proposedClientFolder: string;
  proposedDocumentType: string;
  proposedFilename: string;
  proposedLocation: string;
  accountType: string;
  accountLast4: string;
  custodian: string;
  taxYear: string;
  documentDate: string;
  idType: string;
  entityName: string;
};

type CleanupFolderTrail = Array<{ id: string; name: string }>;

type BrowserFolderCacheEntry = {
  items: CleanupBrowserItem[];
  trail: CleanupFolderTrail;
  loadedAt: number;
};

const PREFETCH_FOLDER_LIMIT = 3;

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
  documentTypeId: ReturnType<typeof getDocumentTypeIdFromLabel>,
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

export function CleanupPlanner({
  hasActiveStorage,
  inactiveStorageMessage,
  inactiveStorageTitle,
  rootBrowserFolderId,
  rootBrowserFolderName,
  initialCurrentFolderId,
  initialFolderTrail = [],
  initialBrowserItems = [],
  namingRules,
}: CleanupPlannerProps) {
  const initialBrowserLoaded = initialBrowserItems.length > 0;
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const browserCacheRef = useRef(new Map<string, BrowserFolderCacheEntry>());
  const folderLoadPromisesRef = useRef(
    new Map<string, Promise<BrowserFolderCacheEntry>>(),
  );
  const seededBrowserCacheRef = useRef(false);
  const currentBrowserRequestRef = useRef(0);
  const initialFolderLoadStartedRef = useRef(false);
  const normalizedInitialFolderId = initialCurrentFolderId || rootBrowserFolderId;
  const normalizedInitialFolderTrail = Array.isArray(initialFolderTrail)
    ? initialFolderTrail
    : [];

  if (!seededBrowserCacheRef.current) {
    seededBrowserCacheRef.current = true;
    if (initialBrowserLoaded) {
      browserCacheRef.current.set(normalizedInitialFolderId, {
        items: initialBrowserItems,
        trail: normalizedInitialFolderTrail,
        loadedAt: Date.now(),
      });
    }
  }

  const [scope, setScope] = useState<CleanupScope>("client_folder");
  const [mode, setMode] = useState<CleanupMode>("rename_and_reorganize");
  const [browserItems, setBrowserItems] = useState<CleanupBrowserItem[]>(
    () => (Array.isArray(initialBrowserItems) ? initialBrowserItems : []),
  );
  const [browserLoaded, setBrowserLoaded] = useState(() => initialBrowserLoaded);
  const [storageAvailable, setStorageAvailable] = useState(hasActiveStorage);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState(
    () => hasActiveStorage && !initialBrowserLoaded,
  );
  const [currentFolderId, setCurrentFolderId] = useState(
    () => normalizedInitialFolderId,
  );
  const [folderTrail, setFolderTrail] = useState<Array<{ id: string; name: string }>>(
    () => normalizedInitialFolderTrail,
  );
  const [preview, setPreview] = useState<CleanupPreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeRowAction, setActiveRowAction] = useState<{
    itemId: string;
    kind: CleanupRowActionKind;
  } | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<CleanupBrowserItem[]>([]);
  const [editableRows, setEditableRows] = useState<EditableCleanupRow[]>([]);
  const [activePreviewFileId, setActivePreviewFileId] = useState<string | null>(null);

  const selectedItem = selectedTargets[0] ?? null;
  const safeFolderTrail = useMemo(
    () => (Array.isArray(folderTrail) ? folderTrail : []),
    [folderTrail],
  );
  const safeBrowserItems = useMemo(
    () => (Array.isArray(browserItems) ? browserItems : []),
    [browserItems],
  );
  const rootSegmentOffset =
    safeFolderTrail[0]?.name === rootBrowserFolderName ? 1 : 0;
  const visibleFolderTrail =
    rootSegmentOffset > 0 ? safeFolderTrail.slice(rootSegmentOffset) : safeFolderTrail;
  const visibleScopeOptions = selectedItem
    ? isFolder(selectedItem)
      ? scopeOptions.filter((option) => option.value !== "single_file")
      : scopeOptions.filter((option) => option.value === "single_file")
    : scopeOptions;
  const currentFolderLabel =
    safeFolderTrail.at(-1)?.name ?? rootBrowserFolderName ?? "My Drive";
  const selectedFileTargets = selectedTargets.filter((item) => !isFolder(item));
  const selectedFolderTargets = selectedTargets.filter((item) => isFolder(item));
  const hasMixedSelection =
    selectedFileTargets.length > 0 && selectedFolderTargets.length > 0;
  const selectedSuggestionTargets = selectedFileTargets.filter((item) =>
    item.cleanup?.status === "suggestion_ready" ||
    item.cleanup?.status === "needs_review",
  );
  const selectedReadySuggestions = selectedFileTargets.filter(
    (item) => item.cleanup?.status === "suggestion_ready",
  );
  const allVisibleSelected =
    safeBrowserItems.length > 0 &&
    safeBrowserItems.every((item) =>
      selectedTargets.some((selected) => selected.id === item.id),
    );

  useEffect(() => {
    setStorageAvailable(hasActiveStorage);
  }, [hasActiveStorage]);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setRunError(null);
    setRunNotice(null);
  }, [scope]);

  useEffect(() => {
    if (!preview) {
      setEditableRows([]);
      setActivePreviewFileId(null);
      return;
    }

    setEditableRows(
      preview.fileRows.map((row) => ({
        accountLast4: row.extractedAccountLast4 ?? "",
        accountType: row.extractedAccountType ?? "",
        custodian: row.extractedCustodian ?? "",
        documentDate: row.extractedDocumentDate ?? "",
        entityName: row.extractedEntityName ?? "",
        id: row.id,
        idType: row.extractedIdType ?? "",
        proposedClientName:
          row.proposedClientName ??
          getClientDisplayName({
            detectedClient: row.detectedClient,
            clientFolder: row.proposedHouseholdFolder ?? row.proposedClientFolder,
          }) ??
          "",
        proposedClientName2: row.proposedClientName2 ?? row.detectedClient2 ?? "",
        proposedHouseholdFolder:
          row.proposedHouseholdFolder ?? row.proposedClientFolder ?? "",
        proposedClientFolder: row.proposedClientFolder ?? "",
        proposedDocumentType: row.proposedDocumentType,
        proposedFilename: row.proposedFilename,
        proposedLocation: row.proposedLocation,
        ownershipType: row.ownershipType,
        taxYear: row.extractedTaxYear ?? "",
      })),
    );
    setActivePreviewFileId((current) =>
      current && preview.fileRows.some((row) => row.id === current)
        ? current
        : (preview.fileRows[0]?.id ?? null),
    );
  }, [preview]);

  async function runCleanup() {
    if (!storageAvailable || !preview?.canRun || runLoading || selectedTargets.length === 0) {
      return;
    }

    setRunLoading(true);
    setRunError(null);
    setRunNotice(null);

    try {
      const response = await fetch("/api/cleanup/run", {
        body: JSON.stringify({
          mode,
          overrides: editableRows,
          scope,
          selectedIds: selectedTargets.map((item) => item.id),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        const error = new Error(
          data.error || "Cleanup could not be completed.",
        ) as Error & { storageUnavailable?: boolean };
        if (response.status === 401 || response.status === 403) {
          error.storageUnavailable = true;
        }
        throw error;
      }

      setRunNotice(data.message || "Cleanup finished.");
      setPreview(null);
      setSelectedTargets([]);
      setPlannerOpen(false);
      await openFolder(currentFolderId, folderTrail, { forceRefresh: true });
    } catch (error) {
      if (
        error instanceof Error &&
        "storageUnavailable" in error &&
        error.storageUnavailable
      ) {
        setStorageAvailable(false);
        setBrowserItems([]);
        setSelectedTargets([]);
        setPreview(null);
        setPlannerOpen(false);
      }
      setRunError(
        error instanceof Error ? error.message : "Cleanup could not be completed.",
      );
    } finally {
      setRunLoading(false);
    }
  }

  async function requestPreviewForTargets(targets: CleanupBrowserItem[]) {
    const cleanTargets = targets.filter(Boolean);
    if (!storageAvailable || cleanTargets.length === 0) {
      return;
    }

    const nextScope = cleanTargets.every((item) => isFolder(item))
      ? cleanTargets.length > 1
        ? "multiple_client_folders"
        : "client_folder"
      : "single_file";

    setScope(nextScope);
    setSelectedTargets(cleanTargets);
    setPlannerOpen(true);
    setActiveRowAction(
      cleanTargets.length === 1 && !isFolder(cleanTargets[0] as CleanupBrowserItem)
        ? {
            itemId: (cleanTargets[0] as CleanupBrowserItem).id,
            kind: "review",
          }
        : null,
    );
    setPreviewLoading(true);
    setPreviewError(null);
    setRunError(null);
    setRunNotice(null);

    try {
      const response = await fetch("/api/cleanup/preview", {
        body: JSON.stringify({
          mode,
          scope: nextScope,
          selectedIds: cleanTargets.map((item) => item.id),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const data = (await response.json()) as CleanupPreviewData & {
        error?: string;
      };

      if (!response.ok) {
        const error = new Error(
          data.error || "Cleanup preview could not be generated.",
        ) as Error & { storageUnavailable?: boolean };
        if (response.status === 401 || response.status === 403) {
          error.storageUnavailable = true;
        }
        throw error;
      }

      setPreview(data);
    } catch (error) {
      if (
        error instanceof Error &&
        "storageUnavailable" in error &&
        error.storageUnavailable
      ) {
        setStorageAvailable(false);
        setBrowserItems([]);
        setSelectedTargets([]);
        setPlannerOpen(false);
      }
      setPreview(null);
      setPreviewError(
        error instanceof Error
          ? error.message
          : "Cleanup preview could not be generated.",
      );
    } finally {
      setPreviewLoading(false);
      setActiveRowAction(null);
    }
  }

  async function analyzeTargets(
    targets: CleanupBrowserItem[],
    targetKind: "files" | "folders",
  ) {
    const cleanTargets = targets.filter(Boolean);
    if (!storageAvailable || cleanTargets.length === 0 || actionLoading) {
      return;
    }

    setActionLoading(true);
    setActiveRowAction(
      cleanTargets.length === 1 && targetKind === "files"
        ? { itemId: (cleanTargets[0] as CleanupBrowserItem).id, kind: "analyze" }
        : null,
    );
    setRunError(null);
    setRunNotice(null);

    try {
      const response = await fetch("/api/cleanup/analyze", {
        body: JSON.stringify({
          mode,
          selectedIds: cleanTargets.map((item) => item.id),
          targetKind,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        const error = new Error(
          data.error || "Cleanup analysis could not be completed.",
        ) as Error & { storageUnavailable?: boolean };
        if (response.status === 401 || response.status === 403) {
          error.storageUnavailable = true;
        }
        throw error;
      }

      setRunNotice(data.message || "Cleanup analysis finished.");
      setPreview(null);
      setPlannerOpen(false);
      await openFolder(currentFolderId, safeFolderTrail, { forceRefresh: true });
    } catch (error) {
      if (
        error instanceof Error &&
        "storageUnavailable" in error &&
        error.storageUnavailable
      ) {
        setStorageAvailable(false);
        setBrowserItems([]);
        setSelectedTargets([]);
        setPreview(null);
        setPlannerOpen(false);
      }
      setRunError(
        error instanceof Error
          ? error.message
          : "Cleanup analysis could not be completed.",
      );
    } finally {
      setActionLoading(false);
      setActiveRowAction(null);
    }
  }

  async function applySuggestionTargets(targets: CleanupBrowserItem[]) {
    const readyTargets = targets.filter(
      (item) => item.cleanup?.status === "suggestion_ready",
    );
    if (!storageAvailable || readyTargets.length === 0 || actionLoading) {
      return;
    }

    setActionLoading(true);
    setActiveRowAction(
      readyTargets.length === 1
        ? { itemId: (readyTargets[0] as CleanupBrowserItem).id, kind: "apply" }
        : null,
    );
    setRunError(null);
    setRunNotice(null);

    try {
      const response = await fetch("/api/cleanup/apply", {
        body: JSON.stringify({
          selectedIds: readyTargets.map((item) => item.id),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        const error = new Error(
          data.error || "Cleanup suggestions could not be applied.",
        ) as Error & { storageUnavailable?: boolean };
        if (response.status === 401 || response.status === 403) {
          error.storageUnavailable = true;
        }
        throw error;
      }

      setRunNotice(data.message || "Cleanup suggestions applied.");
      setPreview(null);
      setPlannerOpen(false);
      setSelectedTargets([]);
      await openFolder(currentFolderId, safeFolderTrail, { forceRefresh: true });
    } catch (error) {
      if (
        error instanceof Error &&
        "storageUnavailable" in error &&
        error.storageUnavailable
      ) {
        setStorageAvailable(false);
        setBrowserItems([]);
        setSelectedTargets([]);
        setPreview(null);
        setPlannerOpen(false);
      }
      setRunError(
        error instanceof Error
          ? error.message
          : "Cleanup suggestions could not be applied.",
      );
    } finally {
      setActionLoading(false);
      setActiveRowAction(null);
    }
  }

  async function applySelectedSuggestions() {
    await applySuggestionTargets(selectedReadySuggestions);
  }

  const loadFolderFromApi = useCallback(async function loadFolderFromApi(
    folderId: string,
    fallbackTrail: CleanupFolderTrail,
    options?: { includeTrail?: boolean },
  ) {
    const loadKey = `${options?.includeTrail === false ? "items" : "trail"}:${folderId}`;
    const existingLoad = folderLoadPromisesRef.current.get(loadKey);
    if (existingLoad) {
      return existingLoad;
    }

    const loadPromise = (async () => {
      const params = new URLSearchParams({ folderId });
      const fallbackFolderName = fallbackTrail.at(-1)?.name;
      if (fallbackFolderName) {
        params.set("folderName", fallbackFolderName);
      }
      const fallbackFolderPath = formatCleanupCurrentLocation(fallbackTrail);
      if (fallbackFolderPath) {
        params.set("folderPath", fallbackFolderPath);
      }
      if (options?.includeTrail === false) {
        params.set("includeTrail", "0");
      }

      const response = await fetch(`/api/cleanup/browser?${params.toString()}`);
      const data = (await response.json()) as {
        error?: string;
        items?: CleanupBrowserItem[];
        trail?: CleanupFolderTrail;
      };

      if (!response.ok) {
        const error = new Error(
          data.error || "That folder could not be loaded.",
        ) as Error & { storageUnavailable?: boolean };
        if (response.status === 401 || response.status === 403) {
          error.storageUnavailable = true;
        }
        throw error;
      }

      const entry: BrowserFolderCacheEntry = {
        items: data.items ?? [],
        trail: Array.isArray(data.trail) ? data.trail : fallbackTrail,
        loadedAt: Date.now(),
      };
      browserCacheRef.current.set(folderId, entry);

      return entry;
    })();

    folderLoadPromisesRef.current.set(loadKey, loadPromise);

    try {
      return await loadPromise;
    } finally {
      folderLoadPromisesRef.current.delete(loadKey);
    }
  }, []);

  const openFolder = useCallback(async function openFolder(
    folderId: string,
    fallbackTrail: CleanupFolderTrail,
    options?: { forceRefresh?: boolean; includeTrail?: boolean },
  ) {
    const safeFallbackTrail = Array.isArray(fallbackTrail) ? fallbackTrail : [];
    const cachedEntry = options?.forceRefresh
      ? null
      : browserCacheRef.current.get(folderId) ?? null;

    setBrowserError(null);
    setCurrentFolderId(folderId);
    setFolderTrail(cachedEntry?.trail ?? safeFallbackTrail);
    setSelectedTargets([]);
    setPreview(null);
    setPlannerOpen(false);

    if (cachedEntry) {
      setBrowserItems(cachedEntry.items);
      setBrowserLoaded(true);
      setBrowserLoading(false);
      return;
    }

    const requestId = currentBrowserRequestRef.current + 1;
    currentBrowserRequestRef.current = requestId;

    setBrowserItems([]);
    setBrowserLoaded(true);
    setBrowserLoading(true);

    try {
      const includeTrail =
        options?.includeTrail ??
        (folderId !== rootBrowserFolderId && safeFallbackTrail.length === 0);
      const entry = await loadFolderFromApi(folderId, safeFallbackTrail, {
        includeTrail,
      });

      if (currentBrowserRequestRef.current !== requestId) {
        return;
      }

      setBrowserItems(entry.items);
      setFolderTrail(entry.trail);
    } catch (error) {
      if (currentBrowserRequestRef.current !== requestId) {
        return;
      }

      if (
        error instanceof Error &&
        "storageUnavailable" in error &&
        error.storageUnavailable
      ) {
        setStorageAvailable(false);
        setBrowserItems([]);
        setSelectedTargets([]);
        setPreview(null);
        setPlannerOpen(false);
      }
      setBrowserError(
        error instanceof Error
          ? error.message
          : "That folder could not be loaded.",
      );
    } finally {
      if (currentBrowserRequestRef.current === requestId) {
        setBrowserLoading(false);
      }
    }
  }, [loadFolderFromApi, rootBrowserFolderId]);

  const prefetchFolder = useCallback(async function prefetchFolder(
    folderId: string,
    fallbackTrail: CleanupFolderTrail,
  ) {
    if (browserCacheRef.current.has(folderId)) {
      return;
    }

    try {
      await loadFolderFromApi(folderId, fallbackTrail, { includeTrail: false });
    } catch {
      // Prefetch is opportunistic; explicit folder opens still surface errors.
    }
  }, [loadFolderFromApi]);

  useEffect(() => {
    if (!storageAvailable || initialFolderLoadStartedRef.current) {
      return;
    }

    initialFolderLoadStartedRef.current = true;
    void openFolder(currentFolderId, safeFolderTrail);
  }, [currentFolderId, openFolder, safeFolderTrail, storageAvailable]);

  useEffect(() => {
    if (!storageAvailable || browserLoading || safeBrowserItems.length === 0) {
      return;
    }

    const foldersToPrefetch = safeBrowserItems
      .filter((item) => isFolder(item))
      .slice(0, PREFETCH_FOLDER_LIMIT);

    if (foldersToPrefetch.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      foldersToPrefetch.forEach((folder) => {
        void prefetchFolder(folder.id, [
          ...safeFolderTrail,
          { id: folder.id, name: folder.name },
        ]);
      });
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [browserLoading, prefetchFolder, safeBrowserItems, safeFolderTrail, storageAvailable]);

  function toggleRowSelection(item: CleanupBrowserItem) {
    setPreview(null);
    setPlannerOpen(false);
    setSelectedTargets((current) => {
      if (current.some((entry) => entry.id === item.id)) {
        return current.filter((entry) => entry.id !== item.id);
      }

      return [...current, item];
    });
  }

  function selectSingleRow(item: CleanupBrowserItem) {
    setPreview(null);
    setPlannerOpen(false);
    setSelectedTargets([item]);
  }

  function toggleAllVisible() {
    setPreview(null);
    setPlannerOpen(false);
    if (allVisibleSelected) {
      setSelectedTargets([]);
      return;
    }

    setSelectedTargets(safeBrowserItems);
  }

  function openBrowserItem(item: CleanupBrowserItem) {
    if (isFolder(item)) {
      const nextTrail = [
        ...safeFolderTrail,
        { id: item.id, name: item.name },
      ];
      void openFolder(item.id, nextTrail, { includeTrail: false });
      return;
    }

    void requestPreviewForTargets([item]);
  }

  function updateEditableRow(
    fileId: string,
    patch: Partial<EditableCleanupRow>,
    options?: {
      deriveFilename?: boolean;
      deriveLocation?: boolean;
    },
  ) {
    const sourceRow = preview?.fileRows.find((row) => row.id === fileId);
    if (!sourceRow) {
      return;
    }

    setEditableRows((current) =>
      current.map((row) => {
        if (row.id !== fileId) {
          return row;
        }

        const next = { ...row, ...patch };
        const nextHouseholdFolder = next.proposedHouseholdFolder;
        const nextDocumentType = next.proposedDocumentType;
        const nextFilename =
          options?.deriveFilename === false
            ? next.proposedFilename
            : mode === "reorganize_only"
              ? sourceRow.sourceName
              : buildDocumentFilenamePlan({
                  accountLast4: next.accountLast4 || null,
                  accountType: next.accountType || null,
                  clientName: next.proposedClientName.trim() || null,
                  clientName2: next.proposedClientName2.trim() || null,
                  custodian: next.custodian || null,
                  detectedClient: sourceRow.detectedClient,
                  documentDate: next.documentDate || null,
                  documentTypeLabel: nextDocumentType,
                  detectedClient2: sourceRow.detectedClient2,
                  entityName: next.entityName || null,
                  extension: detectExtension(sourceRow.sourceName),
                  fallbackName: row.proposedFilename || sourceRow.proposedFilename,
                  householdFolder: nextHouseholdFolder.trim() || null,
                  idType: next.idType || null,
                  ownershipType: next.ownershipType,
                  rules: namingRules,
                  sourceName: sourceRow.sourceName,
                  taxYear: next.taxYear || null,
                });
        const nextLocation =
          options?.deriveLocation === false
            ? next.proposedLocation
            : mode === "rename_only"
              ? sourceRow.currentLocation
              : `${nextHouseholdFolder.trim() || "Needs review"} / ${getCleanupTopLevelFolderForDocumentType(
                  nextDocumentType,
                )}`;

        return {
          ...next,
          proposedClientFolder: nextHouseholdFolder,
          proposedFilename: nextFilename,
          proposedLocation: nextLocation,
        };
      }),
    );
  }

  const activePreviewRow = preview?.fileRows.find((row) => row.id === activePreviewFileId) ?? null;
  const activeEditableRow =
    editableRows.find((row) => row.id === activePreviewFileId) ?? null;
  const activeDocumentTypeId = getDocumentTypeIdFromLabel(
    activeEditableRow?.proposedDocumentType ?? activePreviewRow?.proposedDocumentType ?? "",
  );
  const visibleTokenFields = useMemo(
    () => getVisibleTokenFields(namingRules, activeDocumentTypeId),
    [activeDocumentTypeId, namingRules],
  );
  const documentTypeOptions = useMemo(
    () =>
      getDocumentTypeOptions(
        activeEditableRow?.proposedDocumentType ??
          activePreviewRow?.proposedDocumentType ??
          "",
      ),
    [activeEditableRow?.proposedDocumentType, activePreviewRow?.proposedDocumentType],
  );

  useEffect(() => {
    Object.values(textareaRefs.current).forEach((textarea) => {
      if (!textarea) {
        return;
      }

      textarea.style.height = "0px";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
  }, [editableRows, activePreviewFileId, mode]);

  if (!storageAvailable) {
    return (
      <div className={styles.cleanupLayout}>
        <section className={styles.selectionSection}>
          <div className={styles.noteCard}>
            <strong>{inactiveStorageTitle}</strong>
            <p>{inactiveStorageMessage}</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.cleanupLayout}>
      <section className={styles.selectionSection}>
        <div className={styles.selectionBrowser}>
          <div className={styles.browserBreadcrumbs}>
            <button
              className={styles.breadcrumbButton}
              disabled={currentFolderId === rootBrowserFolderId}
              onClick={() =>
                void openFolder(rootBrowserFolderId, [], { includeTrail: false })
              }
              type="button"
            >
              {rootBrowserFolderName}
            </button>
            {visibleFolderTrail.map((segment, index) => (
              <span key={segment.id} className={styles.breadcrumbWrap}>
                <span className={styles.breadcrumbDivider}>/</span>
                <button
                  className={styles.breadcrumbButton}
                  onClick={() =>
                    openFolder(
                      segment.id,
                      safeFolderTrail.slice(0, index + 1 + rootSegmentOffset),
                      { includeTrail: false },
                    )
                  }
                  type="button"
                >
                  {segment.name}
                </button>
              </span>
            ))}
          </div>

          {browserError ? <p className={styles.errorBox}>{browserError}</p> : null}
          {runNotice ? <p className={styles.successBox}>{runNotice}</p> : null}
          {runError ? <p className={styles.errorBox}>{runError}</p> : null}

          <div className={styles.browserActionBar}>
            <div className={styles.actionGroup}>
              <button
                className={styles.browserActionSecondary}
                disabled={browserLoading || actionLoading}
                onClick={() =>
                  void openFolder(currentFolderId, safeFolderTrail, {
                    forceRefresh: true,
                  })
                }
                type="button"
              >
                {browserLoading ? "Reloading..." : "Reload folder list"}
              </button>
              {safeBrowserItems.length ? (
                <button
                  className={styles.browserActionSecondary}
                  disabled={actionLoading}
                  onClick={toggleAllVisible}
                  type="button"
                >
                  {allVisibleSelected ? "Clear selection" : "Select All"}
                </button>
              ) : null}

              {hasMixedSelection ? null : selectedFileTargets.length > 0 ? (
                <>
                  <button
                    className={styles.browserActionPrimary}
                    disabled={actionLoading}
                    onClick={() =>
                      void analyzeTargets(selectedFileTargets, "files")
                    }
                    type="button"
                  >
                    {actionLoading ? "Analyzing..." : "Analyze selected"}
                  </button>
                  {selectedSuggestionTargets.length > 0 ? (
                    <button
                      className={styles.browserActionSecondary}
                      disabled={actionLoading}
                      onClick={() =>
                        void requestPreviewForTargets([
                          selectedSuggestionTargets[0] as CleanupBrowserItem,
                        ])
                      }
                      type="button"
                    >
                      Review suggestions
                    </button>
                  ) : null}
                  {selectedReadySuggestions.length > 0 ? (
                    <button
                      className={styles.browserActionPrimary}
                      disabled={actionLoading}
                      onClick={() => void applySelectedSuggestions()}
                      type="button"
                    >
                      {actionLoading
                        ? "Applying..."
                        : `Apply suggestions (${selectedReadySuggestions.length})`}
                    </button>
                  ) : null}
                </>
              ) : selectedFolderTargets.length > 0 ? (
                <>
                  <button
                    className={styles.browserActionPrimary}
                    disabled={actionLoading}
                    onClick={() =>
                      void analyzeTargets(selectedFolderTargets, "folders")
                    }
                    type="button"
                  >
                    {actionLoading ? "Analyzing..." : "Analyze folder"}
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className={styles.selectionList}>
            {browserLoading ? (
              <div className={styles.placeholder}>Loading Drive folders...</div>
            ) : !browserLoaded ? (
              <div className={styles.placeholder}>
                Preparing Drive folders...
              </div>
            ) : safeBrowserItems.length === 0 ? (
              <div className={styles.placeholder}>
                Nothing was returned from this folder yet.
              </div>
            ) : (
              safeBrowserItems.map((item) => {
                const folder = isFolder(item);
                const selected = selectedTargets.some(
                  (entry) => entry.id === item.id,
                );
                const cleanup = item.cleanup ?? {
                  currentLocation: currentFolderLabel,
                  status: "needs_analysis" as const,
                };
                const rowActions = folder
                  ? []
                  : getCleanupRowActions(cleanup.status);

                return (
                  <div
                    key={item.id}
                    className={
                      selected ? styles.browserRowSelected : styles.browserRow
                    }
                    onClick={() => selectSingleRow(item)}
                    onDoubleClick={() => openBrowserItem(item)}
                    onFocus={() => {
                      if (folder) {
                        void prefetchFolder(item.id, [
                          ...safeFolderTrail,
                          { id: item.id, name: item.name },
                        ]);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openBrowserItem(item);
                      }
                    }}
                    onMouseEnter={() => {
                      if (folder) {
                        void prefetchFolder(item.id, [
                          ...safeFolderTrail,
                          { id: item.id, name: item.name },
                        ]);
                      }
                    }}
                    tabIndex={0}
                    title={
                      folder
                        ? "Double-click to open this folder"
                        : "Double-click to preview this file"
                    }
                  >
                    <div className={styles.browserRowInner}>
                      <label
                        className={styles.browserCheckboxWrap}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className={styles.visuallyHidden}>
                          {selected ? "Deselect" : "Select"} {item.name}
                        </span>
                        <input
                          checked={selected}
                          className={styles.browserCheckbox}
                          onChange={() => toggleRowSelection(item)}
                          type="checkbox"
                        />
                      </label>

                      <div className={styles.browserRowMain}>
                        {folder ? (
                          <div className={styles.folderRow}>
                            <div className={styles.browserRowTitle}>
                              <FileKindIcon
                                className={styles.browserItemIcon}
                                mimeType={item.mimeType}
                                name={item.name}
                              />
                              <span className={styles.fileName}>{item.name}</span>
                            </div>
                          </div>
                        ) : cleanup.status === "suggestion_ready" ||
                          cleanup.status === "needs_review" ? (
                          <div className={styles.fileComparisonGrid}>
                            <div className={styles.fileComparisonBlock}>
                              <span className={styles.rowLabel}>Original name</span>
                              <div className={styles.fileTitleRow}>
                                <FileKindIcon
                                  className={styles.browserItemIcon}
                                  mimeType={item.mimeType}
                                  name={item.name}
                                />
                                <span className={styles.fileName}>{item.name}</span>
                              </div>
                              <div className={styles.inlineFacts}>
                                <span className={styles.rowLabel}>
                                  Original location
                                </span>
                                <span>
                                  {cleanup.currentLocation ?? currentFolderLabel}
                                </span>
                              </div>
                              {item.createdTime ? (
                                <div className={styles.inlineFacts}>
                                  <span className={styles.rowLabel}>
                                    Uploaded to Drive
                                  </span>
                                  <span>{formatBrowserTimestamp(item.createdTime)}</span>
                                </div>
                              ) : null}
                            </div>

                            <div className={styles.fileComparisonBlock}>
                              <span className={styles.rowLabel}>
                                Proposed file name
                              </span>
                              <span className={styles.proposedValue}>
                                {cleanup.proposedFilename ?? "Needs review"}
                              </span>
                              <div className={styles.inlineFacts}>
                                <span className={styles.rowLabel}>
                                  Proposed location
                                </span>
                                <span>
                                  {cleanup.proposedLocation ?? "Needs review"}
                                </span>
                              </div>
                              <div className={styles.inlineFacts}>
                                <span className={styles.rowLabel}>
                                  Recognized file type
                                </span>
                                <span>
                                  {cleanup.recognizedFileType ?? "Unknown"}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className={styles.fileSimpleRow}>
                            <div className={styles.fileTitleRow}>
                              <FileKindIcon
                                className={styles.browserItemIcon}
                                mimeType={item.mimeType}
                                name={item.name}
                              />
                              <span className={styles.fileName}>{item.name}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {rowActions.length > 0 ? (
                        <div className={styles.rowActionGroup}>
                          {rowActions.map((rowAction) => {
                            const rowActionActive =
                              activeRowAction?.itemId === item.id &&
                              activeRowAction.kind === rowAction.kind;
                            const rowActionDisabled =
                              rowAction.kind !== "complete" &&
                              (actionLoading ||
                                (rowAction.kind === "review" && previewLoading));

                            if (rowAction.kind === "complete") {
                              return (
                                <span
                                  className={styles.completeBadge}
                                  key={rowAction.kind}
                                >
                                  {rowAction.label}
                                </span>
                              );
                            }

                            return (
                              <button
                                className={`${styles.rowActionButton} ${
                                  rowAction.kind === "analyze"
                                    ? styles.rowActionAnalyze
                                    : rowAction.kind === "review"
                                      ? styles.rowActionReview
                                      : styles.rowActionApply
                                }`}
                                disabled={rowActionDisabled}
                                key={rowAction.kind}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (rowAction.kind === "analyze") {
                                    void analyzeTargets([item], "files");
                                  } else if (rowAction.kind === "review") {
                                    void requestPreviewForTargets([item]);
                                  } else if (rowAction.kind === "apply") {
                                    void applySuggestionTargets([item]);
                                  }
                                }}
                                onDoubleClick={(event) => event.stopPropagation()}
                                type="button"
                              >
                                {rowActionActive
                                  ? rowAction.loadingLabel
                                  : rowAction.label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      {plannerOpen && selectedTargets.length ? (
        <div
          className={styles.plannerModalOverlay}
          onClick={() => setPlannerOpen(false)}
          role="presentation"
        >
          <div
            className={styles.plannerModal}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.plannerModalHeader}>
              <div>
                <p className={styles.panelLabel}>Cleanup planner</p>
                <div className={styles.modalTitleRow}>
                  {selectedItem ? (
                    <FileKindIcon
                      className={styles.modalFileKindIcon}
                      mimeType={selectedItem.mimeType}
                      name={selectedItem.name}
                    />
                  ) : null}
                  <h2>{preview?.title ?? "Generate a real cleanup preview"}</h2>
                </div>
              </div>
              <button
                className={styles.modalCloseButton}
                onClick={() => setPlannerOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className={styles.plannerModalGrid}>
              <div className={styles.modalSideColumn}>
                <section className={styles.compactPlannerSection}>
                  <div className={styles.compactControlBlock}>
                    <p className={styles.panelLabel}>Scope</p>
                    <div className={styles.compactChipRow}>
                      {visibleScopeOptions.map((option) => (
                        <button
                          key={option.value}
                          className={
                            option.value === scope
                              ? styles.compactChipActive
                              : styles.compactChip
                          }
                          type="button"
                          onClick={() => setScope(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.compactControlBlock}>
                    <p className={styles.panelLabel}>Mode</p>
                    <div className={styles.compactChipRow}>
                      {modeOptions.map((option) => (
                        <button
                          key={option.value}
                          className={
                            option.value === mode
                              ? styles.compactChipActive
                              : styles.compactChip
                          }
                          type="button"
                          onClick={() => setMode(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <section className={styles.modalSection}>
                  <div className={styles.modalSectionHeader}>
                    <p className={styles.panelLabel}>File plan</p>
                  </div>
                  {preview ? (
                    <>
                      {preview.fileRows.length > 1 ? (
                        <div className={styles.previewFileListCompact}>
                          {preview.fileRows.map((row) => (
                            <button
                              key={row.id}
                              className={
                                row.id === activePreviewFileId
                                  ? styles.previewListRowActive
                                  : styles.previewListRow
                              }
                              onClick={() => setActivePreviewFileId(row.id)}
                              type="button"
                            >
                              <div className={styles.previewListRowTop}>
                                <div className={styles.previewListFileRow}>
                                  <FileKindIcon
                                    className={styles.previewListFileIcon}
                                    mimeType={row.mimeType}
                                    name={row.sourceName}
                                  />
                                  <strong>{row.sourceName}</strong>
                                </div>
                                <span
                                  className={
                                    row.statusLabel === "Needs review"
                                      ? styles.reviewBadge
                                      : styles.readyBadge
                                  }
                                >
                                  {row.statusLabel === "Needs review" ? "Review" : "Ready"}
                                </span>
                              </div>
                              <div className={styles.previewListRowMeta}>
                                <span>{row.detectedDocumentType}</span>
                                <span>{row.confidenceLabel}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {activePreviewRow && activeEditableRow ? (
                        <div className={styles.editFieldsStack}>
                          <div className={styles.planSection}>
                            <p className={styles.planSectionLabel}>Classification</p>
                            <div className={styles.planRows}>
                              <label className={styles.planRow}>
                                <span className={styles.planRowLabel}>Household</span>
                                <div className={styles.planRowControl}>
                                  <select
                                    className={styles.planRowSelect}
                                    onChange={(event) =>
                                      updateEditableRow(
                                        activePreviewRow.id,
                                        {
                                          proposedHouseholdFolder: event.target.value,
                                          proposedClientFolder: event.target.value,
                                        },
                                        {
                                          deriveLocation: true,
                                        },
                                      )
                                    }
                                    value={activeEditableRow.proposedHouseholdFolder}
                                  >
                                    <option value="">Needs review</option>
                                    {preview.clientOptions.map((clientOption) => (
                                      <option key={clientOption} value={clientOption}>
                                        {clientOption}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </label>

                              <label className={styles.planRow}>
                                <span className={styles.planRowLabel}>Client</span>
                                <div className={styles.planRowControl}>
                                  <input
                                    className={styles.planRowInput}
                                    onChange={(event) =>
                                      updateEditableRow(
                                        activePreviewRow.id,
                                        {
                                          proposedClientName: event.target.value,
                                        },
                                        {
                                          deriveFilename: true,
                                        },
                                      )
                                    }
                                    type="text"
                                    value={activeEditableRow.proposedClientName}
                                  />
                                </div>
                              </label>

                              <label className={styles.planRow}>
                                <span className={styles.planRowLabel}>Client 2</span>
                                <div className={styles.planRowControl}>
                                  <input
                                    className={styles.planRowInput}
                                    onChange={(event) =>
                                      updateEditableRow(
                                        activePreviewRow.id,
                                        {
                                          proposedClientName2: event.target.value,
                                        },
                                        {
                                          deriveFilename: true,
                                        },
                                      )
                                    }
                                    type="text"
                                    value={activeEditableRow.proposedClientName2}
                                  />
                                </div>
                              </label>

                              <label className={styles.planRow}>
                                <span className={styles.planRowLabel}>Ownership</span>
                                <div className={styles.planRowControl}>
                                  <select
                                    className={styles.planRowSelect}
                                    onChange={(event) =>
                                      updateEditableRow(
                                        activePreviewRow.id,
                                        {
                                          ownershipType: event.target.value as "single" | "joint",
                                        },
                                        {
                                          deriveFilename: true,
                                        },
                                      )
                                    }
                                    value={activeEditableRow.ownershipType}
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
                                    onChange={(event) =>
                                      updateEditableRow(
                                        activePreviewRow.id,
                                        {
                                          proposedDocumentType: event.target.value,
                                        },
                                        {
                                          deriveFilename: true,
                                          deriveLocation: true,
                                        },
                                      )
                                    }
                                    value={activeEditableRow.proposedDocumentType}
                                  >
                                    {documentTypeOptions.map((documentTypeOption) => (
                                      <option
                                        key={documentTypeOption}
                                        value={documentTypeOption}
                                      >
                                        {documentTypeOption}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </label>
                            </div>
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
                                        onChange={(event) =>
                                          updateEditableRow(
                                            activePreviewRow.id,
                                            {
                                              [field.key]: event.target.value,
                                            } as Partial<EditableCleanupRow>,
                                            {
                                              deriveFilename: true,
                                            },
                                          )
                                        }
                                        type="text"
                                        value={activeEditableRow[field.key]}
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
                                <div className={styles.planRowValue}>
                                  {activePreviewRow.sourceName}
                                </div>
                              </div>
                              <label className={styles.planRow}>
                                <span className={styles.planRowLabel}>Proposed</span>
                                <div className={styles.planRowControl}>
                                  <textarea
                                    className={styles.planRowTextarea}
                                    ref={(node) => {
                                      textareaRefs.current[`${activePreviewRow.id}-filename`] =
                                        node;
                                    }}
                                    onChange={(event) =>
                                      updateEditableRow(
                                        activePreviewRow.id,
                                        {
                                          proposedFilename: event.target.value,
                                        },
                                        {
                                          deriveFilename: false,
                                        },
                                      )
                                    }
                                    rows={1}
                                    value={activeEditableRow.proposedFilename}
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
                                <div className={styles.planRowValue}>
                                  {activePreviewRow.currentLocation}
                                </div>
                              </div>
                              {mode !== "rename_only" ? (
                                <label className={styles.planRow}>
                                  <span className={styles.planRowLabel}>Proposed</span>
                                  <div className={styles.planRowControl}>
                                    <textarea
                                      className={styles.planRowTextarea}
                                      ref={(node) => {
                                        textareaRefs.current[`${activePreviewRow.id}-location`] =
                                          node;
                                      }}
                                      onChange={(event) =>
                                        updateEditableRow(
                                          activePreviewRow.id,
                                          {
                                            proposedLocation: event.target.value,
                                          },
                                          {
                                            deriveLocation: false,
                                          },
                                        )
                                      }
                                      rows={1}
                                      value={activeEditableRow.proposedLocation}
                                    />
                                  </div>
                                </label>
                              ) : null}
                            </div>
                          </div>

                          <details className={styles.diagnosticDetails}>
                            <summary className={styles.diagnosticSummary}>Diagnostics</summary>
                            <div className={styles.planSection}>
                              <div className={styles.planRows}>
                                <div className={styles.planRow}>
                                  <span className={styles.planRowLabel}>Source</span>
                                  <div className={styles.planRowValue}>
                                    {labelForContentSource(activePreviewRow.contentSource)}
                                  </div>
                                </div>
                                {getDiagnosticFieldEntries({
                                  accountLast4: activeEditableRow.accountLast4,
                                  accountType: activeEditableRow.accountType,
                                  client: activePreviewRow.detectedClient,
                                  client2: activePreviewRow.detectedClient2,
                                  custodian: activeEditableRow.custodian,
                                  downloadByteLength: activePreviewRow.downloadByteLength,
                                  downloadSha1: activePreviewRow.downloadSha1,
                                  driveModifiedTime: activePreviewRow.modifiedTime,
                                  driveSize: activePreviewRow.driveSize,
                                  documentDate: activeEditableRow.documentDate,
                                  entityName: activeEditableRow.entityName,
                                  fileId: activePreviewRow.id,
                                  idType: activeEditableRow.idType,
                                  ownershipType: activeEditableRow.ownershipType,
                                  parserConflictSummary: activePreviewRow.parserConflictSummary,
                                  documentSignal: activePreviewRow.debug.documentSignal,
                                  taxYear: activeEditableRow.taxYear,
                                }).map((entry) => (
                                  <div key={entry.label} className={styles.planRow}>
                                    <span className={styles.planRowLabel}>{entry.label}</span>
                                    <div className={styles.planRowValue}>{entry.value}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {activePreviewRow.pdfFields.length ? (
                              <div className={styles.planSection}>
                                <p className={styles.planSectionLabel}>PDF fields</p>
                                <div className={styles.planRows}>
                                  {activePreviewRow.pdfFields.map((field, index) => (
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
                                {activePreviewRow.diagnosticText ||
                                  activePreviewRow.textExcerpt ||
                                  "No extracted text available."}
                              </pre>
                            </div>
                          </details>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className={styles.previewEmptyCompact}>
                      Choose a file to review the proposed cleanup details.
                    </div>
                  )}
                </section>
              </div>

              <section className={styles.previewPanel}>
                {previewLoading && !preview ? (
                  <div className={styles.previewEmpty}>Building a real cleanup preview...</div>
                ) : null}

                {previewError ? (
                  <p className={styles.errorBox}>{previewError}</p>
                ) : null}

                {runError ? (
                  <p className={styles.errorBox}>{runError}</p>
                ) : null}

                {!previewLoading && !previewError && !preview ? (
                  <div className={styles.previewEmpty}>
                    The preview will update automatically once the selection is loaded.
                  </div>
                ) : null}

                {preview ? (
                  <>
                    <div className={styles.documentPreviewPane}>
                      {activePreviewRow ? (
                        <iframe
                          className={styles.documentPreviewFrame}
                          src={
                            activePreviewRow.previewSnapshotId
                              ? `/api/preview/files/${
                                  activePreviewRow.previewSnapshotId
                                }?rev=${encodeURIComponent(
                                  activePreviewRow.downloadSha1 ??
                                    activePreviewRow.modifiedTime ??
                                    activePreviewRow.previewSnapshotId,
                                )}`
                              : `/api/drive/files/${activePreviewRow.id}?rev=${encodeURIComponent(
                                  activePreviewRow.downloadSha1 ??
                                    activePreviewRow.modifiedTime ??
                                    activePreviewRow.id,
                                )}`
                          }
                          title={activePreviewRow.sourceName}
                        />
                      ) : (
                        <div className={styles.previewEmpty}>
                          Select a preview row to see the document.
                        </div>
                      )}
                    </div>

                    <div className={styles.previewActionsDock}>
                      <button
                        className={
                          preview.canRun
                            ? styles.primaryButtonActive
                            : styles.primaryButton
                        }
                        disabled={!preview.canRun || runLoading}
                        onClick={() => void runCleanup()}
                        type="button"
                      >
                        {runLoading ? "Running cleanup..." : "Run cleanup"}
                      </button>
                    </div>
                  </>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isFolder(item: CleanupBrowserItem) {
  return item.mimeType === "application/vnd.google-apps.folder";
}

function getCleanupRowActions(
  status: NonNullable<CleanupBrowserItem["cleanup"]>["status"],
) {
  if (status === "complete") {
    return [{
      kind: "complete" as const,
      label: "Complete",
      loadingLabel: "Complete",
    }];
  }

  if (status === "suggestion_ready") {
    return [
      {
        kind: "review" as const,
        label: "Review",
        loadingLabel: "Opening...",
      },
      {
        kind: "apply" as const,
        label: "Approve",
        loadingLabel: "Approving...",
      },
    ];
  }

  if (status === "needs_review") {
    return [{
      kind: "review" as const,
      label: "Review",
      loadingLabel: "Opening...",
    }];
  }

  return [{
    kind: "analyze" as const,
    label: "Analyze",
    loadingLabel: "Analyzing...",
  }];
}

function formatCleanupCurrentLocation(trail: CleanupFolderTrail) {
  const names = trail
    .map((segment) => segment.name.trim())
    .filter(Boolean);

  if (names.length === 0) {
    return null;
  }

  const clientsIndex = names.findIndex((name) =>
    /^(\d+_)?clients$/i.test(name),
  );
  if (clientsIndex >= 0 && clientsIndex < names.length - 1) {
    return names.slice(clientsIndex + 1).join(" / ");
  }

  const visibleNames = names[0]?.toLowerCase() === "my drive"
    ? names.slice(1)
    : names;
  if (visibleNames.length >= 2) {
    return visibleNames.slice(-2).join(" / ");
  }

  return visibleNames[0] ?? names[0] ?? null;
}

function formatBrowserTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function labelForContentSource(
  contentSource: CleanupPreviewFileRow["contentSource"],
) {
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
  documentSignal?: string | null;
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
    ["Document signal", input.documentSignal],
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

function detectExtension(filename: string) {
  const match = filename.match(/(\.[A-Za-z0-9]+)$/);
  return match?.[1] ?? "";
}
