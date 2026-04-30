import type {
  SensitiveValueStatus,
  SensitiveValueTarget,
} from "@/lib/data-intelligence-v2/types";

export interface SensitiveValueProvider {
  getSensitiveValueStatus(args: SensitiveValueTarget): Promise<{
    status: SensitiveValueStatus;
    fieldLabel: string;
    label: string;
    maskedValue?: string;
    sourceId?: string;
  }>;

  revealSensitiveValue(args: SensitiveValueTarget): Promise<{
    status: "success" | "not_found" | "not_supported" | "error";
    fieldLabel: string;
    label: string;
    value?: string;
  }>;
}
