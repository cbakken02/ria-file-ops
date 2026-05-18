"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getStorageConnectionByOwnerAndId,
  setPrimaryStorageConnectionForOwner,
} from "@/lib/db";
import { assertCanUseStorageConnection } from "@/lib/auth/resource-guards";
import { getLegacyOwnerEmail, requireAppPrincipal } from "@/lib/auth/principal";

// Internal migration/admin escape hatch only. Normal workspace UI is single-storage
// and must not let users switch among historical connection records.
export async function setActiveStorageConnectionAction(formData: FormData) {
  const principal = await requireAppPrincipal();
  const ownerEmail = getLegacyOwnerEmail(principal);
  const connectionId = String(formData.get("connectionId") ?? "").trim();

  if (!isInternalStorageSwitchingEnabled()) {
    redirect(
      `/setup?section=workspace&notice=${encodeURIComponent(
        "Storage switching is disabled. Use Replace storage connection instead.",
      )}`,
    );
  }

  if (!ownerEmail || !connectionId) {
    redirect("/setup?section=workspace&notice=Select+a+storage+connection+first.");
  }

  const existing = getStorageConnectionByOwnerAndId(ownerEmail, connectionId);
  if (!existing) {
    redirect("/setup?section=workspace&notice=That+storage+connection+could+not+be+found.");
  }
  assertCanUseStorageConnection(principal, existing);

  setPrimaryStorageConnectionForOwner({ ownerEmail, connectionId });

  revalidatePath("/dashboard");
  revalidatePath("/intake");
  revalidatePath("/setup");
  revalidatePath("/setup/google-drive");
  redirect("/setup?section=workspace&notice=Active+storage+connection+updated.");
}

function isInternalStorageSwitchingEnabled() {
  return process.env.STORAGE_CONNECTION_SWITCHING_MIGRATION_ENABLED === "true";
}
