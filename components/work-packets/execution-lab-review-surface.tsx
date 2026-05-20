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
      <section className={styles.summaryCard} aria-labelledby="review-summary-title">
        <div className={styles.summaryHeader}>
          <div>
            <p className={styles.eyebrow}>Execution review</p>
            <h2 id="review-summary-title">Run summary</h2>
            <p className={styles.taskInstruction}>
              {viewModel.header.taskInstruction}
            </p>
          </div>
          <span className={statusBadgeClass(viewModel.verification.status)}>
            {viewModel.header.displayStatus}
          </span>
        </div>

        <dl className={styles.metricStrip} aria-label="Review summary counts">
          <Metric
            label="Fields filled"
            value={viewModel.fillTrace.counts.fieldsFilled}
          />
          <Metric
            label="Options selected"
            value={viewModel.fillTrace.counts.optionsSelected}
          />
          <Metric label="Skipped" value={viewModel.fillTrace.counts.skipped} />
          <Metric label="Errors" value={viewModel.fillTrace.counts.errors} />
          <Metric label="Issues" value={viewModel.verification.issueCount} />
        </dl>

        <dl className={styles.contextGrid} aria-label="Task context">
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

        <dl className={styles.headerMeta} aria-label="Execution metadata">
          <MetaTerm label="Demo ID" value={viewModel.header.demoId} />
          <MetaTerm label="Status" value={viewModel.header.displayStatus} />
          <MetaTerm label="Task type" value={viewModel.header.taskType} />
          <MetaTerm label="Created" value={formatTimestamp(viewModel.header.createdAt)} />
          <MetaTerm
            label="Generated PDF"
            value={viewModel.artifactRefs.generatedPdfPath}
          />
        </dl>

        <p className={styles.warning}>{viewModel.header.warning}</p>
      </section>

      <section className={styles.section} aria-labelledby="plan-snapshot-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Completion plan</p>
            <h2 id="plan-snapshot-title">Mapped fields</h2>
          </div>
          <span className={statusBadgeClass(viewModel.verification.status)}>
            {viewModel.completionPlan.displayStatus}
          </span>
        </div>

        <dl className={styles.metricGrid} aria-label="Completion plan summary">
          <Metric
            label="Mapped"
            value={viewModel.completionPlan.summary.mappedFields}
          />
          <Metric
            label="Confirmed"
            value={viewModel.completionPlan.summary.confirmedRows}
          />
          <Metric
            label="Manual review"
            value={viewModel.completionPlan.summary.manualReviewRows}
          />
          <Metric
            label="Blank"
            value={viewModel.completionPlan.summary.intentionallyBlankRows}
          />
        </dl>

        <p className={styles.sectionSummary}>
          Full completion-plan detail is available below.{" "}
          {viewModel.completionPlan.summary.hiddenDebugWarnings > 0
            ? `${viewModel.completionPlan.summary.hiddenDebugWarnings} scaffold/debug warnings are hidden from the main view.`
            : "No scaffold/debug warnings are hidden."}
        </p>
      </section>

      <details className={styles.detailsSection}>
        <summary>
          <span>Full completion plan</span>
          <span className={styles.badge}>
            {viewModel.completionPlan.summary.totalRows} rows
          </span>
        </summary>
        {viewModel.completionPlan.safeSummary ? (
          <p className={styles.sectionSummary}>
            {viewModel.completionPlan.safeSummary}
          </p>
        ) : null}

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
                            {flag.count && flag.count > 1 ? ` (${flag.count})` : ""}
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
      </details>

      <details className={styles.detailsSection}>
        <summary>
          <span>Fill trace</span>
          <span className={styles.badge}>
            {viewModel.fillTrace.rows.length} rows
          </span>
        </summary>

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
      </details>

      <section className={styles.section} aria-labelledby="verification-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Verification</p>
            <h2 id="verification-title">Output checks</h2>
          </div>
          <span className={statusBadgeClass(viewModel.verification.status)}>
            {viewModel.verification.displayStatus}
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
          <div className={styles.sectionBadges}>
            <span className={styles.badge}>{viewModel.reviewFlags.length} shown</span>
            {viewModel.debugWarnings.hiddenCount > 0 ? (
              <span className={styles.badge}>
                {viewModel.debugWarnings.hiddenCount} hidden
              </span>
            ) : null}
          </div>
        </div>
        {viewModel.reviewFlags.length > 0 ? (
          <ul className={styles.flagList}>
            {viewModel.reviewFlags.map((flag) => (
              <li key={flag.reviewFlagId}>
                <strong>{formatToken(flag.severity)}</strong>
                <span>
                  {flag.message}
                  {flag.count && flag.count > 1 ? ` (${flag.count})` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyText}>No primary human-review flags.</p>
        )}

        {viewModel.debugWarnings.hiddenCount > 0 ? (
          <details className={styles.nestedDetails}>
            <summary>
              Debug warnings hidden from main view
              <span className={styles.badge}>
                {viewModel.debugWarnings.hiddenCount}
              </span>
            </summary>
            <ul className={styles.flagList}>
              {viewModel.debugWarnings.groups.map((warning) => (
                <li key={warning.reviewFlagId}>
                  <strong>{formatToken(warning.severity)}</strong>
                  <span>
                    {warning.message}
                    {warning.count && warning.count > 1
                      ? ` (${warning.count} fields)`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <details className={styles.detailsSection}>
        <summary>
          <span>Artifact references</span>
          <span className={styles.badge}>safe refs</span>
        </summary>
        <dl className={styles.pathGrid}>
          <MetaTerm
            label="Template source"
            value={formatToken(viewModel.artifactRefs.templateSource)}
          />
          <MetaTerm
            label="Template ID"
            value={viewModel.artifactRefs.templateId ?? "None"}
          />
          <MetaTerm
            label="Template SHA-256"
            value={viewModel.artifactRefs.templateSha256 ?? "None"}
          />
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
      </details>

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
