"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getStoredExecutionLabTemplateStatusForError,
  logStoredExecutionLabTemplateFailure,
  resolveFidelityToaTemplateForWebsiteRun,
} from "@/lib/work-packets/dev-demo/execution-lab-template-storage";
import { requireExecutionLabDemoPrincipal } from "@/lib/work-packets/dev-demo/execution-lab-demo-access";
import {
  WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID,
  getWebsiteFidelityToaDemoStatusForError,
  logWebsiteFidelityToaDemoRunFailure,
  runWebsiteJonSmithFidelityToaDemo,
} from "@/lib/work-packets/dev-demo/website-fidelity-toa-demo";

const ROUTE_PATH = "/dev/execution-lab/fidelity-toa";

export async function runJonSmithFidelityToaWebsiteDemoAction(
  formData: FormData,
) {
  const principal = await requireExecutionLabDemoPrincipal();

  try {
    const template = await resolveFidelityToaTemplateForWebsiteRun({ formData });

    await runWebsiteJonSmithFidelityToaDemo({
      ownerEmail: principal.legacyOwnerEmail,
      templatePdfBuffer: template.templatePdfBuffer,
      templateMetadata: template.templateMetadata,
    });
  } catch (error) {
    const storedTemplateStatus = getStoredExecutionLabTemplateStatusForError(error);

    if (storedTemplateStatus) {
      logStoredExecutionLabTemplateFailure(error);
      redirectWithStatus(storedTemplateStatus);
    }

    logWebsiteFidelityToaDemoRunFailure(error);
    redirectWithStatus(getWebsiteFidelityToaDemoStatusForError(error));
  }

  revalidatePath(ROUTE_PATH);
  redirect(`${ROUTE_PATH}?run=${WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID}&status=run_complete`);
}

function redirectWithStatus(status: string): never {
  redirect(`${ROUTE_PATH}?status=${encodeURIComponent(status)}`);
}
