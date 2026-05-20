"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
  const template = formData.get("templatePdf");

  if (!(template instanceof File) || template.size === 0) {
    redirectWithStatus("missing_template");
  }

  try {
    await runWebsiteJonSmithFidelityToaDemo({
      ownerEmail: principal.legacyOwnerEmail,
      templateFileName: template.name,
      templatePdfBuffer: Buffer.from(await template.arrayBuffer()),
    });
  } catch (error) {
    logWebsiteFidelityToaDemoRunFailure(error);
    redirectWithStatus(getWebsiteFidelityToaDemoStatusForError(error));
  }

  revalidatePath(ROUTE_PATH);
  redirect(`${ROUTE_PATH}?run=${WEBSITE_FIDELITY_TOA_DEMO_ARTIFACT_ID}&status=run_complete`);
}

function redirectWithStatus(status: string): never {
  redirect(`${ROUTE_PATH}?status=${encodeURIComponent(status)}`);
}
