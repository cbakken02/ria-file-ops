import type { DataIntelligenceV2Config } from "@/lib/data-intelligence-v2/config";
import { getDefaultRevealTokenService } from "@/lib/data-intelligence-v2/service-factory";
import type { RevealTokenService } from "@/lib/data-intelligence-v2/reveal-token-service";
import type { DataIntelligenceV2AuthContext } from "@/lib/data-intelligence-v2/types";

export type RevealApiHandlerArgs = {
  requestBody: unknown;
  authContext: DataIntelligenceV2AuthContext | null;
  config: DataIntelligenceV2Config;
  revealTokenService?: RevealTokenService;
};

export type RevealApiHandlerResult = {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
};

export const REVEAL_API_NO_CACHE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function handleRevealApiRequest(
  args: RevealApiHandlerArgs,
): Promise<RevealApiHandlerResult> {
  if (!args.config.enabled || !args.config.revealApiEnabled) {
    return response(404, { error: "Not found." });
  }

  if (!args.authContext) {
    return response(401, { error: "Unauthorized." });
  }

  if (!isRecord(args.requestBody)) {
    return response(400, { error: "Request body must be an object." });
  }

  const revealCardId =
    typeof args.requestBody.revealCardId === "string"
      ? args.requestBody.revealCardId.trim()
      : "";
  if (!revealCardId) {
    return response(400, { error: "revealCardId is required." });
  }

  if (!isValidRevealCardId(revealCardId)) {
    return response(400, { error: "Invalid revealCardId." });
  }

  const service = args.revealTokenService ?? getDefaultRevealTokenService();
  try {
    const result = await service.revealSensitiveValue({
      authContext: args.authContext,
      revealCardId,
    });

    if (result.status === "success") {
      if (!result.revealedValue) {
        return response(500, { error: "Reveal failed." });
      }

      return response(200, {
        status: "success",
        revealCardId: result.revealedValue.revealCardId,
        fieldKey: result.revealedValue.fieldKey,
        label: result.revealedValue.label,
        value: result.revealedValue.value,
        expiresAt: result.revealedValue.expiresAt,
      });
    }

    return response(statusCodeForServiceStatus(result.status), {
      status: result.status,
      error: safeMessageForServiceStatus(result.status),
    });
  } catch {
    return response(500, {
      status: "error",
      error: "Reveal failed.",
    });
  }
}

function response(status: number, body: unknown): RevealApiHandlerResult {
  return {
    status,
    headers: REVEAL_API_NO_CACHE_HEADERS,
    body,
  };
}

function statusCodeForServiceStatus(status: string) {
  switch (status) {
    case "denied":
      return 403;
    case "expired":
      return 410;
    case "not_found":
      return 404;
    case "not_supported":
      return 501;
    default:
      return 500;
  }
}

function safeMessageForServiceStatus(status: string) {
  switch (status) {
    case "denied":
      return "Reveal denied.";
    case "expired":
      return "Reveal card expired.";
    case "not_found":
      return "Reveal card not found.";
    case "not_supported":
      return "Reveal is not supported for this value.";
    default:
      return "Reveal failed.";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isValidRevealCardId(value: string) {
  return /^rvl_[A-Za-z0-9_-]{16,160}$/.test(value);
}
