"use server";

import { upsertWaitlistSignup } from "@/lib/db";
import { getSafeErrorMetadata } from "@/lib/safe-logging";
import {
  type WaitlistFormState,
  validateWaitlistSignupFormData,
} from "@/lib/waitlist-signups";

export async function submitWaitlistSignup(
  _previousState: WaitlistFormState,
  formData: FormData,
): Promise<WaitlistFormState> {
  const validation = validateWaitlistSignupFormData(formData);

  if (!validation.ok) {
    return {
      fieldErrors: validation.fieldErrors,
      message: "Please fix the highlighted fields.",
      ok: false,
    };
  }

  try {
    const result = upsertWaitlistSignup(validation.input);

    return {
      alreadyExisted: result.alreadyExisted,
      fieldErrors: {},
      message: result.alreadyExisted
        ? "You're already on the waitlist. We refreshed your details."
        : "You're on the waitlist. We'll follow up when we're ready to onboard more firms.",
      ok: true,
    };
  } catch (error) {
    console.error("[waitlist] signup failed", getSafeErrorMetadata(error));

    return {
      fieldErrors: {},
      message:
        "We couldn't save your waitlist request. Please try again in a moment.",
      ok: false,
    };
  }
}
