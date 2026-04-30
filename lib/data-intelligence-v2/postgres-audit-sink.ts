import {
  createV2AuditEventId,
  sanitizeV2AuditEvent,
  type V2AuditEvent,
  type V2AuditSink,
} from "@/lib/data-intelligence-v2/audit";

export type PostgresV2AuditSinkQueryClient = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{
    rows: unknown[];
    rowCount?: number;
  }>;
};

const TABLE_NAME = "public.data_intelligence_v2_audit_events";

export class PostgresV2AuditSink implements V2AuditSink {
  private readonly queryClient: PostgresV2AuditSinkQueryClient;

  constructor(args: { queryClient: PostgresV2AuditSinkQueryClient }) {
    this.queryClient = args.queryClient;
  }

  async record(event: V2AuditEvent): Promise<void> {
    const safeEvent = sanitizeV2AuditEvent({
      ...event,
      auditEventId: event.auditEventId ?? createV2AuditEventId(),
    });

    try {
      await this.queryClient.query(
        `
          insert into ${TABLE_NAME} (
            audit_event_id,
            event_type,
            event_category,
            owner_email,
            user_email,
            user_id,
            firm_id,
            role,
            conversation_id,
            message_id,
            reveal_card_id,
            client_id,
            account_id,
            document_id,
            source_id,
            tool_name,
            model_name,
            status,
            allowed,
            reason,
            metadata,
            created_at
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21::jsonb, $22::timestamptz
          )
        `,
        eventToParams(safeEvent),
      );
    } catch {
      throw new Error("V2 audit event insert failed.");
    }
  }
}

function eventToParams(event: V2AuditEvent) {
  return [
    event.auditEventId,
    event.eventType,
    event.eventCategory,
    event.ownerEmail ?? null,
    event.userEmail ?? null,
    event.userId ?? null,
    event.firmId ?? null,
    event.role ?? null,
    event.conversationId ?? null,
    event.messageId ?? null,
    event.revealCardId ?? null,
    event.clientId ?? null,
    event.accountId ?? null,
    event.documentId ?? null,
    event.sourceId ?? null,
    event.toolName ?? null,
    event.modelName ?? null,
    event.status ?? null,
    event.allowed ?? null,
    event.reason ?? null,
    JSON.stringify(event.metadata ?? {}),
    event.createdAt,
  ];
}
