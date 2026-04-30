import type {
  DataIntelligenceV2AuthContext,
  RevealPurpose,
} from "@/lib/data-intelligence-v2/types";
import {
  mapRevealAuditEventToV2AuditEvent,
  type V2AuditSink,
} from "@/lib/data-intelligence-v2/audit";

export type RevealAuditEventType =
  | "reveal_card_created"
  | "reveal_card_denied"
  | "sensitive_value_revealed"
  | "sensitive_value_reveal_denied"
  | "reveal_card_expired"
  | "reveal_card_consumed";

export type RevealAuditEvent = {
  eventType: RevealAuditEventType;
  revealCardId?: string;
  ownerEmail: string;
  userEmail: string;
  userId?: string;
  firmId?: string;
  role?: DataIntelligenceV2AuthContext["role"];
  clientId?: string;
  accountId?: string;
  documentId?: string;
  sourceId?: string;
  fieldKey?: string;
  purpose?: RevealPurpose;
  allowed: boolean;
  reason: string;
  createdAt: string;
};

export interface RevealAuditSink {
  record(event: RevealAuditEvent): Promise<void>;
}

export class NoopRevealAuditSink implements RevealAuditSink {
  async record(): Promise<void> {
    return;
  }
}

export class InMemoryRevealAuditSink implements RevealAuditSink {
  readonly events: RevealAuditEvent[] = [];

  async record(event: RevealAuditEvent): Promise<void> {
    this.events.push({ ...event });
  }
}

export class V2RevealAuditSinkAdapter implements RevealAuditSink {
  private readonly auditSink: V2AuditSink;

  constructor(auditSink: V2AuditSink) {
    this.auditSink = auditSink;
  }

  async record(event: RevealAuditEvent): Promise<void> {
    await this.auditSink.record(mapRevealAuditEventToV2AuditEvent(event));
  }
}
