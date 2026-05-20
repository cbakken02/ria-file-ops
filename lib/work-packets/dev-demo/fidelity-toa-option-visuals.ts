export const JON_SMITH_FIDELITY_TOA_OPTION_VISUAL_DEBUG_DIR =
  "local-dev/generated/option-mapping/visual-debug";

export type JonSmithFidelityToaOptionVisualTargetKey =
  | "typeTraditionalIra"
  | "type2TraditionalIra"
  | "transFullInKind";

export type PdfVisualDiffBounds = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

export type PdfVisualDiffPoint = {
  x: number;
  y: number;
};

export type PdfOptionVisualDiffCandidate = {
  fieldName: "Type" | "Type2" | "Trans" | string;
  exportValue: string;
  probePdfPath: string;
  changedPixelCount: number;
  pdfBounds?: PdfVisualDiffBounds;
  pdfCenter?: PdfVisualDiffPoint;
  renderedImagePath?: string;
  diffImagePath?: string;
  error?: string;
};

export type PdfOptionVisualTargetResult = {
  field: "Type" | "Type2" | "Trans";
  exportValue: string | null;
  confidence: "high" | "manual_review_required";
  evidence: string;
  debug?: {
    changedPixelCount?: number;
    pdfCenter?: PdfVisualDiffPoint;
    pdfBounds?: PdfVisualDiffBounds;
    renderedImagePath?: string;
    diffImagePath?: string;
    candidateCount: number;
  };
};

export type JonSmithFidelityToaOptionVisualReport = Record<
  JonSmithFidelityToaOptionVisualTargetKey,
  PdfOptionVisualTargetResult
>;

type OptionVisualTarget = {
  key: JonSmithFidelityToaOptionVisualTargetKey;
  field: "Type" | "Type2" | "Trans";
  visibleLabel: string;
  targetRegion: PdfVisualDiffBounds;
  minChangedPixelCount: number;
};

const OPTION_VISUAL_TARGETS: OptionVisualTarget[] = [
  {
    key: "typeTraditionalIra",
    field: "Type",
    visibleLabel: "receiving account Traditional, SEP, or Rollover IRA checkbox",
    targetRegion: {
      xMin: 150,
      yMin: 500,
      xMax: 176,
      yMax: 522,
    },
    minChangedPixelCount: 20,
  },
  {
    key: "type2TraditionalIra",
    field: "Type2",
    visibleLabel: "delivering account Traditional, SEP, or Rollover IRA checkbox",
    targetRegion: {
      xMin: 420,
      yMin: 500,
      xMax: 446,
      yMax: 522,
    },
    minChangedPixelCount: 20,
  },
  {
    key: "transFullInKind",
    field: "Trans",
    visibleLabel: "Section 3.A option 1 Transfer the entire account, in kind checkbox",
    targetRegion: {
      xMin: 30,
      yMin: 214,
      xMax: 56,
      yMax: 237,
    },
    minChangedPixelCount: 20,
  },
];

export function classifyJonSmithFidelityToaOptionVisuals(
  candidates: PdfOptionVisualDiffCandidate[],
): JonSmithFidelityToaOptionVisualReport {
  return Object.fromEntries(
    OPTION_VISUAL_TARGETS.map((target) => [
      target.key,
      classifyTarget(target, candidates),
    ]),
  ) as JonSmithFidelityToaOptionVisualReport;
}

function classifyTarget(
  target: OptionVisualTarget,
  candidates: PdfOptionVisualDiffCandidate[],
): PdfOptionVisualTargetResult {
  const fieldCandidates = candidates.filter(
    (candidate) => candidate.fieldName === target.field,
  );
  const matches = fieldCandidates.filter((candidate) =>
    candidateMatchesTarget(candidate, target),
  );

  if (matches.length !== 1) {
    return {
      field: target.field,
      exportValue: null,
      confidence: "manual_review_required",
      evidence:
        matches.length === 0
          ? `No ${target.field} probe diff aligned with the ${target.visibleLabel}.`
          : `Multiple ${target.field} probe diffs aligned with the ${target.visibleLabel}; manual review required.`,
      debug: {
        candidateCount: fieldCandidates.length,
      },
    };
  }

  const match = matches[0];

  return {
    field: target.field,
    exportValue: match.exportValue,
    confidence: "high",
    evidence: `Diff region aligns with the ${target.visibleLabel}.`,
    debug: {
      changedPixelCount: match.changedPixelCount,
      pdfCenter: match.pdfCenter,
      pdfBounds: match.pdfBounds,
      renderedImagePath: match.renderedImagePath,
      diffImagePath: match.diffImagePath,
      candidateCount: fieldCandidates.length,
    },
  };
}

function candidateMatchesTarget(
  candidate: PdfOptionVisualDiffCandidate,
  target: OptionVisualTarget,
): boolean {
  if (candidate.error || !candidate.pdfCenter) {
    return false;
  }

  return (
    candidate.changedPixelCount >= target.minChangedPixelCount &&
    pointInBounds(candidate.pdfCenter, target.targetRegion)
  );
}

function pointInBounds(point: PdfVisualDiffPoint, bounds: PdfVisualDiffBounds): boolean {
  return (
    point.x >= bounds.xMin &&
    point.x <= bounds.xMax &&
    point.y >= bounds.yMin &&
    point.y <= bounds.yMax
  );
}
