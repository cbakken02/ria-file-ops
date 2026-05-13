import "server-only";

import {
  getCleanupFileStatesByOwnerAndFileIds,
  getClientMemoryRulesByOwnerEmail,
  markCleanupFileStateComplete,
} from "@/lib/db";
import { buildCleanupApprovalItemsFromStates } from "@/lib/cleanup-approval-items";
import {
  FileApprovalUserError,
  approveFileItems,
  type FileApprovalItem,
  type FileApprovalResult,
} from "@/lib/file-approval";
import {
  applyCleanupOverrides,
  buildCleanupPlan,
  type CleanupOverride,
} from "@/lib/cleanup-preview";
import type { CleanupMode, CleanupScope } from "@/lib/cleanup-types";
import type { FilingCandidate } from "@/lib/filing";

const CLEANUP_REVALIDATE_PATHS = ["/clean-up", "/history", "/dashboard", "/intake"];

export async function applyCleanupSuggestionsForIds(input: {
  fileIds: string[];
}): Promise<FileApprovalResult> {
  return approveFileItems({
    fileIds: input.fileIds,
    labels: {
      actionNoun: "Clean Up apply",
      authNotice: "Sign in before applying Clean Up suggestions.",
      noCandidatesNotice: "No selected files have ready Clean Up suggestions to apply.",
      settingsNotice: "Choose a destination root in Settings before applying suggestions.",
      storageNotice: "Reconnect storage before applying Clean Up suggestions.",
      writeAccessNotice:
        "Reconnect the active storage connection with write access before applying Clean Up suggestions.",
    },
    revalidatePaths: CLEANUP_REVALIDATE_PATHS,
    resolveItems: ({ ownerEmail, requestedFileIds }) => {
      const states = getCleanupFileStatesByOwnerAndFileIds(
        ownerEmail,
        requestedFileIds,
      );

      return buildCleanupApprovalItemsFromStates({
        onSuccess: (_state, success) => {
          markCleanupFileStateComplete({
            appliedFilingEventId: success.eventId,
            completedAt: success.completedAt,
            fileId: success.fileId,
            ownerEmail,
          });
        },
        requestedFileIds,
        states,
      });
    },
    validateSettings: (settings) =>
      !settings.destinationFolderId
        ? "Choose a destination root in Settings before applying suggestions."
        : null,
  });
}

export async function runCleanupPlanForIds(input: {
  mode: CleanupMode;
  overrides: CleanupOverride[];
  scope: CleanupScope;
  selectedIds: string[];
}): Promise<FileApprovalResult> {
  return approveFileItems({
    fileIds: input.selectedIds,
    labels: {
      actionNoun: "Clean Up",
      authNotice: "Sign in before running Clean Up.",
      noCandidatesNotice: "Nothing in this selection is ready to clean yet.",
      settingsNotice: "Choose a destination root in Settings before running Clean Up.",
      storageNotice: "Reconnect storage before running Clean Up.",
      writeAccessNotice:
        "Reconnect the active storage connection with write access before running Clean Up.",
    },
    revalidatePaths: CLEANUP_REVALIDATE_PATHS,
    resolveItems: async ({ activeConnection, ownerEmail, settings }) => {
      const plan = await buildCleanupPlan({
        accessToken: activeConnection.accessToken,
        clientMemoryRules: getClientMemoryRulesByOwnerEmail(ownerEmail),
        mode: input.mode,
        scope: input.scope,
        selectedIds: input.selectedIds,
        settings,
      });
      const filingCandidates = applyCleanupOverrides({
        filingCandidates: plan.filingCandidates,
        overrides: input.overrides,
      });

      if (!plan.preview.executionSupported || filingCandidates.length === 0) {
        throw new FileApprovalUserError(
          plan.preview.blockedCount > 0
            ? "Clean Up cannot run yet because some files still need review in the preview."
            : "Nothing in this selection is ready to clean yet.",
        );
      }

      return filingCandidates.map((candidate) =>
        buildApprovalItemFromCleanupCandidate(candidate, ownerEmail),
      );
    },
    validateSettings: (settings) =>
      !settings.destinationFolderId
        ? "Choose a destination root in Settings before running Clean Up."
        : null,
  });
}

function buildApprovalItemFromCleanupCandidate(
  candidate: FilingCandidate,
  ownerEmail: string,
): FileApprovalItem {
  return {
    candidate,
    fileId: candidate.fileId,
    filedFilename: candidate.finalFilename ?? candidate.sourceName,
    onSuccess: (success) => {
      markCleanupFileStateComplete({
        appliedFilingEventId: success.eventId,
        completedAt: success.completedAt,
        fileId: success.fileId,
        ownerEmail,
      });
    },
    sourceName: candidate.sourceName,
  };
}
