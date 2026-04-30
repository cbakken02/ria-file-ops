import { randomUUID } from "node:crypto";
import { getFieldDefinition } from "@/lib/data-intelligence-v2/field-catalog";
import {
  authorizeOwnerScope,
  authorizeSensitiveReveal,
} from "@/lib/data-intelligence-v2/policy";
import {
  assertNoUnsafeModelContent,
  sanitizeTextForModel,
} from "@/lib/data-intelligence-v2/safe-memory";
import type {
  RevealAuditEvent,
  RevealAuditSink,
} from "@/lib/data-intelligence-v2/reveal-audit";
import { NoopRevealAuditSink } from "@/lib/data-intelligence-v2/reveal-audit";
import type { SensitiveValueProvider } from "@/lib/data-intelligence-v2/sensitive-value-provider";
import type {
  CreateRevealCardArgs,
  ModelSafeRevealCard,
  PolicyDecision,
  RevealCardRecord,
  RevealSensitiveValueArgs,
  RevealedSensitiveValue,
  SensitiveValueTarget,
} from "@/lib/data-intelligence-v2/types";

const DEFAULT_REVEAL_EXPIRES_IN_MS = 10 * 60 * 1000;

export interface RevealTokenStore {
  create(record: RevealCardRecord): Promise<void>;
  get(revealCardId: string): Promise<RevealCardRecord | undefined>;
  update(record: RevealCardRecord): Promise<void>;
  delete?(revealCardId: string): Promise<void>;
  claimForReveal?(args: {
    revealCardId: string;
    now: string;
  }): Promise<RevealCardClaimResult>;
}

export type RevealCardClaimResult =
  | { status: "claimed"; record: RevealCardRecord }
  | { status: "not_found" }
  | { status: "expired"; record?: RevealCardRecord }
  | { status: "consumed"; record?: RevealCardRecord }
  | { status: "revoked"; record?: RevealCardRecord };

export class InMemoryRevealTokenStore implements RevealTokenStore {
  private readonly records = new Map<string, RevealCardRecord>();

  async create(record: RevealCardRecord): Promise<void> {
    this.records.set(record.revealCardId, { ...record });
  }

  async get(revealCardId: string): Promise<RevealCardRecord | undefined> {
    const record = this.records.get(revealCardId);
    return record ? { ...record } : undefined;
  }

  async update(record: RevealCardRecord): Promise<void> {
    this.records.set(record.revealCardId, { ...record });
  }

  async delete(revealCardId: string): Promise<void> {
    this.records.delete(revealCardId);
  }

  async claimForReveal(args: {
    revealCardId: string;
    now: string;
  }): Promise<RevealCardClaimResult> {
    const record = this.records.get(args.revealCardId);
    if (!record) {
      return { status: "not_found" };
    }

    if (record.revokedAt) {
      return { status: "revoked", record: { ...record } };
    }

    if (Date.parse(record.expiresAt) <= Date.parse(args.now)) {
      return { status: "expired", record: { ...record } };
    }

    if (record.oneTimeUse && record.consumedAt) {
      return { status: "consumed", record: { ...record } };
    }

    const claimed = { ...record };
    if (claimed.oneTimeUse) {
      claimed.consumedAt = args.now;
      this.records.set(args.revealCardId, { ...claimed });
    }

    return { status: "claimed", record: claimed };
  }
}

export class RevealTokenService {
  private readonly store: RevealTokenStore;
  private readonly sensitiveValueProvider: SensitiveValueProvider;
  private readonly auditSink: RevealAuditSink;
  private readonly now: () => Date;
  private readonly defaultExpiresInMs: number;

  constructor(args: {
    store?: RevealTokenStore;
    sensitiveValueProvider: SensitiveValueProvider;
    auditSink?: RevealAuditSink;
    now?: () => Date;
    defaultExpiresInMs?: number;
  }) {
    this.store = args.store ?? new InMemoryRevealTokenStore();
    this.sensitiveValueProvider = args.sensitiveValueProvider;
    this.auditSink = args.auditSink ?? new NoopRevealAuditSink();
    this.now = args.now ?? (() => new Date());
    this.defaultExpiresInMs =
      args.defaultExpiresInMs ?? DEFAULT_REVEAL_EXPIRES_IN_MS;
  }

  async createRevealCard(args: CreateRevealCardArgs): Promise<{
    status: "success" | "denied" | "not_found" | "not_supported" | "error";
    summary: string;
    revealCard?: ModelSafeRevealCard;
    policyDecision?: PolicyDecision;
  }> {
    const createdAt = this.now();
    const fieldDefinition = getFieldDefinition(args.fieldKey);
    const baseAudit = auditBase(args, createdAt.toISOString());

    if (!fieldDefinition) {
      await this.recordAudit({
        ...baseAudit,
        eventType: "reveal_card_denied",
        allowed: false,
        reason: "Unknown reveal field.",
      });
      return {
        status: "denied",
        summary: "Reveal card creation denied for unknown field.",
      };
    }

    if (
      fieldDefinition.classification !== "reveal_card_only_never_to_model" ||
      !fieldDefinition.canRevealToAuthorizedUser
    ) {
      const decision = {
        allowed: false,
        reason: `${fieldDefinition.fieldKey} is not reveal-card eligible.`,
      };
      await this.recordAudit({
        ...baseAudit,
        eventType: "reveal_card_denied",
        allowed: false,
        reason: decision.reason,
      });
      return {
        status: "denied",
        summary: decision.reason,
        policyDecision: decision,
      };
    }

    const policyDecision = authorizeSensitiveReveal({
      authContext: args.authContext,
      requestedOwnerEmail: args.requestedOwnerEmail,
      clientId: args.clientId,
      fieldKey: args.fieldKey,
      purpose: args.purpose,
    });
    if (!policyDecision.allowed) {
      await this.recordAudit({
        ...baseAudit,
        eventType: "reveal_card_denied",
        allowed: false,
        reason: policyDecision.reason,
      });
      return {
        status: "denied",
        summary: policyDecision.reason,
        policyDecision,
      };
    }

    let status;
    try {
      status = await this.sensitiveValueProvider.getSensitiveValueStatus(
        targetFromCreateArgs(args),
      );
    } catch {
      await this.recordAudit({
        ...baseAudit,
        eventType: "reveal_card_denied",
        allowed: false,
        reason: "Sensitive value status lookup failed.",
      });
      return {
        status: "error",
        summary: "Sensitive value status lookup failed.",
      };
    }

    if (status.status === "not_found") {
      await this.recordAudit({
        ...baseAudit,
        eventType: "reveal_card_denied",
        allowed: false,
        reason: `${fieldDefinition.label} was not found.`,
      });
      return {
        status: "not_found",
        summary: `${fieldDefinition.label} was not found.`,
      };
    }

    if (status.status === "not_supported" || status.status === "unknown") {
      await this.recordAudit({
        ...baseAudit,
        eventType: "reveal_card_denied",
        allowed: false,
        reason: `${fieldDefinition.label} reveal is not supported yet.`,
      });
      return {
        status: "not_supported",
        summary: `${fieldDefinition.label} reveal is not supported yet.`,
      };
    }

    const revealCardId = generateRevealCardId();
    const expiresInMs = args.expiresInMs ?? this.defaultExpiresInMs;
    const expiresAt = new Date(createdAt.getTime() + expiresInMs).toISOString();
    const fieldLabel = sanitizeTextForModel(
      status.fieldLabel || fieldDefinition.label,
    );
    const label = sanitizeTextForModel(
      args.label?.trim() || status.label || fieldLabel,
    );
    const record: RevealCardRecord = {
      revealCardId,
      ownerEmail: args.requestedOwnerEmail,
      userEmail: args.authContext.userEmail,
      userId: args.authContext.userId,
      firmId: args.authContext.firmId,
      role: args.authContext.role,
      clientId: args.clientId,
      accountId: args.accountId,
      documentId: args.documentId,
      sourceId: status.sourceId ?? args.sourceId,
      fieldKey: args.fieldKey,
      fieldLabel,
      label,
      purpose: args.purpose,
      createdAt: createdAt.toISOString(),
      expiresAt,
      oneTimeUse: args.oneTimeUse ?? true,
      actualValueWasNotShownToModel: true,
    };

    const revealCard: ModelSafeRevealCard = {
      revealCardId,
      fieldKey: args.fieldKey,
      fieldLabel,
      clientId: args.clientId,
      accountId: args.accountId,
      documentId: args.documentId,
      label,
      maskedValue:
        typeof status.maskedValue === "string"
          ? sanitizeTextForModel(status.maskedValue)
          : undefined,
      status: status.status,
      expiresAt,
      actualValueWasNotShownToModel: true,
    };

    const response = {
      status: "success" as const,
      summary: "Secure reveal card created. The raw value was not shown to the model.",
      revealCard,
      policyDecision,
    };
    try {
      assertNoUnsafeModelContent(response);
    } catch {
      await this.recordAudit({
        ...baseAudit,
        eventType: "reveal_card_denied",
        allowed: false,
        reason: "Reveal card failed model-safety validation.",
      });
      return {
        status: "error",
        summary: "Reveal card failed model-safety validation.",
      };
    }

    await this.store.create(record);
    await this.recordAudit({
      ...baseAudit,
      eventType: "reveal_card_created",
      revealCardId,
      allowed: true,
      reason: "Secure reveal card created.",
    });

    return response;
  }

  async revealSensitiveValue(args: RevealSensitiveValueArgs): Promise<{
    status:
      | "success"
      | "denied"
      | "expired"
      | "not_found"
      | "not_supported"
      | "error";
    summary: string;
    revealedValue?: RevealedSensitiveValue;
  }> {
    const record = await this.store.get(args.revealCardId);
    const eventTime = this.now().toISOString();

    if (!record) {
      await this.recordAudit({
        eventType: "sensitive_value_reveal_denied",
        revealCardId: args.revealCardId,
        ownerEmail: args.authContext.ownerEmail,
        userEmail: args.authContext.userEmail,
        userId: args.authContext.userId,
        firmId: args.authContext.firmId,
        role: args.authContext.role,
        allowed: false,
        reason: "Reveal card not found.",
        createdAt: eventTime,
      });
      return {
        status: "not_found",
        summary: "Reveal card not found.",
      };
    }

    const baseAudit = auditBaseFromRecord(record, args.authContext, eventTime);

    if (record.revokedAt) {
      await this.recordAudit({
        ...baseAudit,
        eventType: "sensitive_value_reveal_denied",
        allowed: false,
        reason: "Reveal card was revoked.",
      });
      return { status: "denied", summary: "Reveal card was revoked." };
    }

    if (Date.parse(record.expiresAt) <= this.now().getTime()) {
      await this.recordAudit({
        ...baseAudit,
        eventType: "reveal_card_expired",
        allowed: false,
        reason: "Reveal card expired.",
      });
      return { status: "expired", summary: "Reveal card expired." };
    }

    if (record.oneTimeUse && record.consumedAt) {
      await this.recordAudit({
        ...baseAudit,
        eventType: "sensitive_value_reveal_denied",
        allowed: false,
        reason: "Reveal card was already consumed.",
      });
      return {
        status: "denied",
        summary: "Reveal card was already consumed.",
      };
    }

    const sameUser = record.userEmail === args.authContext.userEmail;
    const adminOverride = args.authContext.role === "admin";
    if (!sameUser && !adminOverride) {
      await this.recordAudit({
        ...baseAudit,
        eventType: "sensitive_value_reveal_denied",
        allowed: false,
        reason: "Reveal card can only be used by its creator or an admin.",
      });
      return {
        status: "denied",
        summary: "Reveal card can only be used by its creator or an admin.",
      };
    }

    const ownerDecision = authorizeOwnerScope({
      authContext: args.authContext,
      requestedOwnerEmail: record.ownerEmail,
    });
    if (!ownerDecision.allowed) {
      await this.recordAudit({
        ...baseAudit,
        eventType: "sensitive_value_reveal_denied",
        allowed: false,
        reason: ownerDecision.reason,
      });
      return { status: "denied", summary: ownerDecision.reason };
    }

    const policyDecision = authorizeSensitiveReveal({
      authContext: args.authContext,
      requestedOwnerEmail: record.ownerEmail,
      clientId: record.clientId,
      fieldKey: record.fieldKey,
      purpose: record.purpose,
    });
    if (!policyDecision.allowed) {
      await this.recordAudit({
        ...baseAudit,
        eventType: "sensitive_value_reveal_denied",
        allowed: false,
        reason: policyDecision.reason,
      });
      return { status: "denied", summary: policyDecision.reason };
    }

    let activeRecord = record;
    let claimedAtomically = false;
    if (this.store.claimForReveal) {
      const claimResult = await this.store.claimForReveal({
        revealCardId: record.revealCardId,
        now: eventTime,
      });

      if (claimResult.status !== "claimed") {
        const claimResultRecord =
          "record" in claimResult ? claimResult.record : undefined;
        const claimAuditBase = claimResultRecord
          ? auditBaseFromRecord(claimResultRecord, args.authContext, eventTime)
          : baseAudit;
        if (claimResult.status === "expired") {
          await this.recordAudit({
            ...claimAuditBase,
            eventType: "reveal_card_expired",
            allowed: false,
            reason: "Reveal card expired.",
          });
          return { status: "expired", summary: "Reveal card expired." };
        }
        await this.recordAudit({
          ...claimAuditBase,
          eventType: "sensitive_value_reveal_denied",
          allowed: false,
          reason: `Reveal card could not be claimed: ${claimResult.status}.`,
        });
        return {
          status: claimResult.status === "not_found" ? "not_found" : "denied",
          summary: `Reveal card could not be claimed: ${claimResult.status}.`,
        };
      }

      activeRecord = claimResult.record;
      claimedAtomically = true;
    }

    let revealResult;
    try {
      revealResult = await this.sensitiveValueProvider.revealSensitiveValue({
        ownerEmail: activeRecord.ownerEmail,
        clientId: activeRecord.clientId,
        accountId: activeRecord.accountId,
        documentId: activeRecord.documentId,
        sourceId: activeRecord.sourceId,
        fieldKey: activeRecord.fieldKey,
      });
    } catch {
      await this.recordAudit({
        ...baseAudit,
        eventType: "sensitive_value_reveal_denied",
        allowed: false,
        reason: "Sensitive value lookup failed.",
      });
      return { status: "error", summary: "Sensitive value lookup failed." };
    }

    if (revealResult.status !== "success" || !revealResult.value) {
      await this.recordAudit({
        ...baseAudit,
        eventType: "sensitive_value_reveal_denied",
        allowed: false,
        reason: `Sensitive value reveal returned ${revealResult.status}.`,
      });
      return {
        status: revealResult.status,
        summary: `Sensitive value reveal returned ${revealResult.status}.`,
      };
    }

    if (record.oneTimeUse) {
      if (!claimedAtomically) {
        record.consumedAt = eventTime;
        await this.store.update(record);
      }
      await this.recordAudit({
        ...baseAudit,
        eventType: "reveal_card_consumed",
        allowed: true,
        reason: "One-time reveal card consumed.",
      });
    }

    await this.recordAudit({
      ...baseAudit,
      eventType: "sensitive_value_revealed",
      allowed: true,
      reason: "Sensitive value revealed to authorized user outside the model path.",
    });

    return {
      status: "success",
      summary: "Sensitive value revealed to authorized user outside the model path.",
      revealedValue: {
        revealCardId: activeRecord.revealCardId,
        fieldKey: activeRecord.fieldKey,
        label: activeRecord.label,
        value: revealResult.value,
        expiresAt: activeRecord.expiresAt,
      },
    };
  }

  private async recordAudit(event: RevealAuditEvent) {
    try {
      await this.auditSink.record(event);
    } catch {
      // Audit failures must never expose sensitive values or raw provider
      // errors. Runtime callers fail open here; production should monitor the
      // durable sink health separately.
    }
  }
}

function targetFromCreateArgs(args: CreateRevealCardArgs): SensitiveValueTarget {
  return {
    ownerEmail: args.requestedOwnerEmail,
    clientId: args.clientId,
    accountId: args.accountId,
    documentId: args.documentId,
    sourceId: args.sourceId,
    fieldKey: args.fieldKey,
  };
}

function generateRevealCardId() {
  return `rvl_${randomUUID()
    .split("-")
    .map((part) => `x${part}`)
    .join("_")}`;
}

function auditBase(args: CreateRevealCardArgs, createdAt: string) {
  return {
    ownerEmail: args.requestedOwnerEmail,
    userEmail: args.authContext.userEmail,
    userId: args.authContext.userId,
    firmId: args.authContext.firmId,
    role: args.authContext.role,
    clientId: args.clientId,
    accountId: args.accountId,
    documentId: args.documentId,
    sourceId: args.sourceId,
    fieldKey: args.fieldKey,
    purpose: args.purpose,
    createdAt,
  };
}

function auditBaseFromRecord(
  record: RevealCardRecord,
  authContext: RevealSensitiveValueArgs["authContext"],
  createdAt: string,
) {
  return {
    revealCardId: record.revealCardId,
    ownerEmail: record.ownerEmail,
    userEmail: authContext.userEmail,
    userId: authContext.userId,
    firmId: authContext.firmId,
    role: authContext.role,
    clientId: record.clientId,
    accountId: record.accountId,
    documentId: record.documentId,
    sourceId: record.sourceId,
    fieldKey: record.fieldKey,
    purpose: record.purpose,
    createdAt,
  };
}
