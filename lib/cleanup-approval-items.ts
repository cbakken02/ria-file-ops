import { filingCandidateFromCleanupState } from "@/lib/cleanup-file-state";
import type { CleanupFileState } from "@/lib/cleanup-types";
import type { FileApprovalItem } from "@/lib/file-approval";
import type { FilingCandidateSuccess } from "@/lib/filing";

export function buildCleanupApprovalItemsFromStates(input: {
  onSuccess?: (
    state: CleanupFileState,
    success: FilingCandidateSuccess,
  ) => Promise<void> | void;
  requestedFileIds: string[];
  states: CleanupFileState[];
}): FileApprovalItem[] {
  const statesByFileId = new Map(input.states.map((state) => [state.fileId, state]));

  return input.requestedFileIds.map((fileId) => {
    const state = statesByFileId.get(fileId);

    if (!state) {
      return {
        errorMessage: "No Clean Up suggestion exists for this file yet.",
        fileId,
        sourceName: fileId,
      };
    }

    if (state.status === "complete") {
      return {
        alreadyComplete: true,
        fileId: state.fileId,
        filedFilename: state.proposedFilename ?? state.sourceName,
        sourceName: state.sourceName,
      };
    }

    if (state.status !== "suggestion_ready") {
      return {
        errorMessage:
          state.status === "needs_review"
            ? "Review this Clean Up suggestion before applying it."
            : "Analyze this file before applying Clean Up.",
        fileId: state.fileId,
        sourceName: state.sourceName,
      };
    }

    const candidate = filingCandidateFromCleanupState(state);
    if (!candidate) {
      return {
        errorMessage: "This Clean Up suggestion is missing a filename or destination.",
        fileId: state.fileId,
        sourceName: state.sourceName,
      };
    }

    return {
      candidate,
      fileId: state.fileId,
      filedFilename: candidate.finalFilename ?? state.sourceName,
      onSuccess: (success) => input.onSuccess?.(state, success),
      sourceName: state.sourceName,
    };
  });
}
