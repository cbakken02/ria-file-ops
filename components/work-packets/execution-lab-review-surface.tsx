import type {
  ExecutionReviewReference,
  ExecutionReviewViewModel,
} from "@/lib/work-packets/dev-demo/fidelity-toa-execution-review-view-model";
import styles from "./execution-lab-review-surface.module.css";

type ExecutionLabReviewSurfaceProps = {
  viewModel: ExecutionReviewViewModel;
};

export function ExecutionLabReviewSurface({
  viewModel,
}: ExecutionLabReviewSurfaceProps) {
  return (
    <article className={styles.surface}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <p className={styles.eyebrow}>Execution Lab Review</p>
          <h1>{viewModel.header.taskInstruction}</h1>
          <p className={styles.warning}>{viewModel.header.warning}</p>
        </div>

        <dl className={styles.headerMeta} aria-label="Execution run summary">
          <MetaTerm label="Demo ID" value={viewModel.header.demoId} />
          <MetaTerm label="Status" value={viewModel.header.status} />
          <MetaTerm label="Task type" value={viewModel.header.taskType} />
          <MetaTerm label="Created" value={formatTimestamp(viewModel.header.createdAt)} />
        </dl>
      </header>

      <section className={styles.section} aria-labelledby="artifact-refs-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Local artifacts</p>
            <h2 id="artifact-refs-title">Artifact references</h2>
          </div>
          <span className={styles.badge}>Local dev only</span>
        </div>
        <dl className={styles.pathGrid}>
          <MetaTerm
            label="Generated PDF"
            value={viewModel.artifactRefs.generatedPdfPath}
          />
          <MetaTerm
            label="Review JSON"
            value={viewModel.artifactRefs.reviewJsonPath}
          />
          <MetaTerm
            label="Public URL"
            value={viewModel.artifactRefs.publicUrl ?? "None"}
          />
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="task-context-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Task context</p>
            <h2 id="task-context-title">Transfer summary</h2>
          </div>
        </div>
        <dl className={styles.contextGrid}>
          <MetaTerm
            label="Receiving custodian"
            value={viewModel.taskContext.receivingCustodian}
          />
          <MetaTerm
            label="Delivering firm"
            value={viewModel.taskContext.deliveringFirm}
          />
          <MetaTerm
            label="Account type"
            value={viewModel.taskContext.accountTypeSummary}
          />
          <MetaTerm
            label="Transfer instruction"
            value={viewModel.taskContext.transferInstructionSummary}
          />
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="completion-plan-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Completion plan</p>
            <h2 id="completion-plan-title">Field mapping</h2>
            {viewModel.completionPlan.safeSummary ? (
              <p className={styles.sectionSummary}>
                {viewModel.completionPlan.safeSummary}
              </p>
            ) : null}
          </div>
          <span className={styles.badge}>{viewModel.completionPlan.status}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Destination field</th>
                <th>Reference</th>
                <th>Status</th>
                <th>Confidence</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.completionPlan.rows.map((row) => (
                <tr key={row.planFieldId}>
                  <td>
                    <code>{row.destinationField}</code>
                  </td>
                  <td>{formatReference(row.reference)}</td>
                  <td>
                    <span className={statusBadgeClass(row.status)}>
                      {formatToken(row.status)}
                    </span>
                    {row.reviewFlags.length > 0 ? (
                      <div className={styles.inlineFlags}>
                        {row.reviewFlags.map((flag) => (
                          <span key={flag.reviewFlagId}>
                            {flag.severity}: {flag.message}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td>{row.confidence ?? "unknown"}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="fill-trace-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Fill trace</p>
            <h2 id="fill-trace-title">Adapter output</h2>
          </div>
        </div>

        <dl className={styles.metricGrid} aria-label="Fill trace counts">
          <Metric label="Fields filled" value={viewModel.fillTrace.counts.fieldsFilled} />
          <Metric
            label="Options selected"
            value={viewModel.fillTrace.counts.optionsSelected}
          />
          <Metric label="Skipped" value={viewModel.fillTrace.counts.skipped} />
          <Metric label="Errors" value={viewModel.fillTrace.counts.errors} />
        </dl>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Status</th>
                <th>Value ref</th>
                <th>Masked preview</th>
                <th>Option</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.fillTrace.rows.map((row, index) => (
                <tr key={`${row.destinationField}-${index}`}>
                  <td>
                    <code>{row.destinationField}</code>
                  </td>
                  <td>
                    <span className={statusBadgeClass(row.status)}>
                      {formatToken(row.status)}
                    </span>
                  </td>
                  <td>{row.valueRefId ? <code>{row.valueRefId}</code> : "None"}</td>
                  <td>{row.maskedPreview ?? "None"}</td>
                  <td>
                    {row.selectedOption
                      ? formatSelectedOption(row.selectedOption)
                      : "None"}
                  </td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="verification-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Verification</p>
            <h2 id="verification-title">Output checks</h2>
          </div>
          <span className={statusBadgeClass(viewModel.verification.status)}>
            {viewModel.verification.status}
          </span>
        </div>

        <dl className={styles.metricGrid} aria-label="Verification counts">
          <Metric
            label="Text fields expected"
            value={viewModel.verification.expectedTextFieldsFilledCount}
          />
          <Metric
            label="Options expected"
            value={viewModel.verification.expectedOptionsSelectedCount}
          />
          <Metric
            label="Blank fields confirmed"
            value={viewModel.verification.blankFieldsConfirmedCount}
          />
          <Metric label="Issues" value={viewModel.verification.issueCount} />
        </dl>

        {viewModel.verification.issues.length > 0 ? (
          <ul className={styles.flagList}>
            {viewModel.verification.issues.map((issue) => (
              <li key={`${issue.fieldName}-${issue.expectation}`}>
                <strong>{issue.fieldName}</strong>
                <span>{issue.safeMessage}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyText}>No verification issues reported.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="review-flags-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Review flags</p>
            <h2 id="review-flags-title">Human checks</h2>
          </div>
          <span className={styles.badge}>{viewModel.reviewFlags.length} flags</span>
        </div>
        <ul className={styles.flagList}>
          {viewModel.reviewFlags.map((flag) => (
            <li key={flag.reviewFlagId}>
              <strong>{formatToken(flag.severity)}</strong>
              <span>{flag.message}</span>
            </li>
          ))}
        </ul>
      </section>

      <details className={styles.debugDetails}>
        <summary>View safe debug JSON</summary>
        <pre>{JSON.stringify(viewModel, null, 2)}</pre>
      </details>
    </article>
  );
}

function MetaTerm({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaTerm}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatReference(reference: ExecutionReviewReference) {
  if (reference.referenceKind === "value_ref") {
    return (
      <span className={styles.referenceStack}>
        <code>{reference.valueRefId}</code>
        {reference.maskedPreview ? <span>{reference.maskedPreview}</span> : null}
      </span>
    );
  }

  if (reference.referenceKind === "option_ref") {
    return (
      <span className={styles.referenceStack}>
        <code>{reference.optionRef}</code>
        {reference.label ? <span>{reference.label}</span> : null}
        {reference.valueRefId ? <code>{reference.valueRefId}</code> : null}
      </span>
    );
  }

  if (reference.referenceKind === "intentionally_blank") {
    return "Intentionally blank";
  }

  return "None";
}

function formatSelectedOption(option: { label?: string; exportValue?: string }) {
  const exportValue = option.exportValue ? `export ${option.exportValue}` : null;
  return [option.label, exportValue].filter(Boolean).join(" | ") || "Selected";
}

function statusBadgeClass(status: string) {
  if (status === "passed" || status === "confirmed" || status === "filled") {
    return `${styles.statusBadge} ${styles.statusGood}`;
  }

  if (status === "failed" || status === "error") {
    return `${styles.statusBadge} ${styles.statusBad}`;
  }

  if (status === "manual_review") {
    return `${styles.statusBadge} ${styles.statusWarn}`;
  }

  return styles.statusBadge;
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatToken(value: string) {
  return value.replaceAll("_", " ");
}
