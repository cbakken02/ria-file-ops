import {
  checkRateLimit,
  getClientIpAddressFromHeaders,
  type HeaderReader,
  type RateLimitResult,
  type RateLimitRule,
  type RateLimitStore,
} from "@/lib/rate-limit";
import { WAITLIST_HONEYPOT_FIELD_NAME } from "@/lib/waitlist-signups";

const WAITLIST_BY_IP: RateLimitRule = {
  keyPrefix: "waitlist:submit:ip",
  limit: 5,
  windowMs: 10 * 60 * 1000,
};

const WAITLIST_BY_EMAIL: RateLimitRule = {
  keyPrefix: "waitlist:submit:email",
  limit: 3,
  windowMs: 60 * 60 * 1000,
};

export const WAITLIST_RATE_LIMIT_MESSAGE =
  "Too many waitlist submissions. Please wait a bit before trying again.";

export const WAITLIST_GENERIC_FAILURE_MESSAGE =
  "We couldn't save your waitlist request. Please try again in a moment.";

export type WaitlistAbuseProtectionResult =
  | {
      ok: true;
    }
  | {
      message: string;
      ok: false;
      rateLimit?: RateLimitResult;
      reason: "honeypot" | "rate_limited";
    };

export function checkWaitlistSubmissionAbuse(input: {
  formData: FormData;
  headers?: HeaderReader;
  ipAddress?: string;
  now?: number;
  store?: RateLimitStore;
}): WaitlistAbuseProtectionResult {
  if (isWaitlistHoneypotFilled(input.formData)) {
    return {
      message: WAITLIST_GENERIC_FAILURE_MESSAGE,
      ok: false,
      reason: "honeypot",
    };
  }

  const ipAddress =
    input.ipAddress ??
    (input.headers ? getClientIpAddressFromHeaders(input.headers) : "unknown");
  if (ipAddress && ipAddress !== "unknown") {
    const ipLimit = checkRateLimit({
      keyParts: [ipAddress],
      now: input.now,
      rule: WAITLIST_BY_IP,
      store: input.store,
    });

    if (!ipLimit.allowed) {
      return {
        message: WAITLIST_RATE_LIMIT_MESSAGE,
        ok: false,
        rateLimit: ipLimit,
        reason: "rate_limited",
      };
    }
  }

  const email = getNormalizedEmailFromFormData(input.formData);
  if (email) {
    const emailLimit = checkRateLimit({
      keyParts: [email],
      now: input.now,
      rule: WAITLIST_BY_EMAIL,
      store: input.store,
    });

    if (!emailLimit.allowed) {
      return {
        message: WAITLIST_RATE_LIMIT_MESSAGE,
        ok: false,
        rateLimit: emailLimit,
        reason: "rate_limited",
      };
    }
  }

  return { ok: true };
}

export function isWaitlistHoneypotFilled(formData: FormData) {
  const value = formData.get(WAITLIST_HONEYPOT_FIELD_NAME);
  return typeof value === "string" && value.trim().length > 0;
}

function getNormalizedEmailFromFormData(formData: FormData) {
  const value = formData.get("email");
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
