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
export async function setActiveStorageForPathAction(formData: FormData) {
  const principal = await requireAppPrincipal();
  const ownerEmail = getLegacyOwnerEmail(principal);
  const connectionId = String(formData.get("connectionId") ?? "").trim();
  const returnTo = normalizeReturnPath(
    String(formData.get("returnTo") ?? "").trim(),
  );

  if (!isInternalStorageSwitchingEnabled()) {
    redirect(
      withNotice(
        returnTo,
        "Storage switching is disabled. Use Replace storage connection instead.",
      ),
    );
  }

  if (!ownerEmail || !connectionId) {
    redirect(returnTo);
  }

  const existing = getStorageConnectionByOwnerAndId(ownerEmail, connectionId);
  if (!existing) {
    redirect(returnTo);
  }
  assertCanUseStorageConnection(principal, existing);

  setPrimaryStorageConnectionForOwner({ ownerEmail, connectionId });

  revalidatePath("/dashboard");
  revalidatePath("/intake");
  revalidatePath("/clean-up");
  revalidatePath("/history");
  revalidatePath("/setup");
  revalidatePath("/setup/google-drive");
  redirect(returnTo);
}

function normalizeReturnPath(raw: string) {
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    return "/setup?section=workspace";
  }

  if (raw === "/preview") {
    return "/intake";
  }

  if (raw === "/cleanup") {
    return "/clean-up";
  }

  return raw;
}

function isInternalStorageSwitchingEnabled() {
  return process.env.STORAGE_CONNECTION_SWITCHING_MIGRATION_ENABLED === "true";
}

function withNotice(returnTo: string, notice: string) {
  const separator = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${separator}notice=${encodeURIComponent(notice)}`;
}
