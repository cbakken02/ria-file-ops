import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
  JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
  buildJonSmithFidelityToaDemo,
  resolveJonSmithFidelityToaFakeValue,
} from "../lib/work-packets/dev-demo/jon-smith-fidelity-toa.ts";
import {
  JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
  buildJonSmithFidelityToaOptionMappingProbes,
} from "../lib/work-packets/dev-demo/fidelity-toa-option-mapping.ts";
import {
  classifyJonSmithFidelityToaOptionVisuals,
} from "../lib/work-packets/dev-demo/fidelity-toa-option-visuals.ts";
import {
  JonSmithFidelityToaVerificationError,
  readPdfFieldValuesWithPdfLib,
  readPdfFieldValuesWithPypdf,
  verifyJonSmithFidelityToaFieldValues,
} from "../lib/work-packets/dev-demo/fidelity-toa-output-verification.ts";
import {
  JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
  JonSmithFidelityToaReviewArtifactError,
  assertLocalDevGeneratedJsonOutputPath,
  buildJonSmithFidelityToaReviewArtifact,
  writeJonSmithFidelityToaReviewArtifact,
} from "../lib/work-packets/dev-demo/fidelity-toa-review-artifact.ts";
import {
  JonSmithFidelityToaReviewViewModelError,
  buildExecutionReviewViewModelFromArtifact,
  loadJonSmithFidelityToaExecutionReviewViewModel,
} from "../lib/work-packets/dev-demo/fidelity-toa-execution-review-view-model.ts";
import {
  DEFAULT_LOCAL_EXECUTION_REVIEW_ARTIFACT_ID,
  LocalExecutionReviewArtifactRegistryError,
  listLocalExecutionReviewArtifacts,
  loadLocalExecutionReviewViewModelById,
  normalizeLocalExecutionReviewArtifactId,
} from "../lib/work-packets/dev-demo/local-execution-review-artifact-registry.ts";
import {
  EXECUTION_LAB_TEMPLATE_BUCKET,
  FIDELITY_TOA_STORED_TEMPLATE_ID,
  FIDELITY_TOA_STORED_TEMPLATE_OBJECT_PATH,
  StoredExecutionLabTemplateError,
  getStoredExecutionLabTemplateStatusForError,
  loadStoredFidelityToaTemplate,
  normalizeFidelityToaTemplateSource,
  resolveFidelityToaTemplateForWebsiteRun,
} from "../lib/work-packets/dev-demo/execution-lab-template-storage.ts";
import {
  WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID,
  WebsiteFidelityToaDemoError,
  assertValidTemplatePdfBuffer,
  classifyWebsiteFidelityToaDemoRuntimeError,
  getWebsiteFidelityToaDemoStatusForError,
  listWebsiteFidelityToaDemoArtifacts,
  loadWebsiteFidelityToaDemoViewModelById,
  normalizeWebsiteFidelityToaDemoArtifactId,
  readWebsiteFidelityToaDemoPdf,
  runWebsiteJonSmithFidelityToaDemo,
} from "../lib/work-packets/dev-demo/website-fidelity-toa-demo.ts";
import {
  PdfFillAdapterError,
  assertLocalDevGeneratedOutputPath,
  fillPdfBufferFromCompletionPlan,
  fillPdfFromCompletionPlan,
} from "../lib/work-packets/pdf-fill-adapter.ts";
import {
  PdfOptionMappingError,
  buildPdfOptionMappingProbePath,
  generatePdfOptionMappingProbes,
} from "../lib/work-packets/pdf-option-mapping.ts";

test("Jon Smith Fidelity TOA demo builds a model-safe packet and run", () => {
  const demo = buildJonSmithFidelityToaDemo();
  const planFields = demo.completionPlan.fields;
  const serialized = JSON.stringify(demo);

  assert.equal(
    JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH,
    "local-dev/pdf-templates/fidelity-toa-template.pdf",
  );
  assert.equal(demo.packet.id, "wp_dev_jon_smith_fidelity_toa");
  assert.equal(demo.run.runType, "completion_plan");
  assert.ok(
    demo.valueRefs.some(
      (valueRef) => valueRef.valueRefId === "value_ref_receiving_account_number",
    ),
  );
  assert.ok(
    demo.valueRefs.some(
      (valueRef) => valueRef.valueRefId === "value_ref_delivering_account_number",
    ),
  );
  assert.ok(
    planFields.some(
      (field) =>
        field.plannedValue.valueKind === "value_ref" &&
        field.plannedValue.valueRefId === "value_ref_receiving_account_number",
    ),
  );
  assert.ok(
    planFields.some(
      (field) =>
        field.plannedValue.valueKind === "value_ref" &&
        field.plannedValue.valueRefId === "value_ref_delivering_account_number",
    ),
  );
  assert.ok(
    planFields.some(
      (field) =>
        field.planFieldId === "plan_field_receiving_account_type" &&
        field.plannedValue.valueKind === "select_option" &&
        field.plannedValue.selectedOption.exportValue === "7",
    ),
  );
  assert.equal(
    demo.completionPlan.reviewFlags?.some(
      (flag) =>
        flag.reviewFlagId === "review_receiving_account_type_export_value" ||
        flag.reviewFlagId === "review_delivering_account_type_export_value" ||
        flag.reviewFlagId === "review_transfer_scope_export_value",
    ),
    false,
  );
  assert.doesNotMatch(serialized, /\b\d{3}-\d{2}-\d{4}\b/);
  assert.doesNotMatch(serialized, /\b\d{9,}\b/);
  assert.doesNotMatch(serialized, /Demo Lane/i);
  assert.doesNotMatch(serialized, /100 Ameriprise Demo Way/i);
  assert.doesNotMatch(serialized, /\bMinneapolis\b/i);
  assert.doesNotMatch(serialized, /\b55402\b/);
  assert.doesNotMatch(serialized, /\b8005550199\b/);
  assert.doesNotMatch(serialized, /jon\.smith@example\.test/i);
});

test("Jon Smith Fidelity TOA demo maps real PDF field names to value refs", () => {
  const demo = buildJonSmithFidelityToaDemo({
    fieldInventory: makeFieldInventory([
      "AcctOwner",
      "Social Security or Taxpayer ID Number",
      "AcctNumber",
      "AcctNumber2",
      "FirmName",
      "FirmAddress",
      "FirmCity",
      "StateProvince",
      "FirmZIP",
      "FirmPhone",
      "Type",
      "Type2",
      "Trans",
      "PrintAcctOwner",
      "PrintAcctOwner2",
      "Date MM DD YYYY",
    ]),
  });
  const valueRefsById = new Map(
    demo.valueRefs.map((valueRef) => [valueRef.valueRefId, valueRef]),
  );

  assertValueMapping({
    demo,
    valueRefsById,
    planFieldId: "plan_field_client_legal_name",
    destinationFieldName: "AcctOwner",
    valueRefId: "value_ref_client_legal_name",
    fieldKey: "client.legal_name",
  });
  assertValueMapping({
    demo,
    valueRefsById,
    planFieldId: "plan_field_client_ssn",
    destinationFieldName: "Social Security or Taxpayer ID Number",
    valueRefId: "value_ref_client_ssn",
    fieldKey: "client.ssn",
  });
  assertValueMapping({
    demo,
    valueRefsById,
    planFieldId: "plan_field_receiving_account_number",
    destinationFieldName: "AcctNumber",
    valueRefId: "value_ref_receiving_account_number",
    fieldKey: "receiving_account.account_number",
  });
  assertValueMapping({
    demo,
    valueRefsById,
    planFieldId: "plan_field_delivering_account_number",
    destinationFieldName: "AcctNumber2",
    valueRefId: "value_ref_delivering_account_number",
    fieldKey: "delivering_account.account_number",
  });
  assertValueMapping({
    demo,
    valueRefsById,
    planFieldId: "plan_field_delivering_firm_address_line1",
    destinationFieldName: "FirmAddress",
    valueRefId: "value_ref_delivering_firm_address_line1",
    fieldKey: "delivering_firm.address.line1",
  });

  assert.equal(
    demo.completionPlan.fields.some(
      (field) =>
        field.destinationField?.name === "FirmAddress" &&
        field.plannedValue.valueKind === "value_ref" &&
        field.plannedValue.valueRefId === "value_ref_client_address",
    ),
    false,
  );

  assertConfirmedOptionMapping(
    demo,
    "plan_field_receiving_account_type",
    "Type",
    "7",
  );
  assertConfirmedOptionMapping(
    demo,
    "plan_field_delivering_account_type",
    "Type2",
    "7",
  );
  assertConfirmedOptionMapping(
    demo,
    "plan_field_transfer_scope",
    "Trans",
    "1",
  );
});

test("Jon Smith Fidelity TOA fill adapter writes only resolved text fields and safe trace", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "ria-file-ops-toa-"));
  const templatePath = path.join(tempDir, "template.pdf");
  await writeFile(templatePath, "fake pdf fixture");
  const outputPath = "local-dev/generated/test-jon-smith-fidelity-toa-filled.pdf";
  const demo = buildJonSmithFidelityToaDemo({
    fieldInventory: makeFieldInventory([
      "AcctOwner",
      "Social Security or Taxpayer ID Number",
      "AcctNumber",
      "AcctNumber2",
      "FirmName",
      "FirmAddress",
      "FirmCity",
      "StateProvince",
      "FirmZIP",
      "FirmPhone",
      "Type",
      "Type2",
      "Trans",
      "NewAcct",
      "Action4",
      "Action5",
      "Action6",
      "Annuity",
      "DRIP",
      "Bank",
      "PrintAcctOwner",
      "Date MM DD YYYY",
    ]),
  });
  let writtenFields = {};

  try {
    const result = await fillPdfFromCompletionPlan({
      templatePdfPath: templatePath,
      outputPdfPath: outputPath,
      completionPlan: demo.completionPlan,
      valueRefs: demo.valueRefs,
      resolveValue: (valueRef) => {
        const resolved = resolveJonSmithFidelityToaFakeValue(valueRef.valueRefId);

        if (resolved.status !== "resolved") {
          return {
            status: "not_found",
            reason: resolved.reason,
          };
        }

        return {
          status: "resolved",
          rawValue: resolved.rawValue,
          maskedPreview: resolved.maskedPreview,
        };
      },
      writeFieldsToPdf: async ({ fields }) => {
        writtenFields = fields;
        await writeFile(outputPath, "fake filled pdf");
        return {
          writtenFields: Object.keys(fields),
          missingFields: [],
        };
      },
    });
    const serializedTrace = JSON.stringify(result.trace);

    assert.equal(result.outputPdfPath, outputPath);
    assert.equal(writtenFields.AcctOwner, "Jon Smith");
    assert.equal(writtenFields["Social Security or Taxpayer ID Number"], "000126789");
    assert.equal(writtenFields.AcctNumber, "900012345");
    assert.equal(writtenFields.AcctNumber2, "234567890");
    assert.equal(writtenFields.FirmAddress, "100 Ameriprise Demo Way");
    assert.equal(writtenFields.FirmAddress === "123 Demo Lane, Boston, MA 02110", false);
    assert.equal(writtenFields.PrintAcctOwner, "Jon Smith");
    assert.equal(writtenFields.Type, "7");
    assert.equal(writtenFields.Type2, "7");
    assert.equal(writtenFields.Trans, "1");
    assert.equal(Object.hasOwn(writtenFields, "NewAcct"), false);
    assert.equal(
      result.trace.some(
        (entry) =>
          entry.destinationFieldName === "Type" &&
          entry.status === "filled" &&
          entry.selectedOption?.exportValue === "7",
      ),
      true,
    );
    assert.equal(
      result.trace.some(
        (entry) =>
          entry.destinationFieldName === "Type2" &&
          entry.status === "filled" &&
          entry.selectedOption?.exportValue === "7",
      ),
      true,
    );
    assert.equal(
      result.trace.some(
        (entry) =>
          entry.destinationFieldName === "Trans" &&
          entry.status === "filled" &&
          entry.selectedOption?.exportValue === "1",
      ),
      true,
    );
    assert.equal(
      result.trace.some(
        (entry) => entry.destinationFieldName === "NewAcct" && entry.status === "skipped",
      ),
      true,
    );
    assert.equal(
      result.trace.some(
        (entry) =>
          entry.destinationFieldName === "FirmAddress" &&
          entry.valueRefId === "value_ref_delivering_firm_address_line1" &&
          entry.status === "filled",
      ),
      true,
    );
    assert.doesNotMatch(serializedTrace, /\b\d{3}-\d{2}-\d{4}\b/);
    assert.doesNotMatch(serializedTrace, /\b\d{9,}\b/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("Jon Smith Fidelity TOA fill adapter stays generic", async () => {
  const adapterSource = await readFile(
    "lib/work-packets/pdf-fill-adapter.ts",
    "utf8",
  );

  assert.doesNotMatch(adapterSource, /Fidelity|Jon Smith|Ameriprise|NewAcct|Traditional|Rollover|Type2|Trans/);
});

test("Jon Smith Fidelity TOA buffer fill path keeps model-facing trace safe", async () => {
  const demo = buildJonSmithFidelityToaDemo({
    fieldInventory: makeFieldInventory([
      "AcctOwner",
      "Social Security or Taxpayer ID Number",
      "AcctNumber",
      "AcctNumber2",
      "FirmAddress",
      "Type",
      "Type2",
      "Trans",
      "NewAcct",
    ]),
  });
  let writtenFields = {};

  const result = await fillPdfBufferFromCompletionPlan({
    templatePdfBuffer: Buffer.from("%PDF-1.7\n"),
    completionPlan: demo.completionPlan,
    valueRefs: demo.valueRefs,
    resolveValue: (valueRef) => {
      const resolved = resolveJonSmithFidelityToaFakeValue(valueRef.valueRefId);

      if (resolved.status !== "resolved") {
        return {
          status: "not_found",
          reason: resolved.reason,
        };
      }

      return {
        status: "resolved",
        rawValue: resolved.rawValue,
        maskedPreview: resolved.maskedPreview,
      };
    },
    writeFieldsToPdfBuffer: async ({ fields }) => {
      writtenFields = fields;
      return {
        outputPdfBuffer: Buffer.from("%PDF-filled\n"),
        writtenFields: Object.keys(fields),
        missingFields: [],
      };
    },
  });
  const serializedTrace = JSON.stringify(result.trace);

  assert.equal(result.outputPdfBuffer.toString("utf8"), "%PDF-filled\n");
  assert.equal(writtenFields.AcctOwner, "Jon Smith");
  assert.equal(writtenFields.FirmAddress, "100 Ameriprise Demo Way");
  assert.equal(writtenFields.Type, "7");
  assert.equal(writtenFields.Type2, "7");
  assert.equal(writtenFields.Trans, "1");
  assert.equal(Object.hasOwn(writtenFields, "NewAcct"), false);
  assert.doesNotMatch(serializedTrace, /\b\d{3}-\d{2}-\d{4}\b/);
  assert.doesNotMatch(serializedTrace, /\b\d{9,}\b/);
});

test("Jon Smith Fidelity TOA verifier passes for generated-demo-shaped output and stays safe", () => {
  const result = verifyJonSmithFidelityToaFieldValues(makeVerifiedOutputFieldValues());
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "passed");
  assert.equal(result.counts.filledTextFieldsExpected, 11);
  assert.equal(result.counts.selectedOptionsExpected, 3);
  assert.equal(result.counts.blankFieldsExpected, 25);
  assert.equal(result.rawSensitiveValuesWereNotPrinted, true);
  assert.deepEqual(
    result.checked.selectedOptions,
    [
      { fieldName: "Type", expectedExportValue: "7" },
      { fieldName: "Type2", expectedExportValue: "7" },
      { fieldName: "Trans", expectedExportValue: "1" },
    ],
  );
  assert.doesNotMatch(serialized, /000126789/);
  assert.doesNotMatch(serialized, /900012345/);
  assert.doesNotMatch(serialized, /234567890/);
});

test("Jon Smith Fidelity TOA verifier passes for the generated PDF when present", async (t) => {
  if (!existsSync(JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH)) {
    t.skip("Generated demo PDF is not present; run the fill script to exercise this path.");
    return;
  }

  const fieldValues = await readPdfFieldValuesWithPypdf(
    JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
  );
  const result = verifyJonSmithFidelityToaFieldValues(fieldValues);

  assert.equal(result.status, "passed");
});

test("Jon Smith Fidelity TOA verifier reports a missing output PDF clearly", async () => {
  await assert.rejects(
    () =>
      readPdfFieldValuesWithPypdf(
        "local-dev/generated/does-not-exist-jon-smith-fidelity-toa.pdf",
      ),
    (error) =>
      error instanceof JonSmithFidelityToaVerificationError &&
      error.code === "missing_output_pdf",
  );
});

test("Jon Smith Fidelity TOA review artifact is a safe local-dev handoff", async () => {
  const demo = buildJonSmithFidelityToaDemo({
    fieldInventory: makeFieldInventory([
      "AcctOwner",
      "Social Security or Taxpayer ID Number",
      "AcctNumber",
      "AcctNumber2",
      "FirmName",
      "FirmAddress",
      "FirmCity",
      "StateProvince",
      "FirmZIP",
      "FirmPhone",
      "Type",
      "Type2",
      "Trans",
      "NewAcct",
      "PrintAcctOwner",
      "Date MM DD YYYY",
    ]),
  });
  const verificationSummary = verifyJonSmithFidelityToaFieldValues(
    makeVerifiedOutputFieldValues(),
  );
  const artifact = buildJonSmithFidelityToaReviewArtifact({
    demo,
    fillResult: makeVerifiedFillResult(),
    verificationSummary,
    createdAt: "2026-05-19T00:00:00.000Z",
  });
  const serialized = JSON.stringify(artifact);
  const testArtifactPath =
    "local-dev/generated/test-jon-smith-fidelity-toa-execution-review.json";

  try {
    assert.equal(
      JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH,
      "local-dev/generated/jon-smith-fidelity-toa-execution-review.json",
    );
    assert.doesNotThrow(() =>
      assertLocalDevGeneratedJsonOutputPath(JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH),
    );
    assert.throws(
      () => assertLocalDevGeneratedJsonOutputPath("tmp/review.json"),
      JonSmithFidelityToaReviewArtifactError,
    );
    assert.equal(artifact.metadata.generatedOutputPdfPath, JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH);
    assert.ok(artifact.completionPlanSummary.fields.length > 0);
    assert.ok(artifact.fillTrace.entries.length > 0);
    assert.equal(artifact.verificationSummary.status, "passed");
    assert.equal(
      artifact.reviewFlags.some(
        (flag) => flag.reviewFlagId === "review_signature_date_left_blank",
      ),
      true,
    );
    assert.equal(artifact.safety.rawSensitiveValuesIncluded, false);
    assert.doesNotMatch(serialized, /000126789/);
    assert.doesNotMatch(serialized, /900012345/);
    assert.doesNotMatch(serialized, /234567890/);

    await writeJonSmithFidelityToaReviewArtifact(artifact, testArtifactPath);
    const written = JSON.parse(await readFile(testArtifactPath, "utf8"));
    assert.equal(written.metadata.generatedOutputPdfPath, JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH);
    assert.ok(written.completionPlanSummary);
    assert.ok(written.fillTrace);
    assert.ok(written.verificationSummary);
  } finally {
    await rm(testArtifactPath, { force: true });
  }
});

test("Jon Smith Fidelity TOA review view model shapes the artifact for a future UI", async (t) => {
  const demo = buildJonSmithFidelityToaDemo({
    fieldInventory: makeFieldInventory([
      "AcctOwner",
      "Social Security or Taxpayer ID Number",
      "AcctNumber",
      "AcctNumber2",
      "FirmName",
      "FirmAddress",
      "FirmCity",
      "StateProvince",
      "FirmZIP",
      "FirmPhone",
      "Type",
      "Type2",
      "Trans",
      "NewAcct",
      "PrintAcctOwner",
      "Date MM DD YYYY",
    ]),
  });
  const artifact = buildJonSmithFidelityToaReviewArtifact({
    demo,
    fillResult: makeVerifiedFillResult(),
    verificationSummary: verifyJonSmithFidelityToaFieldValues(
      makeVerifiedOutputFieldValues(),
    ),
    templateSource: "stored_template",
    templateId: FIDELITY_TOA_STORED_TEMPLATE_ID,
    templateSha256: "a".repeat(64),
    createdAt: "2026-05-19T00:00:00.000Z",
  });
  const testArtifactPath =
    "local-dev/generated/test-jon-smith-fidelity-toa-execution-review-view-model.json";

  try {
    await writeJonSmithFidelityToaReviewArtifact(artifact, testArtifactPath);

    const viewModel = await loadJonSmithFidelityToaExecutionReviewViewModel(
      testArtifactPath,
    );
    const directViewModel = buildExecutionReviewViewModelFromArtifact(artifact, {
      reviewJsonPath: testArtifactPath,
    });
    const serialized = JSON.stringify(viewModel);

    assert.equal(viewModel.viewModelType, "execution_review");
    assert.equal(viewModel.header.demoId, "jon_smith_fidelity_toa_dev_demo");
    assert.equal(viewModel.header.status, "passed");
    assert.equal(viewModel.header.displayStatus, "Demo completed");
    assert.equal(viewModel.header.template.source, "stored_template");
    assert.equal(viewModel.header.template.templateId, FIDELITY_TOA_STORED_TEMPLATE_ID);
    assert.equal(viewModel.header.template.sha256, "a".repeat(64));
    assert.equal(viewModel.header.generatedPdfPath, JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH);
    assert.equal(viewModel.header.warning.includes("Dev-only fake-data"), true);
    assert.equal(viewModel.taskContext.receivingCustodian, "Fidelity");
    assert.equal(viewModel.taskContext.deliveringFirm, "Ameriprise");
    assert.ok(viewModel.completionPlan.rows.length > 0);
    assert.ok(viewModel.fillTrace.rows.length > 0);
    assert.equal(viewModel.fillTrace.counts.fieldsFilled, 14);
    assert.equal(viewModel.fillTrace.counts.optionsSelected, 3);
    assert.equal(viewModel.verification.status, "passed");
    assert.equal(viewModel.verification.displayStatus, "Verified");
    assert.equal(viewModel.verification.issueCount, 0);
    assert.equal(viewModel.completionPlan.displayStatus, "Mapped and verified");
    assert.equal(viewModel.completionPlan.summary.mappedFields, 14);
    assert.equal(viewModel.completionPlan.summary.manualReviewRows, 2);
    assert.equal(viewModel.artifactRefs.generatedPdfPath, JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH);
    assert.equal(viewModel.artifactRefs.reviewJsonPath, testArtifactPath);
    assert.equal(viewModel.artifactRefs.templateSource, "stored_template");
    assert.equal(viewModel.artifactRefs.templateId, FIDELITY_TOA_STORED_TEMPLATE_ID);
    assert.equal(viewModel.artifactRefs.templateSha256, "a".repeat(64));
    assert.equal(viewModel.artifactRefs.publicUrl, null);
    assert.equal(viewModel.safety.rawSensitiveValuesIncluded, false);
    assert.equal(
      viewModel.reviewFlags.some(
        (flag) => flag.reviewFlagId === "review_signature_date_left_blank",
      ),
      true,
    );
    assert.equal(
      viewModel.completionPlan.rows.some(
        (row) =>
          row.destinationField === "Type" &&
          row.reference.referenceKind === "option_ref" &&
          row.reference.exportValue === "7" &&
          row.status === "confirmed",
      ),
      true,
    );
    assert.equal(
      viewModel.completionPlan.rows.some(
        (row) =>
          row.destinationField === "AcctNumber2" &&
          row.reference.referenceKind === "value_ref" &&
          row.reference.valueRefId === "value_ref_delivering_account_number" &&
          row.status === "manual_review",
      ),
      true,
    );
    assert.equal(directViewModel.artifactRefs.reviewJsonPath, testArtifactPath);
    assert.doesNotMatch(serialized, /000126789/);
    assert.doesNotMatch(serialized, /900012345/);
    assert.doesNotMatch(serialized, /234567890/);

    await assert.rejects(
      () =>
        loadJonSmithFidelityToaExecutionReviewViewModel(
          "local-dev/generated/missing-jon-smith-fidelity-toa-execution-review.json",
        ),
      (error) =>
        error instanceof JonSmithFidelityToaReviewViewModelError &&
        error.code === "missing_artifact",
    );

    if (existsSync(JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH)) {
      const generatedViewModel =
        await loadJonSmithFidelityToaExecutionReviewViewModel();
      assert.equal(generatedViewModel.artifactRefs.reviewJsonPath, JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH);
      assert.equal(generatedViewModel.artifactRefs.generatedPdfPath, JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH);
    } else {
      t.diagnostic(
        "Generated review artifact is not present; run the build script to exercise the default loader.",
      );
    }
  } finally {
    await rm(testArtifactPath, { force: true });
  }
});

test("Execution Lab review view model hides stale scaffold warnings for verified website artifacts", () => {
  const demo = buildJonSmithFidelityToaDemo();
  const artifact = buildJonSmithFidelityToaReviewArtifact({
    demo,
    fillResult: makeVerifiedFillResult(),
    verificationSummary: verifyJonSmithFidelityToaFieldValues(
      makeVerifiedOutputFieldValues(),
    ),
    generatedOutputPdfPath: "/dev/execution-lab/fidelity-toa/pdf/jon-smith-fidelity-toa",
    createdAt: "2026-05-19T00:00:00.000Z",
  });
  const viewModel = buildExecutionReviewViewModelFromArtifact(artifact, {
    reviewJsonPath: "temporary-demo://jon-smith-fidelity-toa-execution-review.json",
  });
  const visibleFlags = JSON.stringify(viewModel.reviewFlags);
  const debugWarnings = JSON.stringify(viewModel.debugWarnings);
  const serialized = JSON.stringify(viewModel);

  assert.equal(viewModel.header.displayStatus, "Demo completed");
  assert.equal(viewModel.verification.displayStatus, "Verified");
  assert.equal(viewModel.completionPlan.status, "blocked_missing_information");
  assert.equal(viewModel.completionPlan.displayStatus, "Mapped and verified");
  assert.ok(viewModel.debugWarnings.hiddenCount > 20);
  assert.match(debugWarnings, /scaffold placeholder until the local PDF template is inspected/);
  assert.doesNotMatch(visibleFlags, /scaffold placeholder until the local PDF template is inspected/);
  assert.equal(
    viewModel.reviewFlags.some(
      (flag) => flag.reviewFlagId === "review_signature_date_left_blank",
    ),
    true,
  );
  assert.equal(
    viewModel.reviewFlags.some(
      (flag) => flag.reviewFlagId === "review_fake_data_only",
    ),
    true,
  );
  assert.equal(
    viewModel.reviewFlags.some(
      (flag) => flag.reviewFlagId === "review_acctnumber2_delivering_account_meaning",
    ),
    true,
  );
  assert.equal(
    viewModel.reviewFlags.some(
      (flag) => flag.reviewFlagId === "review_printacctowner_not_signature",
    ),
    true,
  );
  assert.equal(
    viewModel.completionPlan.rows.some((row) =>
      row.reviewFlags.some((flag) =>
        /scaffold placeholder until the local PDF template is inspected/i.test(
          flag.message,
        ),
      ),
    ),
    false,
  );
  assert.equal(
    viewModel.completionPlan.rows.some(
      (row) => row.hiddenDebugWarningCount > 0,
    ),
    true,
  );
  assert.doesNotMatch(serialized, /000126789/);
  assert.doesNotMatch(serialized, /900012345/);
  assert.doesNotMatch(serialized, /234567890/);
  assert.doesNotMatch(serialized, /100 Ameriprise Demo Way/);
  assert.doesNotMatch(serialized, /8005550199/);
});

test("Execution Lab review display surface is dev-only and does not hardcode raw fake values", async () => {
  const [componentSource, routeSource, actionSource, pdfRouteSource] = await Promise.all([
    readFile(
      "components/work-packets/execution-lab-review-surface.tsx",
      "utf8",
    ),
    readFile("app/dev/execution-lab/fidelity-toa/page.tsx", "utf8"),
    readFile("app/dev/execution-lab/fidelity-toa/actions.ts", "utf8"),
    readFile("app/dev/execution-lab/fidelity-toa/pdf/[runId]/route.ts", "utf8"),
  ]);
  const combinedSource = `${componentSource}\n${routeSource}\n${actionSource}\n${pdfRouteSource}`;

  assert.match(componentSource, /ExecutionLabReviewSurface/);
  assert.match(componentSource, /viewModel/);
  assert.match(routeSource, /requireExecutionLabDemoPrincipal/);
  assert.match(actionSource, /runWebsiteJonSmithFidelityToaDemo/);
  assert.match(actionSource, /resolveFidelityToaTemplateForWebsiteRun/);
  assert.match(actionSource, /templatePdf/);
  assert.match(routeSource, /Use stored Fidelity TOA template/);
  assert.match(routeSource, /Upload one-off override/);
  assert.match(pdfRouteSource, /readWebsiteFidelityToaDemoPdf/);
  assert.match(pdfRouteSource, /Content-Disposition/);
  assert.match(pdfRouteSource, /download/);
  assert.match(routeSource, /Run Demo/);
  assert.match(routeSource, /No run yet/);
  assert.match(componentSource, /<details/);
  assert.match(componentSource, /Mapped fields/);
  assert.match(componentSource, /Full completion plan/);
  assert.match(componentSource, /Debug warnings hidden from main view/);
  assert.match(componentSource, /View safe debug JSON/);
  assert.match(routeSource, /loadWebsiteFidelityToaDemoViewModelById/);
  assert.match(routeSource, /resolvedSearchParams\?\.run/);
  assert.doesNotMatch(combinedSource, /000126789/);
  assert.doesNotMatch(combinedSource, /900012345/);
  assert.doesNotMatch(combinedSource, /234567890/);
  assert.doesNotMatch(combinedSource, /8005550199/);
  assert.doesNotMatch(combinedSource, /100 Ameriprise Demo Way/);
});

test("local Execution Lab artifact registry selects only known local-dev artifacts", async (t) => {
  assert.equal(
    normalizeLocalExecutionReviewArtifactId(undefined),
    DEFAULT_LOCAL_EXECUTION_REVIEW_ARTIFACT_ID,
  );
  assert.equal(
    normalizeLocalExecutionReviewArtifactId("jon-smith-fidelity-toa"),
    DEFAULT_LOCAL_EXECUTION_REVIEW_ARTIFACT_ID,
  );
  assert.throws(
    () => normalizeLocalExecutionReviewArtifactId("../jon-smith-fidelity-toa"),
    (error) =>
      error instanceof LocalExecutionReviewArtifactRegistryError &&
      error.code === "invalid_artifact_id",
  );
  assert.throws(
    () => normalizeLocalExecutionReviewArtifactId("missing-run"),
    (error) =>
      error instanceof LocalExecutionReviewArtifactRegistryError &&
      error.code === "unknown_artifact_id",
  );

  if (!existsSync(JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH)) {
    t.skip("Generated review artifact is not present; run the one-command demo script first.");
    return;
  }

  const artifacts = await listLocalExecutionReviewArtifacts();
  const currentArtifact = artifacts.find(
    (artifact) => artifact.id === DEFAULT_LOCAL_EXECUTION_REVIEW_ARTIFACT_ID,
  );

  assert.ok(currentArtifact, "Expected current Jon Smith artifact in local registry.");
  assert.equal(currentArtifact.artifactPath, JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH);
  assert.equal(currentArtifact.generatedPdfPath, JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH);
  assert.equal(currentArtifact.status, "passed");

  const result = await loadLocalExecutionReviewViewModelById(
    "jon-smith-fidelity-toa",
  );
  const serialized = JSON.stringify(result.viewModel);

  assert.equal(result.artifact.id, DEFAULT_LOCAL_EXECUTION_REVIEW_ARTIFACT_ID);
  assert.equal(result.viewModel.artifactRefs.reviewJsonPath, JON_SMITH_FIDELITY_TOA_REVIEW_ARTIFACT_PATH);
  assert.equal(result.viewModel.artifactRefs.generatedPdfPath, JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH);
  assert.doesNotMatch(serialized, /000126789/);
  assert.doesNotMatch(serialized, /900012345/);
  assert.doesNotMatch(serialized, /234567890/);
  assert.doesNotMatch(serialized, /100 Ameriprise Demo Way/);
  assert.doesNotMatch(serialized, /8005550199/);
});

test("website Execution Lab demo registry validates ids and template uploads safely", () => {
  assert.equal(
    normalizeWebsiteFidelityToaDemoArtifactId(undefined),
    WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID,
  );
  assert.equal(
    normalizeWebsiteFidelityToaDemoArtifactId("jon-smith-fidelity-toa"),
    WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID,
  );
  assert.throws(
    () => normalizeWebsiteFidelityToaDemoArtifactId("../jon-smith-fidelity-toa"),
    (error) =>
      error instanceof WebsiteFidelityToaDemoError &&
      error.code === "unsafe_artifact_id",
  );
  assert.throws(
    () => normalizeWebsiteFidelityToaDemoArtifactId("missing-run"),
    (error) =>
      error instanceof WebsiteFidelityToaDemoError &&
      error.code === "unknown_artifact_id",
  );
  assert.throws(
    () => assertValidTemplatePdfBuffer(Buffer.alloc(0)),
    (error) =>
      error instanceof WebsiteFidelityToaDemoError &&
      error.code === "missing_template",
  );
  assert.throws(
    () => assertValidTemplatePdfBuffer(Buffer.from("not a pdf")),
    (error) =>
      error instanceof WebsiteFidelityToaDemoError &&
      error.code === "invalid_template",
  );
  assert.doesNotThrow(() =>
    assertValidTemplatePdfBuffer(Buffer.from("%PDF-1.7\n")),
  );
});

test("stored Execution Lab template loader fails closed with safe statuses", async () => {
  await assert.rejects(
    () =>
      loadStoredFidelityToaTemplate({
        env: {},
        fetchImpl: async () => {
          throw new Error("fetch should not run without config");
        },
      }),
    (error) =>
      error instanceof StoredExecutionLabTemplateError &&
      error.code === "stored_template_not_configured",
  );

  await assert.rejects(
    () =>
      loadStoredFidelityToaTemplate({
        env: {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        },
        fetchImpl: async () => new Response("missing", { status: 404 }),
      }),
    (error) =>
      error instanceof StoredExecutionLabTemplateError &&
      error.code === "stored_template_missing",
  );

  await assert.rejects(
    () =>
      loadStoredFidelityToaTemplate({
        env: {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        },
        fetchImpl: async () => new Response("not a pdf", { status: 200 }),
      }),
    (error) =>
      error instanceof StoredExecutionLabTemplateError &&
      error.code === "stored_template_invalid_pdf",
  );

  const downloadFailure = await loadStoredFidelityToaTemplate({
    env: {
      SUPABASE_URL: "https://example.supabase.co/",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    fetchImpl: async (url, init) => {
      assert.equal(
        url,
        `https://example.supabase.co/storage/v1/object/${EXECUTION_LAB_TEMPLATE_BUCKET}/${FIDELITY_TOA_STORED_TEMPLATE_OBJECT_PATH}`,
      );
      assert.equal(init?.headers?.apikey, "service-role-key");
      assert.equal(init?.headers?.authorization, "Bearer service-role-key");
      return new Response("%PDF-1.7\n", { status: 200 });
    },
  });

  assert.equal(downloadFailure.templateMetadata.source, "stored_template");
  assert.equal(downloadFailure.templateMetadata.templateId, FIDELITY_TOA_STORED_TEMPLATE_ID);
  assert.match(downloadFailure.templateMetadata.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(
    getStoredExecutionLabTemplateStatusForError(
      new StoredExecutionLabTemplateError(
        "not configured",
        "stored_template_not_configured",
      ),
    ),
    "stored_template_not_configured",
  );
});

test("Execution Lab template source selector keeps upload override working", async () => {
  const uploadFormData = new FormData();
  uploadFormData.set("templateSource", "upload_override");
  uploadFormData.set(
    "templatePdf",
    new Blob([Buffer.from("%PDF-1.7\n")], { type: "application/pdf" }),
    "fidelity-toa-template.pdf",
  );

  const uploadResult = await resolveFidelityToaTemplateForWebsiteRun({
    formData: uploadFormData,
    loadStoredTemplate: async () => {
      throw new Error("stored template should not be loaded for upload override");
    },
  });

  assert.equal(normalizeFidelityToaTemplateSource(null), "stored_template");
  assert.equal(uploadResult.templatePdfBuffer.toString("utf8"), "%PDF-1.7\n");
  assert.equal(uploadResult.templateMetadata.source, "upload_override");
  assert.match(uploadResult.templateMetadata.sha256 ?? "", /^[a-f0-9]{64}$/);

  const storedFormData = new FormData();
  storedFormData.set("templateSource", "stored_template");

  const storedResult = await resolveFidelityToaTemplateForWebsiteRun({
    formData: storedFormData,
    loadStoredTemplate: async () => ({
      templatePdfBuffer: Buffer.from("%PDF-stored\n"),
      templateMetadata: {
        source: "stored_template",
        templateId: FIDELITY_TOA_STORED_TEMPLATE_ID,
        sha256: "b".repeat(64),
      },
    }),
  });

  assert.equal(storedResult.templatePdfBuffer.toString("utf8"), "%PDF-stored\n");
  assert.equal(storedResult.templateMetadata.source, "stored_template");
  assert.equal(storedResult.templateMetadata.templateId, FIDELITY_TOA_STORED_TEMPLATE_ID);
  assert.equal(storedResult.templateMetadata.sha256, "b".repeat(64));

  const serialized = JSON.stringify({ uploadResult, storedResult });
  assert.doesNotMatch(serialized, /000126789/);
  assert.doesNotMatch(serialized, /900012345/);
  assert.doesNotMatch(serialized, /234567890/);
});

test("website Execution Lab demo maps missing pypdf runtime to safe status", () => {
  const wrapped = classifyWebsiteFidelityToaDemoRuntimeError(
    new PdfFillAdapterError(
      "Traceback (most recent call last):\nModuleNotFoundError: No module named 'pypdf'",
      "writer_failed",
    ),
    "fill",
  );

  assert.equal(wrapped.code, "pdf_fill_runtime_unavailable");
  assert.equal(
    getWebsiteFidelityToaDemoStatusForError(wrapped),
    "pdf_fill_runtime_unavailable",
  );
  assert.match(wrapped.message, /PDF fill runtime is unavailable/);
  assert.doesNotMatch(wrapped.message, /Traceback|pypdf/);
});

test("website Execution Lab demo run is Node-native when the template is present", async (t) => {
  if (!existsSync(JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH)) {
    t.skip("Local Fidelity TOA template is not present; upload/run path is covered by unit guards.");
    return;
  }

  const ownerEmail = "website-demo@example.test";
  const templatePdfBuffer = await readFile(JON_SMITH_FIDELITY_TOA_TEMPLATE_PATH);
  const result = await withPythonSitePackagesDisabled(() =>
    runWebsiteJonSmithFidelityToaDemo({
      ownerEmail,
      templatePdfBuffer,
      createdAt: "2026-05-19T00:00:00.000Z",
    }),
  );
  const loaded = loadWebsiteFidelityToaDemoViewModelById({
    ownerEmail,
    id: "jon-smith-fidelity-toa",
  });
  const pdf = readWebsiteFidelityToaDemoPdf({
    ownerEmail,
    id: "jon-smith-fidelity-toa",
  });
  const fieldValues = await readPdfFieldValuesWithPdfLib(pdf.buffer);
  const artifacts = listWebsiteFidelityToaDemoArtifacts({ ownerEmail });
  const serialized = JSON.stringify({
    result,
    loaded,
    artifactSummary: artifacts[0],
  });

  assert.equal(result.artifact.id, WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID);
  assert.equal(result.artifact.templateSource, "upload_override");
  assert.match(result.artifact.templateSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(result.verificationStatus, "passed");
  assert.equal(result.filledFieldCount, 14);
  assert.equal(result.selectedOptionCount, 3);
  assert.equal(result.errorCount, 0);
  assert.equal(loaded.viewModel.verification.status, "passed");
  assert.equal(loaded.viewModel.artifactRefs.generatedPdfPath, "/dev/execution-lab/fidelity-toa/pdf/jon-smith-fidelity-toa");
  assert.equal(pdf.artifact.downloadPdfHref, "/dev/execution-lab/fidelity-toa/pdf/jon-smith-fidelity-toa?download=1");
  assert.ok(pdf.buffer.byteLength > 0);
  assert.equal(fieldValues.Type, "7");
  assert.equal(fieldValues.Type2, "7");
  assert.equal(fieldValues.Trans, "1");
  assert.equal(fieldValues.NewAcct, "Off");
  assert.equal(fieldValues["Date MM DD YYYY"], undefined);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.storage, "temporary_server_memory");
  assert.doesNotMatch(serialized, /000126789/);
  assert.doesNotMatch(serialized, /900012345/);
  assert.doesNotMatch(serialized, /234567890/);
});

test("Jon Smith Fidelity TOA demo pipeline script orchestrates safe dev steps", async () => {
  const source = await readFile(
    "scripts/run-work-packets-fidelity-toa-demo.mjs",
    "utf8",
  );
  const fillIndex = source.indexOf("fill-work-packets-fidelity-toa-demo.mjs");
  const verifyIndex = source.indexOf("verify-work-packets-fidelity-toa-demo.mjs");
  const artifactIndex = source.indexOf(
    "build-work-packets-fidelity-toa-review-artifact.mjs",
  );
  const viewIndex = source.indexOf("view-work-packets-fidelity-toa-review-artifact.mjs");

  assert.match(source, /local-dev\/pdf-templates\/fidelity-toa-template\.pdf/);
  assert.match(source, /http:\/\/localhost:3000\/dev\/execution-lab\/fidelity-toa/);
  assert.ok(fillIndex > -1, "Expected fill script in pipeline.");
  assert.ok(verifyIndex > fillIndex, "Expected verify after fill.");
  assert.ok(artifactIndex > verifyIndex, "Expected artifact build after verify.");
  assert.ok(viewIndex > artifactIndex, "Expected view model summary after artifact build.");
  assert.match(source, /assertNoRawSensitiveValues/);
  assert.doesNotMatch(source, /000126789/);
  assert.doesNotMatch(source, /900012345/);
  assert.doesNotMatch(source, /234567890/);
});

test("Jon Smith Fidelity TOA fill adapter guards output paths and missing templates", async () => {
  assert.doesNotThrow(() =>
    assertLocalDevGeneratedOutputPath(JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH),
  );
  assert.throws(
    () => assertLocalDevGeneratedOutputPath("tmp/not-local-dev.pdf"),
    PdfFillAdapterError,
  );

  const demo = buildJonSmithFidelityToaDemo({
    fieldInventory: makeFieldInventory(["AcctOwner"]),
  });

  await assert.rejects(
    () =>
      fillPdfFromCompletionPlan({
        templatePdfPath: "local-dev/pdf-templates/does-not-exist.pdf",
        outputPdfPath: "local-dev/generated/missing-template-test.pdf",
        completionPlan: demo.completionPlan,
        valueRefs: demo.valueRefs,
        resolveValue: () => ({
          status: "not_found",
          reason: "Not needed for missing-template guard.",
        }),
        writeFieldsToPdf: async () => ({
          writtenFields: [],
          missingFields: [],
        }),
      }),
    (error) =>
      error instanceof PdfFillAdapterError && error.code === "missing_template",
  );
});

test("Jon Smith Fidelity TOA option mapping probes are isolated manual-review PDFs", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "ria-file-ops-options-"));
  const templatePath = path.join(tempDir, "template.pdf");
  await writeFile(templatePath, "fake pdf fixture");
  const fieldInventory = makeFieldInventory(["Type", "Type2", "Trans", "NewAcct"]);
  const probes = buildJonSmithFidelityToaOptionMappingProbes(fieldInventory);
  const captured = [];

  try {
    assert.equal(
      buildPdfOptionMappingProbePath(
        JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
        "Type",
        "14",
      ),
      "local-dev/generated/option-mapping/type-value-14.pdf",
    );
    assert.equal(
      probes.some((probe) => probe.fieldName === "NewAcct"),
      false,
    );
    assert.deepEqual(
      probes
        .filter((probe) => probe.fieldName === "Trans")
        .map((probe) => probe.exportValue),
      ["1", "2"],
    );

    const results = await generatePdfOptionMappingProbes({
      templatePdfPath: templatePath,
      outputDirectory: JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
      probes: probes.slice(0, 3),
      writeOptionProbePdf: async (input) => {
        captured.push(input);
        return {
          status: "generated",
          matchedAppearanceState: true,
        };
      },
    });

    assert.equal(results.length, 3);
    assert.equal(captured.length, 3);
    assert.equal(
      results.every((result) =>
        result.outputPdfPath.startsWith(
          `${JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR}/`,
        ),
      ),
      true,
    );
    assert.equal(
      results.every((result) => result.status === "generated"),
      true,
    );

    await assert.rejects(
      () =>
        generatePdfOptionMappingProbes({
          templatePdfPath: path.join(tempDir, "missing.pdf"),
          outputDirectory: JON_SMITH_FIDELITY_TOA_OPTION_MAPPING_OUTPUT_DIR,
          probes: probes.slice(0, 1),
          writeOptionProbePdf: async () => ({
            status: "generated",
          }),
        }),
      (error) =>
        error instanceof PdfOptionMappingError && error.code === "missing_template",
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("Jon Smith Fidelity TOA option visual classifier confirms only unique target-region matches", () => {
  const report = classifyJonSmithFidelityToaOptionVisuals([
    makeVisualCandidate("Type", "6", { x: 42, y: 445 }),
    makeVisualCandidate("Type", "7", { x: 162, y: 511 }),
    makeVisualCandidate("Type2", "7", { x: 432, y: 511 }),
    makeVisualCandidate("Trans", "1", { x: 41, y: 225 }),
    makeVisualCandidate("Trans", "2", { x: 41, y: 212 }),
  ]);

  assert.equal(report.typeTraditionalIra.exportValue, "7");
  assert.equal(report.typeTraditionalIra.confidence, "high");
  assert.equal(report.type2TraditionalIra.exportValue, "7");
  assert.equal(report.type2TraditionalIra.confidence, "high");
  assert.equal(report.transFullInKind.exportValue, "1");
  assert.equal(report.transFullInKind.confidence, "high");

  const ambiguousReport = classifyJonSmithFidelityToaOptionVisuals([
    makeVisualCandidate("Type", "7", { x: 162, y: 511 }),
    makeVisualCandidate("Type", "99", { x: 163, y: 512 }),
  ]);

  assert.equal(ambiguousReport.typeTraditionalIra.exportValue, null);
  assert.equal(
    ambiguousReport.typeTraditionalIra.confidence,
    "manual_review_required",
  );
});

function makeFieldInventory(fieldNames) {
  return {
    inventoryId: "test_inventory",
    sourceKind: "pdf_form",
    extractionMethod: "manual",
    fields: fieldNames.map((name, index) => ({
      fieldId: `test_field_${index + 1}`,
      name,
      fieldType: name === "Date MM DD YYYY" ? "date" : "unknown",
      requiredness: "unknown",
      currentValueStatus: ["Type", "Type2", "Trans"].includes(name)
        ? "present"
        : "empty",
      options: ["Type", "Type2"].includes(name)
        ? ["1", "2", "3", "4"].map((value) => ({
            label: value,
            exportValue: value,
          }))
        : name === "Trans"
          ? ["1", "2"].map((value) => ({
              label: value,
              exportValue: value,
            }))
          : undefined,
      confidence: "high",
    })),
    safeSummary: "Test field inventory.",
    createdAt: "2026-05-19T00:00:00.000Z",
  };
}

function makeVisualCandidate(fieldName, exportValue, center) {
  return {
    fieldName,
    exportValue,
    probePdfPath: `local-dev/generated/option-mapping/${fieldName.toLowerCase()}-value-${exportValue}.pdf`,
    changedPixelCount: 100,
    pdfCenter: center,
    pdfBounds: {
      xMin: center.x - 4,
      yMin: center.y - 4,
      xMax: center.x + 4,
      yMax: center.y + 4,
    },
    renderedImagePath: `local-dev/generated/option-mapping/visual-debug/${fieldName.toLowerCase()}-value-${exportValue}.png`,
    diffImagePath: `local-dev/generated/option-mapping/visual-debug/${fieldName.toLowerCase()}-value-${exportValue}-diff.png`,
  };
}

function makeVerifiedOutputFieldValues() {
  return {
    AcctOwner: "Jon Smith",
    "Social Security or Taxpayer ID Number": "000126789",
    AcctNumber: "900012345",
    AcctNumber2: "234567890",
    FirmName: "Ameriprise",
    FirmAddress: "100 Ameriprise Demo Way",
    FirmCity: "Minneapolis",
    StateProvince: "MN",
    FirmZIP: "55402",
    FirmPhone: "8005550199",
    PrintAcctOwner: "Jon Smith",
    Type: "/7",
    Type2: "/7",
    Trans: "/1",
    NewAcct: null,
    "Date MM DD YYYY": "",
    AddAcctOwner: null,
    "AddSocial Security or Taxpayer ID Number": null,
    AcctOwner2: null,
    PrintAcctOwner2: null,
    Other1: null,
    Other2: null,
    CashAmmt: null,
    Security1: null,
    Security2: null,
    Security3: null,
    Security4: null,
    Security5: null,
    Security6: null,
    Shares1: null,
    Shares2: null,
    Shares3: null,
    Shares4: null,
    Shares5: null,
    Shares6: null,
    AnnuityAmmt1: null,
    AnnuityDate: null,
    AnnuityShares: null,
    CDDate: null,
  };
}

function makeVerifiedFillResult() {
  return {
    outputPdfPath: JON_SMITH_FIDELITY_TOA_FILLED_OUTPUT_PATH,
    filledFieldCount: 14,
    skippedFieldCount: 31,
    errorCount: 0,
    trace: [
      {
        destinationFieldName: "AcctOwner",
        valueRefId: "value_ref_client_legal_name",
        maskedPreview: {
          display: "Jon Smith",
          strategy: "none",
          valueWasNotShownToModel: true,
        },
        status: "filled",
        reason: "Resolved through app-layer fake resolver and written to copied PDF.",
      },
      {
        destinationFieldName: "Social Security or Taxpayer ID Number",
        valueRefId: "value_ref_client_ssn",
        maskedPreview: {
          display: "***6789",
          strategy: "last4",
          last4: "6789",
          valueWasNotShownToModel: true,
        },
        status: "filled",
        reason: "Resolved through app-layer fake resolver and written to copied PDF.",
      },
      {
        destinationFieldName: "AcctNumber",
        valueRefId: "value_ref_receiving_account_number",
        maskedPreview: {
          display: "***2345",
          strategy: "last4",
          last4: "2345",
          valueWasNotShownToModel: true,
        },
        status: "filled",
        reason: "Resolved through app-layer fake resolver and written to copied PDF.",
      },
      {
        destinationFieldName: "AcctNumber2",
        valueRefId: "value_ref_delivering_account_number",
        maskedPreview: {
          display: "***7890",
          strategy: "last4",
          last4: "7890",
          valueWasNotShownToModel: true,
        },
        status: "filled",
        reason: "Resolved through app-layer fake resolver and written to copied PDF.",
      },
      {
        destinationFieldName: "Type",
        valueRefId: "value_ref_receiving_account_type",
        maskedPreview: {
          display: "Traditional/Rollover IRA",
          strategy: "none",
          valueWasNotShownToModel: true,
        },
        selectedOption: {
          label: "Traditional, SEP, or Rollover IRA",
          exportValue: "7",
        },
        status: "filled",
        reason: "Selected confirmed PDF option export value.",
      },
      {
        destinationFieldName: "Type2",
        valueRefId: "value_ref_delivering_account_type",
        maskedPreview: {
          display: "Traditional IRA",
          strategy: "none",
          valueWasNotShownToModel: true,
        },
        selectedOption: {
          label: "Traditional, SEP, or Rollover IRA",
          exportValue: "7",
        },
        status: "filled",
        reason: "Selected confirmed PDF option export value.",
      },
      {
        destinationFieldName: "Trans",
        valueRefId: "value_ref_transfer_scope",
        maskedPreview: {
          display: "Full transfer",
          strategy: "none",
          valueWasNotShownToModel: true,
        },
        selectedOption: {
          label: "Transfer the entire account, in kind",
          exportValue: "1",
        },
        status: "filled",
        reason: "Selected confirmed PDF option export value.",
      },
      {
        destinationFieldName: "NewAcct",
        status: "skipped",
        reason:
          "Jon Smith already has a receiving Fidelity account number, so the new-account option remains unselected.",
      },
    ],
  };
}

function assertValueMapping({
  demo,
  valueRefsById,
  planFieldId,
  destinationFieldName,
  valueRefId,
  fieldKey,
}) {
  const field = getPlanField(demo, planFieldId);

  assert.equal(field.destinationField?.name, destinationFieldName);
  assert.equal(field.plannedValue.valueKind, "value_ref");
  assert.equal(field.plannedValue.valueRefId, valueRefId);
  assert.equal(valueRefsById.get(valueRefId)?.fieldKey, fieldKey);
}

function assertConfirmedOptionMapping(
  demo,
  planFieldId,
  destinationFieldName,
  exportValue,
) {
  const field = getPlanField(demo, planFieldId);

  assert.equal(field.destinationField?.name, destinationFieldName);
  assert.equal(field.plannedValue.valueKind, "select_option");
  assert.equal(field.plannedValue.selectedOption.exportValue, exportValue);
  assert.equal(
    field.plannedValue.selectedOption.metadata?.exactPdfExportValueKnown,
    true,
  );
}

function getPlanField(demo, planFieldId) {
  const field = demo.completionPlan.fields.find(
    (candidate) => candidate.planFieldId === planFieldId,
  );

  assert.ok(field, `Expected ${planFieldId} to exist.`);
  return field;
}

async function withPythonSitePackagesDisabled(callback) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "ria-file-ops-no-pypdf-"));
  const originalPath = process.env.PATH;
  const pythonPath = await findPythonPath(originalPath);
  const shimPath = path.join(tempDir, "python3");

  try {
    await writeFile(shimPath, `#!/bin/sh\nexec "${pythonPath}" -S "$@"\n`);
    await chmod(shimPath, 0o755);
    process.env.PATH = `${tempDir}${path.delimiter}${originalPath ?? ""}`;

    return await callback();
  } finally {
    process.env.PATH = originalPath;
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function findPythonPath(originalPath) {
  const paths = (originalPath ?? "").split(path.delimiter).filter(Boolean);

  for (const directory of paths) {
    const candidate = path.join(directory, "python3");

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "python3";
}
