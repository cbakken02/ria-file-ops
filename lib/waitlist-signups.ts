export const WAITLIST_FILE_SYSTEM_OPTIONS = [
  {
    label: "Microsoft SharePoint / OneDrive",
    value: "sharepoint_onedrive",
  },
  {
    label: "Google Drive",
    value: "google_drive",
  },
  {
    label: "Box",
    value: "box",
  },
  {
    label: "Dropbox",
    value: "dropbox",
  },
  {
    label: "Egnyte",
    value: "egnyte",
  },
  {
    label: "Citrix ShareFile",
    value: "sharefile",
  },
  {
    label: "Local / shared network drive",
    value: "network_drive",
  },
  {
    label: "Redtail / CRM document storage",
    value: "redtail_crm",
  },
  {
    label: "SmartVault",
    value: "smartvault",
  },
  {
    label: "Other",
    value: "other",
  },
  {
    label: "Not sure",
    value: "not_sure",
  },
] as const;

export const WAITLIST_PAIN_POINT_OPTIONS = [
  {
    label: "New-client onboarding uploads",
    value: "new_client_onboarding_uploads",
  },
  {
    label: "Inconsistent file names",
    value: "inconsistent_file_names",
  },
  {
    label: "Files saved in the wrong folders",
    value: "wrong_folders",
  },
  {
    label: "Finding documents later",
    value: "finding_documents_later",
  },
  {
    label: "Missing document tracking",
    value: "missing_document_tracking",
  },
  {
    label: "Preparing service tasks",
    value: "preparing_service_tasks",
  },
  {
    label: "Other",
    value: "other",
  },
] as const;

export const WAITLIST_STATUS_OPTIONS = [
  {
    label: "New",
    value: "new",
  },
  {
    label: "Contacted",
    value: "contacted",
  },
  {
    label: "Demo scheduled",
    value: "demo_scheduled",
  },
  {
    label: "Onboarded",
    value: "onboarded",
  },
  {
    label: "Closed",
    value: "closed",
  },
] as const;

export type WaitlistFileSystem =
  (typeof WAITLIST_FILE_SYSTEM_OPTIONS)[number]["value"];

export type WaitlistPainPoint =
  (typeof WAITLIST_PAIN_POINT_OPTIONS)[number]["value"];

export type WaitlistSignupStatus =
  (typeof WAITLIST_STATUS_OPTIONS)[number]["value"];

export type WaitlistSignupInput = {
  email: string;
  fileSystemOther: string | null;
  fileSystems: WaitlistFileSystem[];
  firm: string;
  name: string;
  notes: string | null;
  painPoints: WaitlistPainPoint[];
  phone: string | null;
  source: "join_waitlist_page";
};

export type WaitlistSignup = WaitlistSignupInput & {
  createdAt: string;
  id: string;
  status: WaitlistSignupStatus;
  updatedAt: string;
};

export type WaitlistSignupUpsertResult = {
  alreadyExisted: boolean;
  signup: WaitlistSignup;
};

export type WaitlistFieldErrors = Partial<
  Record<
    | "email"
    | "fileSystemOther"
    | "fileSystems"
    | "firm"
    | "name"
    | "notes"
    | "painPoints"
    | "phone",
    string
  >
>;

export type WaitlistFormState = {
  alreadyExisted?: boolean;
  fieldErrors: WaitlistFieldErrors;
  message: string;
  ok: boolean;
};

export const WAITLIST_INITIAL_FORM_STATE: WaitlistFormState = {
  fieldErrors: {},
  message: "",
  ok: false,
};

type ValidationResult =
  | {
      fieldErrors: WaitlistFieldErrors;
      input?: never;
      ok: false;
    }
  | {
      fieldErrors?: never;
      input: WaitlistSignupInput;
      ok: true;
    };

const FILE_SYSTEM_VALUES: ReadonlySet<string> = new Set(
  WAITLIST_FILE_SYSTEM_OPTIONS.map((option) => option.value),
);

const PAIN_POINT_VALUES: ReadonlySet<string> = new Set(
  WAITLIST_PAIN_POINT_OPTIONS.map((option) => option.value),
);

const STATUS_VALUES: ReadonlySet<string> = new Set(
  WAITLIST_STATUS_OPTIONS.map((option) => option.value),
);

const FILE_SYSTEM_LABELS = new Map(
  WAITLIST_FILE_SYSTEM_OPTIONS.map((option) => [option.value, option.label]),
);

const PAIN_POINT_LABELS = new Map(
  WAITLIST_PAIN_POINT_OPTIONS.map((option) => [option.value, option.label]),
);

const STATUS_LABELS = new Map(
  WAITLIST_STATUS_OPTIONS.map((option) => [option.value, option.label]),
);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_LENGTH = {
  email: 254,
  fileSystemOther: 120,
  firm: 160,
  name: 120,
  notes: 1000,
  phone: 40,
} as const;

export function validateWaitlistSignupFormData(
  formData: FormData,
): ValidationResult {
  const fieldErrors: WaitlistFieldErrors = {};
  const name = getTrimmedString(formData, "name");
  const email = getTrimmedString(formData, "email").toLowerCase();
  const firm = getTrimmedString(formData, "firm");
  const phone = getOptionalString(formData, "phone");
  const fileSystemOther = getOptionalString(formData, "fileSystemOther");
  const notes = getOptionalString(formData, "notes");
  const fileSystemSelections = getSelections<WaitlistFileSystem>(
    formData,
    "fileSystems",
    FILE_SYSTEM_VALUES,
  );
  const painPointSelections = getSelections<WaitlistPainPoint>(
    formData,
    "painPoints",
    PAIN_POINT_VALUES,
  );
  const fileSystems = fileSystemSelections.values;
  const painPoints = painPointSelections.values;

  if (!name) {
    fieldErrors.name = "Name is required.";
  } else if (name.length > MAX_LENGTH.name) {
    fieldErrors.name = `Name must be ${MAX_LENGTH.name} characters or fewer.`;
  }

  if (!email) {
    fieldErrors.email = "Email is required.";
  } else if (email.length > MAX_LENGTH.email || !EMAIL_PATTERN.test(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (!firm) {
    fieldErrors.firm = "Firm is required.";
  } else if (firm.length > MAX_LENGTH.firm) {
    fieldErrors.firm = `Firm must be ${MAX_LENGTH.firm} characters or fewer.`;
  }

  if (phone && phone.length > MAX_LENGTH.phone) {
    fieldErrors.phone = `Phone must be ${MAX_LENGTH.phone} characters or fewer.`;
  }

  if (fileSystems.length === 0) {
    fieldErrors.fileSystems =
      "Select at least one file location, or choose Not sure.";
  } else if (fileSystemSelections.hasInvalidValues) {
    fieldErrors.fileSystems = "Select a valid file location.";
  }

  if (fileSystemOther && fileSystemOther.length > MAX_LENGTH.fileSystemOther) {
    fieldErrors.fileSystemOther =
      `Other file location must be ${MAX_LENGTH.fileSystemOther} characters or fewer.`;
  }

  if (notes && notes.length > MAX_LENGTH.notes) {
    fieldErrors.notes = `Notes must be ${MAX_LENGTH.notes} characters or fewer.`;
  }

  if (painPointSelections.hasInvalidValues) {
    fieldErrors.painPoints = "Select a valid cleanup item.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      fieldErrors,
      ok: false,
    };
  }

  return {
    input: {
      email,
      fileSystemOther,
      fileSystems,
      firm,
      name,
      notes,
      painPoints,
      phone,
      source: "join_waitlist_page",
    },
    ok: true,
  };
}

export function getWaitlistFileSystemLabel(value: WaitlistFileSystem) {
  return FILE_SYSTEM_LABELS.get(value) ?? value;
}

export function getWaitlistPainPointLabel(value: WaitlistPainPoint) {
  return PAIN_POINT_LABELS.get(value) ?? value;
}

export function getWaitlistStatusLabel(value: WaitlistSignupStatus) {
  return STATUS_LABELS.get(value) ?? value;
}

export function isWaitlistSignupStatus(
  value: unknown,
): value is WaitlistSignupStatus {
  return typeof value === "string" && STATUS_VALUES.has(value);
}

function getTrimmedString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getOptionalString(formData: FormData, key: string) {
  const value = getTrimmedString(formData, key);
  return value ? value : null;
}

function getSelections<Value extends string>(
  formData: FormData,
  key: string,
  allowedValues: ReadonlySet<string>,
) {
  const selected: Value[] = [];
  const seen = new Set<string>();
  let hasInvalidValues = false;

  for (const value of formData.getAll(key)) {
    if (typeof value !== "string" || !allowedValues.has(value)) {
      hasInvalidValues = true;
      continue;
    }

    if (!seen.has(value)) {
      selected.push(value as Value);
      seen.add(value);
    }
  }

  return {
    hasInvalidValues,
    values: selected,
  };
}
