import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExecutionLabReviewSurface } from "@/components/work-packets/execution-lab-review-surface";
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
        <p className={styles.eyebrow}>Dev-only Execution Lab</p>
        <h1>Jon Smith Fidelity TOA review</h1>
        <p>
          Fake-data surface for running and inspecting a protected Jon Smith TOA
          completion demo without using real client data.
        </p>
        <div className={styles.runMeta}>
          <span>
            Selected run:{" "}
            <strong>
              {selectedArtifact?.id ?? WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID}
            </strong>
          </span>
          <span>Storage: {selectedArtifact?.source ?? "temporary website"}</span>
          {availableArtifacts.length > 0 ? (
            <span>{availableArtifacts.length} artifact available</span>
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
      <div>
        <p className={styles.eyebrow}>Website-run demo</p>
        <h2 id="demo-action-title">Run Jon Smith TOA Demo</h2>
        <p>
          Upload the Fidelity TOA template for this fake-data run. The server
          fills, verifies, and stores the generated PDF in temporary demo memory
          for this signed-in owner session.
        </p>
        <StatusNotice status={status} />
      </div>
      <form action={runJonSmithFidelityToaWebsiteDemoAction} className={styles.runForm}>
        <label>
          Fidelity TOA PDF template
          <input name="templatePdf" type="file" accept="application/pdf" required />
        </label>
        <button type="submit">Run Jon Smith TOA Demo</button>
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
          <span>Open and download links appear after a website-run demo.</span>
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
    invalid_template: "The uploaded file must be a valid PDF under the demo size limit.",
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
      <p className={styles.eyebrow}>No review artifact loaded</p>
      <h1>Run the website demo first.</h1>
      <p>
        Upload the Fidelity TOA template above and run the protected fake-data
        demo. Local development can still build the terminal artifact with:
      </p>
      <pre>node scripts/run-work-packets-fidelity-toa-demo.mjs</pre>
    </section>
  );
}

function normalizeStatus(value: string | string[] | undefined) {
  const status = Array.isArray(value) ? value[0] : value;
  return status?.trim() || null;
}
