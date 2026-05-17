"use server";

import { revalidatePath } from "next/cache";
import { requireWaitlistAdminSession } from "@/lib/admin";
import { setWaitlistSignupStatus } from "@/lib/db";
import { isWaitlistSignupStatus } from "@/lib/waitlist-signups";

export async function updateWaitlistSignupStatusAction(formData: FormData) {
  await requireWaitlistAdminSession();

  const id = formData.get("id");
  const status = formData.get("status");

  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Missing waitlist signup id.");
  }

  if (!isWaitlistSignupStatus(status)) {
    throw new Error("Invalid waitlist signup status.");
  }

  setWaitlistSignupStatus({
    id: id.trim(),
    status,
  });

  revalidatePath("/admin/waitlist");
}
