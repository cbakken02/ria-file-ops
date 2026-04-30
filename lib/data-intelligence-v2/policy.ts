import {
  getFieldDefinitionByAlias,
  isFieldAllowedForModel,
} from "@/lib/data-intelligence-v2/field-catalog";
import { assertNoUnsafeModelContent } from "@/lib/data-intelligence-v2/safe-memory";
import type {
  DataIntelligenceV2AuthContext,
  PolicyDecision,
  RevealPurpose,
} from "@/lib/data-intelligence-v2/types";

export function authorizeOwnerScope(args: {
  authContext: DataIntelligenceV2AuthContext;
  requestedOwnerEmail: string;
}): PolicyDecision {
  const { authContext, requestedOwnerEmail } = args;

  if (requestedOwnerEmail === authContext.ownerEmail) {
    return { allowed: true, reason: "Requested owner matches session scope." };
  }

  if (authContext.allowedOwnerEmails?.includes(requestedOwnerEmail)) {
    return {
      allowed: true,
      reason: "Requested owner is explicitly allowed for this session.",
    };
  }

  return {
    allowed: false,
    reason: "Requested owner is outside the authorized owner scope.",
  };
}

export function authorizeFieldExposureToModel(args: {
  fieldKey: string;
}): PolicyDecision {
  const definition = getFieldDefinitionByAlias(args.fieldKey);

  if (!definition) {
    return {
      allowed: false,
      reason: `Unknown field is not approved for model exposure: ${args.fieldKey}.`,
    };
  }

  if (!isFieldAllowedForModel(definition.fieldKey)) {
    return {
      allowed: false,
      reason: `${definition.fieldKey} is not allowed in model-bound payloads.`,
    };
  }

  return {
    allowed: true,
    reason: `${definition.fieldKey} is allowed in model-bound payloads.`,
  };
}

export function authorizeSensitiveReveal(args: {
  authContext: DataIntelligenceV2AuthContext;
  requestedOwnerEmail: string;
  clientId?: string;
  fieldKey: string;
  purpose?: RevealPurpose;
}): PolicyDecision {
  const ownerDecision = authorizeOwnerScope({
    authContext: args.authContext,
    requestedOwnerEmail: args.requestedOwnerEmail,
  });
  if (!ownerDecision.allowed) {
    return ownerDecision;
  }

  const definition = getFieldDefinitionByAlias(args.fieldKey);
  if (!definition) {
    return {
      allowed: false,
      reason: `Unknown field cannot be revealed: ${args.fieldKey}.`,
    };
  }

  if (!definition.canRevealToAuthorizedUser) {
    return {
      allowed: false,
      reason: `${definition.fieldKey} is not revealable.`,
    };
  }

  if (args.authContext.role === "readonly") {
    return {
      allowed: false,
      reason: "Readonly users cannot reveal sensitive values.",
    };
  }

  if (args.authContext.allowSensitiveReveal !== true) {
    return {
      allowed: false,
      reason: "Sensitive reveal is not enabled for this session.",
    };
  }

  if (
    args.clientId &&
    args.authContext.allowedClientIds &&
    !args.authContext.allowedClientIds.includes(args.clientId)
  ) {
    return {
      allowed: false,
      reason: "Requested client is outside the authorized client scope.",
    };
  }

  if (definition.requiresRevealPurpose && !args.purpose) {
    return {
      allowed: false,
      reason: `${definition.fieldKey} requires a reveal purpose.`,
    };
  }

  return {
    allowed: true,
    reason: `${definition.fieldKey} reveal is authorized.`,
  };
}

export function authorizeModelBoundPayload(args: {
  payload: unknown;
}): PolicyDecision {
  try {
    assertNoUnsafeModelContent(args.payload);
  } catch (error) {
    return {
      allowed: false,
      reason:
        error instanceof Error
          ? error.message
          : "Model-bound payload contains unsafe sensitive content.",
    };
  }

  return {
    allowed: true,
    reason: "Model-bound payload passed sensitive-content checks.",
  };
}
