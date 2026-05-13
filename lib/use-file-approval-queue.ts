"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type FileApprovalQueuePayload = {
  error?: string;
  failedCount?: number;
  failedItems?: Array<{ fileId: string; sourceName: string; errorMessage: string }>;
  filedItemIds?: string[];
  message?: string;
  notice?: string;
  statusCode?: number;
  succeededCount?: number;
};

type FileApprovalQueueOptions = {
  approveItem: (itemId: string) => Promise<FileApprovalQueuePayload>;
  concurrency?: number;
  onItemFailure?: (input: {
    errorMessage: string;
    itemId: string;
    payload?: FileApprovalQueuePayload | null;
  }) => Promise<void> | void;
  onItemSuccess?: (input: {
    filedItemIds: string[];
    itemId: string;
    payload: FileApprovalQueuePayload;
  }) => Promise<void> | void;
  onQueueSettled?: () => Promise<void> | void;
};

const DEFAULT_CONCURRENCY = 2;

export function useFileApprovalQueue(options: FileApprovalQueueOptions) {
  const optionsRef = useRef(options);
  const processQueueRef = useRef<() => void>(() => {});
  const queuedItemIdsRef = useRef<string[]>([]);
  const pendingItemIdsRef = useRef(new Set<string>());
  const activeCountRef = useRef(0);
  const [pendingItemIds, setPendingItemIds] = useState<string[]>([]);
  const [activeItemIds, setActiveItemIds] = useState<string[]>([]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const syncPendingState = useCallback(() => {
    setPendingItemIds(Array.from(pendingItemIdsRef.current));
  }, []);

  const processQueue = useCallback(() => {
    const concurrency = Math.max(
      1,
      optionsRef.current.concurrency ?? DEFAULT_CONCURRENCY,
    );

    while (
      activeCountRef.current < concurrency &&
      queuedItemIdsRef.current.length > 0
    ) {
      const itemId = queuedItemIdsRef.current.shift();
      if (!itemId) {
        continue;
      }

      activeCountRef.current += 1;
      setActiveItemIds((current) =>
        current.includes(itemId) ? current : [...current, itemId],
      );

      void optionsRef.current
        .approveItem(itemId)
        .then(async (payload) => {
          const filedItemIds = Array.isArray(payload.filedItemIds)
            ? payload.filedItemIds.filter(Boolean)
            : [];
          const hasSuccess =
            filedItemIds.length > 0 || (payload.succeededCount ?? 0) > 0;

          if (payload.error || !hasSuccess) {
            await optionsRef.current.onItemFailure?.({
              errorMessage:
                payload.error ??
                payload.notice ??
                payload.message ??
                "The selected file could not be approved.",
              itemId,
              payload,
            });
            return;
          }

          await optionsRef.current.onItemSuccess?.({
            filedItemIds: filedItemIds.length > 0 ? filedItemIds : [itemId],
            itemId,
            payload,
          });
        })
        .catch(async (error) => {
          await optionsRef.current.onItemFailure?.({
            errorMessage:
              error instanceof Error
                ? error.message
                : "The selected file could not be approved.",
            itemId,
            payload: null,
          });
        })
        .finally(() => {
          activeCountRef.current = Math.max(0, activeCountRef.current - 1);
          pendingItemIdsRef.current.delete(itemId);
          syncPendingState();
          setActiveItemIds((current) =>
            current.filter((activeItemId) => activeItemId !== itemId),
          );

          if (
            activeCountRef.current === 0 &&
            queuedItemIdsRef.current.length === 0
          ) {
            void optionsRef.current.onQueueSettled?.();
          }

          processQueueRef.current();
        });
    }
  }, [syncPendingState]);

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  const enqueue = useCallback(
    (itemIds: string[]) => {
      const nextItemIds = Array.from(new Set(itemIds.filter(Boolean))).filter(
        (itemId) => !pendingItemIdsRef.current.has(itemId),
      );

      if (nextItemIds.length === 0) {
        return [];
      }

      for (const itemId of nextItemIds) {
        pendingItemIdsRef.current.add(itemId);
        queuedItemIdsRef.current.push(itemId);
      }

      syncPendingState();
      processQueue();
      return nextItemIds;
    },
    [processQueue, syncPendingState],
  );

  const pendingItemIdSet = useMemo(
    () => new Set(pendingItemIds),
    [pendingItemIds],
  );
  const activeItemIdSet = useMemo(() => new Set(activeItemIds), [activeItemIds]);

  return {
    activeItemIds,
    enqueue,
    isActive: useCallback(
      (itemId: string) => activeItemIdSet.has(itemId),
      [activeItemIdSet],
    ),
    isPending: useCallback(
      (itemId: string) => pendingItemIdSet.has(itemId),
      [pendingItemIdSet],
    ),
    pendingItemIds,
    pendingCount: pendingItemIds.length,
  };
}
