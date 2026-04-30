import {
  containsUnsafeSensitivePattern,
  sanitizeTextForModel,
} from "@/lib/data-intelligence-v2/safe-memory";
import type {
  DataIntelligenceV2AuthContext,
  RevealCardRecord,
  RevealPurpose,
  SensitiveRevealFieldKey,
} from "@/lib/data-intelligence-v2/types";
import type {
  RevealCardClaimResult,
  RevealTokenStore,
} from "@/lib/data-intelligence-v2/reveal-token-service";

export type PostgresRevealTokenStoreQueryClient = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{
    rows: unknown[];
    rowCount?: number;
  }>;
};

const TABLE_NAME = "public.data_intelligence_v2_reveal_cards";

export class PostgresRevealTokenStore implements RevealTokenStore {
  private readonly queryClient: PostgresRevealTokenStoreQueryClient;

  constructor(args: { queryClient: PostgresRevealTokenStoreQueryClient }) {
    this.queryClient = args.queryClient;
  }

  async create(record: RevealCardRecord): Promise<void> {
    const safeRecord = sanitizeRecordForStorage(record);
    await this.queryClient.query(
      `
        insert into ${TABLE_NAME} (
          reveal_card_id,
          owner_email,
          user_email,
          user_id,
          firm_id,
          role,
          client_id,
          account_id,
          document_id,
          source_id,
          field_key,
          field_label,
          label,
          purpose,
          created_at,
          expires_at,
          one_time_use,
          consumed_at,
          revoked_at,
          actual_value_was_not_shown_to_model,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15::timestamptz, $16::timestamptz,
          $17, $18::timestamptz, $19::timestamptz, true, now()
        )
      `,
      recordToParams(safeRecord),
    );
  }

  async get(revealCardId: string): Promise<RevealCardRecord | undefined> {
    const result = await this.queryClient.query(
      `select * from ${TABLE_NAME} where reveal_card_id = $1 limit 1`,
      [sanitizeTextForModel(revealCardId)],
    );

    const row = result.rows[0];
    return row ? rowToRevealCardRecord(row) : undefined;
  }

  async update(record: RevealCardRecord): Promise<void> {
    const safeRecord = sanitizeRecordForStorage(record);
    await this.queryClient.query(
      `
        update ${TABLE_NAME}
        set consumed_at = $2::timestamptz,
            revoked_at = $3::timestamptz,
            expires_at = $4::timestamptz,
            updated_at = now()
        where reveal_card_id = $1
      `,
      [
        safeRecord.revealCardId,
        safeRecord.consumedAt ?? null,
        safeRecord.revokedAt ?? null,
        safeRecord.expiresAt,
      ],
    );
  }

  async delete(revealCardId: string): Promise<void> {
    await this.queryClient.query(
      `delete from ${TABLE_NAME} where reveal_card_id = $1`,
      [sanitizeTextForModel(revealCardId)],
    );
  }

  async claimForReveal(args: {
    revealCardId: string;
    now: string;
  }): Promise<RevealCardClaimResult> {
    const revealCardId = sanitizeTextForModel(args.revealCardId);
    const now = isoString(args.now, "now");
    const result = await this.queryClient.query(
      `
        update ${TABLE_NAME}
        set consumed_at = case
              when one_time_use then $2::timestamptz
              else consumed_at
            end,
            updated_at = now()
        where reveal_card_id = $1
          and revoked_at is null
          and expires_at > $2::timestamptz
          and (one_time_use = false or consumed_at is null)
        returning *
      `,
      [revealCardId, now],
    );

    const claimedRow = result.rows[0];
    if (claimedRow) {
      return {
        status: "claimed",
        record: rowToRevealCardRecord(claimedRow),
      };
    }

    const record = await this.get(revealCardId);
    if (!record) {
      return { status: "not_found" };
    }
    if (record.revokedAt) {
      return { status: "revoked", record };
    }
    if (Date.parse(record.expiresAt) <= Date.parse(now)) {
      return { status: "expired", record };
    }
    if (record.oneTimeUse && record.consumedAt) {
      return { status: "consumed", record };
    }

    return { status: "not_found" };
  }
}

function sanitizeRecordForStorage(record: RevealCardRecord): RevealCardRecord {
  const safeRecord: RevealCardRecord = {
    revealCardId: requiredStorageText(record.revealCardId, "revealCardId"),
    ownerEmail: requiredStorageText(record.ownerEmail, "ownerEmail"),
    userEmail: requiredStorageText(record.userEmail, "userEmail"),
    userId: optionalStorageText(record.userId),
    firmId: optionalStorageText(record.firmId),
    role: safeRole(record.role),
    clientId: optionalStorageText(record.clientId),
    accountId: optionalStorageText(record.accountId),
    documentId: optionalStorageText(record.documentId),
    sourceId: optionalStorageText(record.sourceId),
    fieldKey: record.fieldKey,
    fieldLabel: requiredSafeLabel(record.fieldLabel, "fieldLabel"),
    label: requiredSafeLabel(record.label, "label"),
    purpose: record.purpose,
    createdAt: isoString(record.createdAt, "createdAt"),
    expiresAt: isoString(record.expiresAt, "expiresAt"),
    oneTimeUse: Boolean(record.oneTimeUse),
    consumedAt: optionalIsoString(record.consumedAt, "consumedAt"),
    revokedAt: optionalIsoString(record.revokedAt, "revokedAt"),
    actualValueWasNotShownToModel: true,
  };

  rejectUnsafeMetadata(safeRecord);
  return safeRecord;
}

function recordToParams(record: RevealCardRecord) {
  return [
    record.revealCardId,
    record.ownerEmail,
    record.userEmail,
    record.userId ?? null,
    record.firmId ?? null,
    record.role ?? null,
    record.clientId ?? null,
    record.accountId ?? null,
    record.documentId ?? null,
    record.sourceId ?? null,
    record.fieldKey,
    record.fieldLabel,
    record.label,
    record.purpose,
    record.createdAt,
    record.expiresAt,
    record.oneTimeUse,
    record.consumedAt ?? null,
    record.revokedAt ?? null,
  ];
}

function rowToRevealCardRecord(row: unknown): RevealCardRecord {
  if (!isRecord(row)) {
    throw new Error("Invalid reveal card row.");
  }

  const record: RevealCardRecord = {
    revealCardId: requiredStorageText(row.reveal_card_id, "reveal_card_id"),
    ownerEmail: requiredStorageText(row.owner_email, "owner_email"),
    userEmail: requiredStorageText(row.user_email, "user_email"),
    userId: optionalStorageText(row.user_id),
    firmId: optionalStorageText(row.firm_id),
    role: safeRole(optionalStorageText(row.role)),
    clientId: optionalStorageText(row.client_id),
    accountId: optionalStorageText(row.account_id),
    documentId: optionalStorageText(row.document_id),
    sourceId: optionalStorageText(row.source_id),
    fieldKey: requiredStorageText(row.field_key, "field_key") as SensitiveRevealFieldKey,
    fieldLabel: requiredSafeLabel(row.field_label, "field_label"),
    label: requiredSafeLabel(row.label, "label"),
    purpose: requiredStorageText(row.purpose, "purpose") as RevealPurpose,
    createdAt: isoString(row.created_at, "created_at"),
    expiresAt: isoString(row.expires_at, "expires_at"),
    oneTimeUse: Boolean(row.one_time_use),
    consumedAt: optionalIsoString(row.consumed_at, "consumed_at"),
    revokedAt: optionalIsoString(row.revoked_at, "revoked_at"),
    actualValueWasNotShownToModel: true,
  };

  rejectUnsafeMetadata(record);
  return record;
}

function rejectUnsafeMetadata(record: RevealCardRecord) {
  const metadata = {
    revealCardId: record.revealCardId,
    userId: record.userId,
    firmId: record.firmId,
    clientId: record.clientId,
    accountId: record.accountId,
    documentId: record.documentId,
    sourceId: record.sourceId,
    fieldKey: record.fieldKey,
    fieldLabel: record.fieldLabel,
    label: record.label,
    purpose: record.purpose,
  };

  if (containsUnsafeSensitivePattern(metadata)) {
    throw new Error("Reveal card metadata contains unsafe sensitive content.");
  }
}

function requiredStorageText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Reveal card ${field} is required.`);
  }
  return value.trim();
}

function optionalStorageText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return value.trim();
}

function requiredSafeLabel(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Reveal card ${field} is required.`);
  }
  return sanitizeTextForModel(value);
}

function isoString(value: unknown, field: string) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Reveal card ${field} must be a valid date.`);
  }
  return date.toISOString();
}

function optionalIsoString(value: unknown, field: string) {
  return value === undefined || value === null ? undefined : isoString(value, field);
}

function safeRole(
  role: unknown,
): DataIntelligenceV2AuthContext["role"] | undefined {
  return ["admin", "advisor", "csa", "ops", "readonly"].includes(role as string)
    ? (role as DataIntelligenceV2AuthContext["role"])
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
