import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
  assertJonSmithFidelityToaReviewArtifactIsSafe,
  type JonSmithFidelityToaReviewArtifact,
} from "@/lib/work-packets/dev-demo/fidelity-toa-review-artifact";
import {
  buildExecutionReviewViewModelFromArtifact,
  type ExecutionReviewViewModel,
} from "@/lib/work-packets/dev-demo/fidelity-toa-execution-review-view-model";

export const LOCAL_EXECUTION_REVIEW_ARTIFACT_DIR = "local-dev/generated";
export const DEFAULT_LOCAL_EXECUTION_REVIEW_ARTIFACT_ID =
  "jon-smith-fidelity-toa";

export type LocalExecutionReviewArtifactId =
  typeof DEFAULT_LOCAL_EXECUTION_REVIEW_ARTIFACT_ID;

export type LocalExecutionReviewArtifactSummary = {
  id: LocalExecutionReviewArtifactId;
  label: string;
  title: string;
  artifactPath: string;
  generatedPdfPath?: string;
  status?: JonSmithFidelityToaReviewArtifact["metadata"]["status"];
  createdAt?: string;
};

type LocalExecutionReviewArtifactDescriptor = {
  id: LocalExecutionReviewArtifactId;
  label: string;
  title: string;
  fileName: string;
};

export class LocalExecutionReviewArtifactRegistryError extends Error {
  readonly code:
    | "invalid_artifact_id"
    | "unknown_artifact_id"
    | "unsafe_artifact_path"
    | "missing_artifact"
    | "invalid_artifact";

  constructor(
    message: string,
    code:
      | "invalid_artifact_id"
      | "unknown_artifact_id"
      | "unsafe_artifact_path"
      | "missing_artifact"
      | "invalid_artifact",
  ) {
    super(message);
    this.name = "LocalExecutionReviewArtifactRegistryError";
    this.code = code;
  }
}

const LOCAL_EXECUTION_REVIEW_ARTIFACTS: LocalExecutionReviewArtifactDescriptor[] =
  [
    {
      id: DEFAULT_LOCAL_EXECUTION_REVIEW_ARTIFACT_ID,
      label: "Jon Smith Fidelity TOA",
      title: "Jon Smith Fidelity TOA execution review",
      fileName: path.basename(JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH),
    },
  ];

export function normalizeLocalExecutionReviewArtifactId(
  value: string | string[] | undefined,
): LocalExecutionReviewArtifactId {
  const selected = Array.isArray(value) ? value[0] : value;
  const id = selected?.trim() || DEFAULT_LOCAL_EXECUTION_REVIEW_ARTIFACT_ID;

  assertSafeArtifactId(id);

  const descriptor = descriptorForId(id);
  if (!descriptor) {
    throw new LocalExecutionReviewArtifactRegistryError(
      "Unknown local execution review artifact id.",
      "unknown_artifact_id",
    );
  }

  return descriptor.id;
}

export async function listLocalExecutionReviewArtifacts(): Promise<
  LocalExecutionReviewArtifactSummary[]
> {
  let fileNames: Set<string>;

  try {
    fileNames = new Set(await readdir(LOCAL_EXECUTION_REVIEW_ARTIFACT_DIR));
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const summaries = await Promise.all(
    LOCAL_EXECUTION_REVIEW_ARTIFACTS.filter((descriptor) =>
      fileNames.has(descriptor.fileName),
    ).map(async (descriptor) => summarizeDescriptor(descriptor)),
  );

  return summaries
    .filter((summary): summary is LocalExecutionReviewArtifactSummary =>
      Boolean(summary),
    )
    .sort((left, right) => right.createdAt?.localeCompare(left.createdAt ?? "") ?? 0);
}

export async function loadLocalExecutionReviewViewModelById(
  id: string | string[] | undefined,
): Promise<{
  artifact: LocalExecutionReviewArtifactSummary;
  availableArtifacts: LocalExecutionReviewArtifactSummary[];
  viewModel: ExecutionReviewViewModel;
}> {
  const normalizedId = normalizeLocalExecutionReviewArtifactId(id);
  const descriptor = descriptorForId(normalizedId);

  if (!descriptor) {
    throw new LocalExecutionReviewArtifactRegistryError(
      "Unknown local execution review artifact id.",
      "unknown_artifact_id",
    );
  }

  const artifactPath = localGeneratedJsonPathForDescriptor(descriptor);
  const artifact = await readReviewArtifact(artifactPath);
  const viewModel = buildExecutionReviewViewModelFromArtifact(artifact, {
    reviewJsonPath: artifactPath,
  });
  const availableArtifacts = await listLocalExecutionReviewArtifacts();

  return {
    artifact: summaryForArtifact(descriptor, artifact, artifactPath),
    availableArtifacts,
    viewModel,
  };
}

function assertSafeArtifactId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new LocalExecutionReviewArtifactRegistryError(
      "Local execution review artifact id must be a stable id, not a path.",
      "invalid_artifact_id",
    );
  }
}

function descriptorForId(
  id: string,
): LocalExecutionReviewArtifactDescriptor | undefined {
  return LOCAL_EXECUTION_REVIEW_ARTIFACTS.find(
    (descriptor) => descriptor.id === id,
  );
}

async function summarizeDescriptor(
  descriptor: LocalExecutionReviewArtifactDescriptor,
): Promise<LocalExecutionReviewArtifactSummary | null> {
  const artifactPath = localGeneratedJsonPathForDescriptor(descriptor);

  try {
    const artifact = await readReviewArtifact(artifactPath);
    return summaryForArtifact(descriptor, artifact, artifactPath);
  } catch (error) {
    if (error instanceof LocalExecutionReviewArtifactRegistryError) {
      return null;
    }

    throw error;
  }
}

function summaryForArtifact(
  descriptor: LocalExecutionReviewArtifactDescriptor,
  artifact: JonSmithFidelityToaReviewArtifact,
  artifactPath: string,
): LocalExecutionReviewArtifactSummary {
  return {
    id: descriptor.id,
    label: descriptor.label,
    title: descriptor.title,
    artifactPath,
    generatedPdfPath: artifact.metadata.generatedOutputPdfPath,
    status: artifact.metadata.status,
    createdAt: artifact.metadata.createdAt,
  };
}

async function readReviewArtifact(
  artifactPath: string,
): Promise<JonSmithFidelityToaReviewArtifact> {
  let contents: string;

  try {
    contents = await readFile(artifactPath, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      throw new LocalExecutionReviewArtifactRegistryError(
        "Local execution review artifact was not found.",
        "missing_artifact",
      );
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new LocalExecutionReviewArtifactRegistryError(
      "Local execution review artifact is not valid JSON.",
      "invalid_artifact",
    );
  }

  if (!isJonSmithReviewArtifact(parsed)) {
    throw new LocalExecutionReviewArtifactRegistryError(
      "Local execution review artifact has an unsupported shape.",
      "invalid_artifact",
    );
  }

  assertJonSmithFidelityToaReviewArtifactIsSafe(parsed);
  return parsed;
}

function localGeneratedJsonPathForDescriptor(
  descriptor: LocalExecutionReviewArtifactDescriptor,
): string {
  return resolveLocalGeneratedJsonPath(descriptor.fileName);
}

function resolveLocalGeneratedJsonPath(fileName: string): string {
  if (fileName !== path.basename(fileName)) {
    throw new LocalExecutionReviewArtifactRegistryError(
      "Local execution review artifact file name must not include a path.",
      "unsafe_artifact_path",
    );
  }

  const generatedDir = path.resolve(process.cwd(), LOCAL_EXECUTION_REVIEW_ARTIFACT_DIR);
  const resolvedPath = path.resolve(generatedDir, fileName);
  const relative = path.relative(generatedDir, resolvedPath);

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !resolvedPath.toLowerCase().endsWith(".json")
  ) {
    throw new LocalExecutionReviewArtifactRegistryError(
      "Local execution review artifact path must stay under local-dev/generated.",
      "unsafe_artifact_path",
    );
  }

  return path.join(LOCAL_EXECUTION_REVIEW_ARTIFACT_DIR, fileName);
}

function isJonSmithReviewArtifact(
  value: unknown,
): value is JonSmithFidelityToaReviewArtifact {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    artifactType?: unknown;
    artifactVersion?: unknown;
    metadata?: unknown;
    completionPlanSummary?: unknown;
    fillTrace?: unknown;
    verificationSummary?: unknown;
    safety?: unknown;
  };

  return (
    candidate.artifactType === "jon_smith_fidelity_toa_execution_review" &&
    candidate.artifactVersion === 1 &&
    typeof candidate.metadata === "object" &&
    typeof candidate.completionPlanSummary === "object" &&
    typeof candidate.fillTrace === "object" &&
    typeof candidate.verificationSummary === "object" &&
    typeof candidate.safety === "object"
  );
}
