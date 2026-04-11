"use server";

import { revalidatePath } from "next/cache";
import {
  deleteStorageConnectionForOwner,
  getStorageConnectionByOwnerAndId,
  saveFirmSettingsForOwner,
} from "@/lib/db";
import {
  getDefaultNamingConventionSummary,
  parseNamingRules,
  serializeNamingRules,
  type NamingRulesConfig,
} from "@/lib/naming-rules";
import {
  DEFAULT_FOLDER_TEMPLATE,
  DEFAULT_NAMING_CONVENTION,
  normalizeFolderTemplate,
  normalizeReviewRuleValue,
  serializeFolderTemplate,
  type ReviewRuleValue,
} from "@/lib/setup-config";
import { requireSession } from "@/lib/session";

export type SaveSettingsState = {
  status: "idle" | "success" | "error";
  message: string;
  savedSettings?: {
    firmName: string;
    namingConvention: string;
    namingRules: NamingRulesConfig;
    sourceFolderValue: string;
    destinationFolderValue: string;
    folderTemplate: string[];
    reviewRule: ReviewRuleValue;
  };
};

export async function saveFirmSettings(
  _previousState: SaveSettingsState,
  formData: FormData,
): Promise<SaveSettingsState> {
  try {
    const session = await requireSession();
    const ownerEmail = session.user?.email;

    if (!ownerEmail) {
      throw new Error("No signed-in email was found for this session.");
    }

    const firmName = getTextValue(formData, "firmName");
    const sourceFolder = parseFolderValue(
      getOptionalValue(formData, "sourceFolder"),
    );
    const destinationFolder = parseFolderValue(
      getOptionalValue(formData, "destinationFolder"),
    );
    const namingConvention =
      getOptionalValue(formData, "namingConvention") ?? DEFAULT_NAMING_CONVENTION;
    const namingRules = parseNamingRules(
      getOptionalValue(formData, "namingRules"),
      namingConvention,
    );
    const namingSummary = getDefaultNamingConventionSummary(namingRules);
    const folderTemplate = normalizeFolderTemplate(
      getOptionalValue(formData, "folderTemplate"),
    );
    const reviewRule = normalizeReviewRuleValue(
      getOptionalValue(formData, "reviewRule"),
    );

    saveFirmSettingsForOwner({
      ownerEmail,
      firmName,
      sourceFolderId: sourceFolder?.id ?? null,
      sourceFolderName: sourceFolder?.name ?? null,
      destinationFolderId: destinationFolder?.id ?? null,
      destinationFolderName: destinationFolder?.name ?? null,
      namingConvention: namingSummary,
      namingRulesJson: serializeNamingRules(namingRules),
      folderTemplate: serializeFolderTemplate(folderTemplate),
      reviewInstruction: reviewRule,
    });

    revalidatePath("/setup");
    revalidatePath("/dashboard");
    revalidatePath("/preview");
    revalidatePath("/cleanup");

    return {
      status: "success",
      message:
        "Settings saved. Intake and Cleanup will use these conventions going forward.",
      savedSettings: {
        firmName,
        namingConvention: namingSummary,
        namingRules,
        sourceFolderValue: sourceFolder
          ? `${sourceFolder.id}::${sourceFolder.name}`
          : "",
        destinationFolderValue: destinationFolder
          ? `${destinationFolder.id}::${destinationFolder.name}`
          : "",
        folderTemplate:
          folderTemplate.length > 0 ? folderTemplate : [...DEFAULT_FOLDER_TEMPLATE],
        reviewRule,
      },
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Something went wrong while saving the settings.",
    };
  }
}

export async function removeStorageConnectionAction(connectionId: string) {
  try {
    const session = await requireSession();
    const ownerEmail = session.user?.email ?? "";
    const normalizedConnectionId = connectionId.trim();

    if (!ownerEmail || !normalizedConnectionId) {
      throw new Error("Select a storage connection first.");
    }

    const existing = getStorageConnectionByOwnerAndId(
      ownerEmail,
      normalizedConnectionId,
    );

    if (!existing) {
      throw new Error("That storage connection could not be found.");
    }

    deleteStorageConnectionForOwner({
      ownerEmail,
      connectionId: normalizedConnectionId,
    });

    revalidatePath("/setup");
    revalidatePath("/setup/google-drive");
    revalidatePath("/dashboard");
    revalidatePath("/preview");
    revalidatePath("/cleanup");

    return {
      status: "success" as const,
      message: "Storage connection removed.",
    };
  } catch (error) {
    return {
      status: "error" as const,
      message:
        error instanceof Error
          ? error.message
          : "Something went wrong while removing the storage connection.",
    };
  }
}

function getTextValue(formData: FormData, key: string) {
  return getOptionalValue(formData, key) ?? "";
}

function getOptionalValue(formData: FormData, key: string) {
  const raw = formData.get(key);

  if (typeof raw !== "string") {
    return null;
  }

  const value = raw.trim();
  return value.length ? value : null;
}

function parseFolderValue(raw: string | null) {
  if (!raw) {
    return null;
  }

  const [id, name] = raw.split("::", 2);

  if (!id || !name) {
    return null;
  }

  return { id, name };
}
