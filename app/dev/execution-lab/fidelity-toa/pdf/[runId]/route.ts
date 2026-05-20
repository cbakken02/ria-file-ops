import { getExecutionLabDemoRoutePrincipal } from "@/lib/work-packets/dev-demo/execution-lab-demo-access";
import {
  WebsiteFidelityToaDemoError,
  readWebsiteFidelityToaDemoPdf,
} from "@/lib/work-packets/dev-demo/website-fidelity-toa-demo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const principalResult = await getExecutionLabDemoRoutePrincipal();

  if (!principalResult.ok) {
    return principalResult.response;
  }

  const { runId } = await context.params;
  const url = new URL(request.url);
  const shouldDownload = url.searchParams.get("download") === "1";

  try {
    const result = readWebsiteFidelityToaDemoPdf({
      ownerEmail: principalResult.principal.legacyOwnerEmail,
      id: runId,
    });
    const filename = "jon-smith-fidelity-toa-filled.pdf";
    const pdfBody = Uint8Array.from(result.buffer).buffer;

    return new Response(pdfBody, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Content-Length": String(result.buffer.byteLength),
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (
      error instanceof WebsiteFidelityToaDemoError &&
      (error.code === "unsafe_artifact_id" ||
        error.code === "unknown_artifact_id" ||
        error.code === "missing_artifact")
    ) {
      return new Response("Demo PDF not found.", { status: 404 });
    }

    throw error;
  }
}
