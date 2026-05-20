import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExecutionLabReviewSurface } from "@/components/work-packets/execution-lab-review-surface";
import {
  FIDELITY_TOA_TEMPLATE_SOURCE_FIELD,
  FIDELITY_TOA_UPLOAD_FIELD,
} from "@/lib/work-packets/dev-demo/execution-lab-template-storage";
import { requireExecutionLabDemoPrincipal } from "@/lib/work-packets/dev-demo/execution-lab-demo-access";
import {
  LocalExecutionReviewArtifactRegistryError,
  loadLocalExecutionReviewViewModelById,
  type LocalExecutionReviewArtifactSummary,
} from "@/lib/work-packets/dev-demo/local-execution-review-artifact-registry";
import {
  WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID,
  WebsiteFidelityToaDemoError,
  listWebsiteFidelityToaDemoArtifacts,
  loadWebsiteFidelityToaDemoViewModelById,
  type WebsiteFidelityToaDemoArtifactSummary,
} from "@/lib/work-packets/dev-demo/website-fidelity-toa-demo";
import { runJonSmithFidelityToaWebsiteDemoAction } from "./actions";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dev Execution Lab | RIA File Ops",
};

export default async function FidelityToaExecutionLabDevPage({
  searchParams,
}: {
  searchParams?: Promise<{
    run?: string | string[];
    status?: string | string[];
  }>;
}) {
  const principal = await requireExecutionLabDemoPrincipal();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  let selectedArtifact: PageExecutionReviewArtifactSummary | null = null;
  let availableArtifacts: PageExecutionReviewArtifactSummary[] =
    listWebsiteFidelityToaDemoArtifacts({
      ownerEmail: principal.legacyOwnerEmail,
    }).map((artifact) => ({ ...artifact, source: "website" as const }));
  let viewModel:
    | Awaited<ReturnType<typeof loadWebsiteFidelityToaDemoViewModelById>>["viewModel"]
    | null = null;
  let isMissingArtifact = false;

  try {
    const result = loadWebsiteFidelityToaDemoViewModelById({
      ownerEmail: principal.legacyOwnerEmail,
      id: resolvedSearchParams?.run,
    });
    selectedArtifact = { ...result.artifact, source: "website" };
    viewModel = result.viewModel;
  } catch (error) {
    if (
      error instanceof WebsiteFidelityToaDemoError &&
      (error.code === "unsafe_artifact_id" ||
        error.code === "unknown_artifact_id" ||
        error.code === "unsafe_artifact")
    ) {
      notFound();
    }

    if (
      error instanceof WebsiteFidelityToaDemoError &&
      error.code === "missing_artifact"
    ) {
      const localResult = await tryLoadLocalArtifact(resolvedSearchParams?.run);

      if (localResult) {
        selectedArtifact = { ...localResult.artifact, source: "local" };
        availableArtifacts = [
          ...availableArtifacts,
          ...localResult.availableArtifacts.map((artifact) => ({
            ...artifact,
            source: "local" as const,
          })),
        ];
        viewModel = localResult.viewModel;
      } else {
        isMissingArtifact = true;
      }
    } else {
      throw error;
    }
  }

  return (
    <main className={styles.page}>
      <PageHeader
        availableArtifacts={availableArtifacts}
        selectedArtifact={selectedArtifact}
      />
      <DemoActionPanel
        selectedArtifact={selectedArtifact}
        status={normalizeStatus(resolvedSearchParams?.status)}
      />
      {isMissingArtifact || !viewModel ? (
        <MissingArtifactState />
      ) : (
        <ExecutionLabReviewSurface viewModel={viewModel} />
      )}
    </main>
  );
}

type PageExecutionReviewArtifactSummary =
  | (WebsiteFidelityToaDemoArtifactSummary & { source: "website" })
  | (LocalExecutionReviewArtifactSummary & { source: "local" });

async function tryLoadLocalArtifact(
  run: string | string[] | undefined,
): Promise<Awaited<ReturnType<typeof loadLocalExecutionReviewViewModelById>> | null> {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  try {
    return await loadLocalExecutionReviewViewModelById(run);
  } catch (error) {
    if (
      error instanceof LocalExecutionReviewArtifactRegistryError &&
      (error.code === "invalid_artifact_id" ||
        error.code === "unknown_artifact_id" ||
        error.code === "unsafe_artifact_path")
    ) {
      notFound();
    }

    if (
      error instanceof LocalExecutionReviewArtifactRegistryError &&
      (error.code === "missing_artifact" || error.code === "invalid_artifact")
    ) {
      return null;
    }

    throw error;
  }
}

function PageHeader({
  availableArtifacts,
  selectedArtifact,
}: {
  availableArtifacts: PageExecutionReviewArtifactSummary[];
  selectedArtifact: PageExecutionReviewArtifactSummary | null;
}) {
  return (
    <header className={styles.header}>
      <div>
        <h1>Jon Smith Fidelity TOA Demo</h1>
        <p>Fake-data PDF completion test</p>
        <div className={styles.pillRow} aria-label="Demo safety labels">
          <span>Dev only</span>
          <span>Admin only</span>
          <span>Fake data</span>
        </div>
        <div className={styles.runMeta}>
          <span>
            Run{" "}
            <strong>{selectedArtifact?.id ?? WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID}</strong>
          </span>
          <span>{selectedArtifact?.source ?? "temporary website"} storage</span>
          {availableArtifacts.length > 0 ? (
            <span>{availableArtifacts.length} artifact</span>
          ) : null}
        </div>
      </div>
      <Link className={styles.backLink} href="/dashboard">
        Dashboard
      </Link>
    </header>
  );
}

function DemoActionPanel({
  selectedArtifact,
  status,
}: {
  selectedArtifact: PageExecutionReviewArtifactSummary | null;
  status: string | null;
}) {
  const websiteArtifact =
    selectedArtifact?.source === "website" ? selectedArtifact : null;

  return (
    <section className={styles.actionPanel} aria-labelledby="demo-action-title">
      <div className={styles.actionCopy}>
        <p className={styles.eyebrow}>Template</p>
        <h2 id="demo-action-title">Run Demo</h2>
        <StatusNotice status={status} />
      </div>
      <form action={runJonSmithFidelityToaWebsiteDemoAction} className={styles.runForm}>
        <fieldset className={styles.templateSourceGroup}>
          <legend>Source</legend>
          <label className={styles.radioChoice}>
            <input
              name={FIDELITY_TOA_TEMPLATE_SOURCE_FIELD}
              type="radio"
              value="stored_template"
              defaultChecked
            />
            Use stored Fidelity TOA template
          </label>
          <label className={styles.radioChoice}>
            <input
              name={FIDELITY_TOA_TEMPLATE_SOURCE_FIELD}
              type="radio"
              value="upload_override"
            />
            Upload one-off override
          </label>
        </fieldset>
        <label>
          Override PDF
          <input name={FIDELITY_TOA_UPLOAD_FIELD} type="file" accept="application/pdf" />
        </label>
        <button type="submit">Run Demo</button>
      </form>
      <div className={styles.artifactActions} aria-label="Generated PDF actions">
        {websiteArtifact ? (
          <>
            <Link href={websiteArtifact.openPdfHref} target="_blank">
              Open PDF
            </Link>
            <Link href={websiteArtifact.downloadPdfHref}>Download PDF</Link>
          </>
        ) : (
          <span>PDF actions appear after a website run.</span>
        )}
      </div>
    </section>
  );
}

function StatusNotice({ status }: { status: string | null }) {
  if (!status) {
    return null;
  }

  const messages: Record<string, string> = {
    run_complete: "Demo run complete. Review the updated artifact below.",
    missing_template: "Upload the Fidelity TOA PDF template before running the demo.",
    stored_template_not_configured:
      "Stored template is not configured yet. Use the upload override or finish Supabase setup.",
    stored_template_missing:
      "Stored template was not found. Use the upload override or upload it to Supabase Storage.",
    stored_template_download_failed:
      "Stored template could not be downloaded. Use the upload override or check storage access.",
    stored_template_invalid_pdf:
      "The selected template must be a valid PDF under the demo size limit.",
    stored_template_runtime_error:
      "Stored template loading failed. Use the upload override or check server logs.",
    invalid_template: "The uploaded file must be a valid PDF under the demo size limit.",
    pdf_fill_runtime_unavailable:
      "The PDF fill runtime is unavailable in this environment.",
    pdf_fill_failed:
      "The uploaded PDF could not be filled by the demo PDF writer.",
    pdf_verify_runtime_unavailable:
      "The PDF verification runtime is unavailable in this environment.",
    pdf_verify_failed:
      "The filled PDF could not be verified by the demo PDF reader.",
    run_failed: "The demo run failed. Try the upload again or check server logs.",
    unsafe_artifact: "The demo was stopped because a safety check failed.",
  };

  return (
    <p className={status === "run_complete" ? styles.statusGoodText : styles.statusBadText}>
      {messages[status] ?? "The demo could not complete."}
    </p>
  );
}

function MissingArtifactState() {
  return (
    <section className={styles.missingState}>
      <p className={styles.eyebrow}>No run yet</p>
      <h2>Upload a Fidelity TOA template and run the fake-data demo.</h2>
    </section>
  );
}

function normalizeStatus(value: string | string[] | undefined) {
  const status = Array.isArray(value) ? value[0] : value;
  return status?.trim() || null;
}
