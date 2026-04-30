import {
  DEV_MOCK_ACCOUNT,
  DEV_MOCK_IDENTITY_VALUES,
  DEV_MOCK_SOURCE_REFS,
  getDevMockClient,
} from "@/lib/data-intelligence-v2/dev-mock-fixtures";
import type { SensitiveValueProvider } from "@/lib/data-intelligence-v2/sensitive-value-provider";
import type {
  SensitiveRevealFieldKey,
  SensitiveValueStatus,
  SensitiveValueTarget,
} from "@/lib/data-intelligence-v2/types";

const FIELD_LABELS: Record<SensitiveRevealFieldKey, string> = {
  "client.ssn": "Social Security number",
  "client.taxId": "Tax ID",
  "client.dob": "Date of birth",
  "client.address": "Address",
  "client.phone": "Phone",
  "client.email": "Email",
  "account.fullAccountNumber": "Full account number",
  "identity.driverLicenseNumber": "Driver license number",
  "identity.passportNumber": "Passport number",
  "identity.governmentIdNumber": "Government ID number",
};

const MASKED_VALUES: Partial<Record<SensitiveRevealFieldKey, string>> = {
  "client.ssn": "***-**-1234",
  "client.dob": "[DATE_ON_FILE_REDACTED]",
  "client.address": "[ADDRESS_REDACTED]",
  "client.phone": "[MASKED]",
  "client.email": "[MASKED]",
  "account.fullAccountNumber": DEV_MOCK_ACCOUNT.maskedAccountNumber,
  "identity.driverLicenseNumber": "****1234",
  "identity.passportNumber": "****1234",
  "identity.governmentIdNumber": "****1234",
};

export class DevMockSensitiveValueProvider implements SensitiveValueProvider {
  async getSensitiveValueStatus(args: SensitiveValueTarget): Promise<{
    status: SensitiveValueStatus;
    fieldLabel: string;
    label: string;
    maskedValue?: string;
    sourceId?: string;
  }> {
    const fieldLabel = FIELD_LABELS[args.fieldKey] ?? args.fieldKey;
    if (!isSupportedTarget(args)) {
      return {
        status: "not_found",
        fieldLabel,
        label: fieldLabel,
      };
    }

    if (!(args.fieldKey in DEV_MOCK_IDENTITY_VALUES)) {
      return {
        status: "not_supported",
        fieldLabel,
        label: fieldLabel,
      };
    }

    return {
      status: "on_file",
      fieldLabel,
      label: labelForTarget(args, fieldLabel),
      ...(MASKED_VALUES[args.fieldKey]
        ? { maskedValue: MASKED_VALUES[args.fieldKey] }
        : {}),
      sourceId:
        args.fieldKey === "account.fullAccountNumber"
          ? DEV_MOCK_SOURCE_REFS.account.sourceId
          : DEV_MOCK_SOURCE_REFS.identity.sourceId,
    };
  }

  async revealSensitiveValue(args: SensitiveValueTarget): Promise<{
    status: "success" | "not_found" | "not_supported" | "error";
    fieldLabel: string;
    label: string;
    value?: string;
  }> {
    const fieldLabel = FIELD_LABELS[args.fieldKey] ?? args.fieldKey;
    if (!isSupportedTarget(args)) {
      return {
        status: "not_found",
        fieldLabel,
        label: fieldLabel,
      };
    }

    const value = DEV_MOCK_IDENTITY_VALUES[args.fieldKey];
    if (!value) {
      return {
        status: "not_supported",
        fieldLabel,
        label: fieldLabel,
      };
    }

    return {
      status: "success",
      fieldLabel,
      label: labelForTarget(args, fieldLabel),
      value,
    };
  }
}

function isSupportedTarget(args: SensitiveValueTarget) {
  if (args.fieldKey === "account.fullAccountNumber") {
    return (
      args.accountId === undefined ||
      args.accountId === DEV_MOCK_ACCOUNT.accountId
    );
  }

  return args.clientId === undefined || Boolean(getDevMockClient(args.clientId));
}

function labelForTarget(args: SensitiveValueTarget, fallback: string) {
  if (args.fieldKey === "account.fullAccountNumber") {
    return "Mock Schwab IRA account number";
  }

  return `Alex Demo ${fallback}`;
}
