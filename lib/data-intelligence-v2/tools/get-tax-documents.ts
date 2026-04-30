import type { ClientDataGateway } from "@/lib/data-intelligence-v2/data-gateway";
import type { DataIntelligenceV2AuthContext } from "@/lib/data-intelligence-v2/types";
import type { GetTaxDocumentsToolArgs } from "@/lib/data-intelligence-v2/tools/definitions";
import {
  createFact,
  createToolResult,
} from "@/lib/data-intelligence-v2/tools/result-helpers";

export async function runGetTaxDocumentsTool(args: {
  toolArgs: GetTaxDocumentsToolArgs;
  authContext: DataIntelligenceV2AuthContext;
  dataGateway: ClientDataGateway;
}) {
  const result = await args.dataGateway.getTaxDocuments({
    ownerEmail: args.authContext.ownerEmail,
    clientId: args.toolArgs.clientId,
    taxYear: args.toolArgs.taxYear,
    formTypes: args.toolArgs.formTypes,
    limit: args.toolArgs.limit,
  });

  if (result.taxDocuments.length === 0) {
    return createToolResult({
      toolName: "get_tax_documents",
      status: "not_found",
      summary: "No matching tax documents were found.",
      missing: result.missing,
      sourceRefs: result.sourceRefs,
      allowedClaims: ["No matching tax document metadata was found."],
    });
  }

  const facts = result.taxDocuments.flatMap((document) => [
    createFact({
      factId: `tax:${document.documentId}:year`,
      fieldKey: "taxDocument.taxYear",
      label: "Tax year",
      value:
        typeof document.taxYear === "number"
          ? document.taxYear
          : document.taxYear ?? null,
      sourceRefs: document.sourceRefs,
    }),
    createFact({
      factId: `tax:${document.documentId}:form`,
      fieldKey: "taxDocument.formType",
      label: "Tax form type",
      value: document.formType ?? null,
      sourceRefs: document.sourceRefs,
    }),
    createFact({
      factId: `tax:${document.documentId}:label`,
      fieldKey: "statement.documentLabel",
      label: "Document label",
      value: document.label,
      sourceRefs: document.sourceRefs,
    }),
    createFact({
      factId: `tax:${document.documentId}:status`,
      fieldKey: "taxDocument.status",
      label: "Tax document status",
      value: document.status ?? "available",
      sourceRefs: document.sourceRefs,
    }),
  ]);

  return createToolResult({
    toolName: "get_tax_documents",
    status: "success",
    summary: `Found ${result.taxDocuments.length} tax document record${result.taxDocuments.length === 1 ? "" : "s"}.`,
    facts,
    sourceRefs: result.sourceRefs,
    allowedClaims: [
      "Safe tax document metadata is available, including tax year, form type, document label, and status.",
    ],
    disallowedClaims: ["Do not state SSNs, tax IDs, or raw tax identifiers."],
  });
}
