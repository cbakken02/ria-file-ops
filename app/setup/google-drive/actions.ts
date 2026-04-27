"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getStorageConnectionByOwnerAndId,
  setPrimaryStorageConnectionForOwner,
} from "@/lib/db";
import { requireSession } from "@/lib/session";

export async function setActiveStorageConnectionAction(formData: FormData) {
  const session = await requireSession();
  const ownerEmail = session.user?.email ?? "";
  const connectionId = String(formData.get("connectionId") ?? "").trim();

  if (!ownerEmail || !connectionId) {
    redirect("/setup?section=workspace&notice=Select+a+storage+connection+first.");
  }

  const existing = getStorageConnectionByOwnerAndId(ownerEmail, connectionId);
  if (!existing) {
    redirect("/setup?section=workspace&notice=That+storage+connection+could+not+be+found.");
  }

  setPrimaryStorageConnectionForOwner({ ownerEmail, connectionId });

  revalidatePath("/dashboard");
  revalidatePath("/preview");
  revalidatePath("/setup");
  revalidatePath("/setup/google-drive");
  redirect("/setup?section=workspace&notice=Active+storage+connection+updated.");
}
