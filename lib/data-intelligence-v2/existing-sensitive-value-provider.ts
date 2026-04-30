import {
  findLatestAccountIdentifierForAccount,
  findLatestIdentityAddressForParty,
  findLatestIdentityDobForParty,
  findLatestIdentityDocumentForParty,
} from "@/lib/firm-document-query";
import { getFieldDefinition, maskValueForModel } from "@/lib/data-intelligence-v2/field-catalog";
import type { SensitiveValueProvider } from "@/lib/data-intelligence-v2/sensitive-value-provider";
import type {
  SensitiveRevealFieldKey,
  SensitiveValueStatus,
  SensitiveValueTarget,
} from "@/lib/data-intelligence-v2/types";

export class ExistingSensitiveValueProvider implements SensitiveValueProvider {
  async getSensitiveValueStatus(args: SensitiveValueTarget): Promise<{
    status: SensitiveValueStatus;
    fieldLabel: string;
    label: string;
    maskedValue?: string;
    sourceId?: string;
  }> {
    const fieldLabel = fieldLabelFor(args.fieldKey);

    switch (args.fieldKey) {
      case "account.fullAccountNumber":
        return this.getAccountNumberStatus(args, fieldLabel);
      case "client.dob":
        return this.getDobStatus(args, fieldLabel);
      case "client.address":
        return this.getAddressStatus(args, fieldLabel);
      case "identity.driverLicenseNumber":
        return this.getIdentityNumberStatus(args, fieldLabel, "driver_license");
      case "identity.passportNumber":
        return this.getIdentityNumberStatus(args, fieldLabel, "passport");
      case "identity.governmentIdNumber":
        return (
          await this.getIdentityNumberStatus(args, fieldLabel, "state_id")
        ).status === "on_file"
          ? this.getIdentityNumberStatus(args, fieldLabel, "state_id")
          : this.getIdentityNumberStatus(args, fieldLabel, "government_id");
      case "client.ssn":
      case "client.taxId":
      case "client.phone":
      case "client.email":
        return unsupportedStatus(fieldLabel, args.fieldKey);
    }
  }

  async revealSensitiveValue(args: SensitiveValueTarget): Promise<{
    status: "success" | "not_found" | "not_supported" | "error";
    fieldLabel: string;
    label: string;
    value?: string;
  }> {
    const fieldLabel = fieldLabelFor(args.fieldKey);

    try {
      switch (args.fieldKey) {
        case "account.fullAccountNumber": {
          if (!args.accountId) {
            return unsupportedReveal(fieldLabel);
          }

          const identifier = findLatestAccountIdentifierForAccount({
            ownerEmail: args.ownerEmail,
            accountId: args.accountId,
          });
          if (!identifier?.accountNumber) {
            return notFoundReveal(fieldLabel);
          }

          return {
            status: "success",
            fieldLabel,
            label: fieldLabel,
            value: identifier.accountNumber,
          };
        }
        case "client.dob": {
          if (!args.clientId) {
            return unsupportedReveal(fieldLabel);
          }

          const record = findLatestIdentityDobForParty({
            ownerEmail: args.ownerEmail,
            partyId: args.clientId,
          });
          if (!record?.birthDate) {
            return notFoundReveal(fieldLabel);
          }

          return {
            status: "success",
            fieldLabel,
            label: fieldLabel,
            value: record.birthDate,
          };
        }
        case "client.address": {
          if (!args.clientId) {
            return unsupportedReveal(fieldLabel);
          }

          const record = findLatestIdentityAddressForParty({
            ownerEmail: args.ownerEmail,
            partyId: args.clientId,
          });
          if (!record?.addressRawText) {
            return notFoundReveal(fieldLabel);
          }

          return {
            status: "success",
            fieldLabel,
            label: fieldLabel,
            value: record.addressRawText,
          };
        }
        case "identity.driverLicenseNumber":
          return this.revealIdentityNumber(args, fieldLabel, "driver_license");
        case "identity.passportNumber":
          return this.revealIdentityNumber(args, fieldLabel, "passport");
        case "identity.governmentIdNumber": {
          const stateId = await this.revealIdentityNumber(
            args,
            fieldLabel,
            "state_id",
          );
          return stateId.status === "success"
            ? stateId
            : this.revealIdentityNumber(args, fieldLabel, "government_id");
        }
        case "client.ssn":
        case "client.taxId":
        case "client.phone":
        case "client.email":
          return unsupportedReveal(fieldLabel);
      }
    } catch {
      return {
        status: "error",
        fieldLabel,
        label: fieldLabel,
      };
    }
  }

  private async getAccountNumberStatus(
    args: SensitiveValueTarget,
    fieldLabel: string,
  ) {
    if (!args.accountId) {
      return unsupportedStatus(fieldLabel, args.fieldKey);
    }

    const identifier = findLatestAccountIdentifierForAccount({
      ownerEmail: args.ownerEmail,
      accountId: args.accountId,
    });
    if (!identifier?.accountNumber) {
      return notFoundStatus(fieldLabel, args.fieldKey);
    }

    return {
      status: "on_file" as const,
      fieldLabel,
      label: fieldLabel,
      maskedValue:
        identifier.maskedAccountNumber ??
        String(maskValueForModel(args.fieldKey, identifier.accountNumber)),
      sourceId: identifier.documentId
        ? `document:${identifier.documentId}`
        : undefined,
    };
  }

  private async getDobStatus(
    args: SensitiveValueTarget,
    fieldLabel: string,
  ) {
    if (!args.clientId) {
      return unsupportedStatus(fieldLabel, args.fieldKey);
    }

    const record = findLatestIdentityDobForParty({
      ownerEmail: args.ownerEmail,
      partyId: args.clientId,
    });
    if (!record?.birthDate) {
      return notFoundStatus(fieldLabel, args.fieldKey);
    }

    return {
      status: "on_file" as const,
      fieldLabel,
      label: fieldLabel,
      sourceId: record.documentId ? `document:${record.documentId}` : undefined,
    };
  }

  private async getAddressStatus(
    args: SensitiveValueTarget,
    fieldLabel: string,
  ) {
    if (!args.clientId) {
      return unsupportedStatus(fieldLabel, args.fieldKey);
    }

    const record = findLatestIdentityAddressForParty({
      ownerEmail: args.ownerEmail,
      partyId: args.clientId,
    });
    if (!record?.addressRawText) {
      return notFoundStatus(fieldLabel, args.fieldKey);
    }

    return {
      status: "on_file" as const,
      fieldLabel,
      label: fieldLabel,
      sourceId: record.documentId ? `document:${record.documentId}` : undefined,
    };
  }

  private async getIdentityNumberStatus(
    args: SensitiveValueTarget,
    fieldLabel: string,
    idKind: string,
  ) {
    if (!args.clientId) {
      return unsupportedStatus(fieldLabel, args.fieldKey);
    }

    const record = findLatestIdentityDocumentForParty({
      ownerEmail: args.ownerEmail,
      partyId: args.clientId,
      idKind,
    });
    if (!record) {
      return notFoundStatus(fieldLabel, args.fieldKey);
    }
    if (!record.rawIdValue) {
      return unsupportedStatus(fieldLabel, args.fieldKey);
    }

    return {
      status: "on_file" as const,
      fieldLabel,
      label: fieldLabel,
      maskedValue: record.maskedIdValue ?? undefined,
      sourceId: record.documentId ? `document:${record.documentId}` : undefined,
    };
  }

  private async revealIdentityNumber(
    args: SensitiveValueTarget,
    fieldLabel: string,
    idKind: string,
  ) {
    if (!args.clientId) {
      return unsupportedReveal(fieldLabel);
    }

    const record = findLatestIdentityDocumentForParty({
      ownerEmail: args.ownerEmail,
      partyId: args.clientId,
      idKind,
    });
    if (!record) {
      return notFoundReveal(fieldLabel);
    }
    if (!record.rawIdValue) {
      return unsupportedReveal(fieldLabel);
    }

    return {
      status: "success" as const,
      fieldLabel,
      label: fieldLabel,
      value: record.rawIdValue,
    };
  }
}

function fieldLabelFor(fieldKey: SensitiveRevealFieldKey) {
  return getFieldDefinition(fieldKey)?.label ?? fieldKey;
}

function unsupportedStatus(fieldLabel: string, fieldKey: SensitiveRevealFieldKey) {
  return {
    status: "not_supported" as const,
    fieldLabel,
    label: fieldLabel,
    sourceId: `unsupported:${fieldKey}`,
  };
}

function notFoundStatus(fieldLabel: string, fieldKey: SensitiveRevealFieldKey) {
  return {
    status: "not_found" as const,
    fieldLabel,
    label: fieldLabel,
    sourceId: `not_found:${fieldKey}`,
  };
}

function unsupportedReveal(fieldLabel: string) {
  return {
    status: "not_supported" as const,
    fieldLabel,
    label: fieldLabel,
  };
}

function notFoundReveal(fieldLabel: string) {
  return {
    status: "not_found" as const,
    fieldLabel,
    label: fieldLabel,
  };
}
