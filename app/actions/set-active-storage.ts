"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getStorageConnectionByOwnerAndId,
  setPrimaryStorageConnectionForOwner,
} from "@/lib/db";
import { requireSession } from "@/lib/session";

export async function setActiveStorageForPathAction(formData: FormData) {
  const session = await requireSession();
  const ownerEmail = session.user?.email ?? "";
  const connectionId = String(formData.get("connectionId") ?? "").trim();
  const returnTo = normalizeReturnPath(
    String(formData.get("returnTo") ?? "").trim(),
  );

  if (!ownerEmail || !connectionId) {
    redirect(returnTo);
  }

  const existing = getStorageConnectionByOwnerAndId(ownerEmail, connectionId);
  if (!existing) {
    redirect(returnTo);
  }

  setPrimaryStorageConnectionForOwner({ ownerEmail, connectionId });

  revalidatePath("/dashboard");
  revalidatePath("/preview");
  revalidatePath("/cleanup");
  revalidatePath("/history");
  revalidatePath("/setup");
  revalidatePath("/setup/google-drive");
  redirect(returnTo);
}

function normalizeReturnPath(raw: string) {
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    return "/setup?section=workspace";
  }

  return raw;
}
