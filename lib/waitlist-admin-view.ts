import type {
  WaitlistFileSystem,
  WaitlistSignup,
  WaitlistSignupStatus,
} from "@/lib/waitlist-signups";
import {
  getWaitlistFileSystemLabel,
  getWaitlistPainPointLabel,
  getWaitlistStatusLabel,
  WAITLIST_FILE_SYSTEM_OPTIONS,
  WAITLIST_STATUS_OPTIONS,
} from "@/lib/waitlist-signups";

export type WaitlistFileSystemFilter = "all" | WaitlistFileSystem;
export type WaitlistStatusFilter = "all" | WaitlistSignupStatus;

export type WaitlistFilters = {
  fileSystem: WaitlistFileSystemFilter;
  query: string;
  status: WaitlistStatusFilter;
};

const FILE_SYSTEM_VALUES: ReadonlySet<string> = new Set(
  WAITLIST_FILE_SYSTEM_OPTIONS.map((option) => option.value),
);

const STATUS_VALUES: ReadonlySet<string> = new Set(
  WAITLIST_STATUS_OPTIONS.map((option) => option.value),
);

export function filterWaitlistSignups(
  signups: WaitlistSignup[],
  filters: WaitlistFilters,
) {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return signups.filter((signup) => {
    const matchesQuery =
      !normalizedQuery ||
      [
        signup.name,
        signup.email,
        signup.firm,
        signup.phone ?? "",
        signup.fileSystemOther ?? "",
        signup.notes ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    const matchesStatus =
      filters.status === "all" || signup.status === filters.status;
    const matchesFileSystem =
      filters.fileSystem === "all" ||
      signup.fileSystems.includes(filters.fileSystem);

    return matchesQuery && matchesStatus && matchesFileSystem;
  });
}

export function sortWaitlistSignups(signups: WaitlistSignup[]) {
  return [...signups].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function normalizeWaitlistStatusFilter(
  value: string | string[] | null | undefined,
): WaitlistStatusFilter {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && STATUS_VALUES.has(candidate)
    ? (candidate as WaitlistSignupStatus)
    : "all";
}

export function normalizeWaitlistFileSystemFilter(
  value: string | string[] | null | undefined,
): WaitlistFileSystemFilter {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && FILE_SYSTEM_VALUES.has(candidate)
    ? (candidate as WaitlistFileSystem)
    : "all";
}

export function getSearchParamValue(
  value: string | string[] | null | undefined,
) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function formatWaitlistFileSystems(signup: WaitlistSignup) {
  const labels: string[] = signup.fileSystems.map(getWaitlistFileSystemLabel);

  if (signup.fileSystemOther) {
    labels.push(signup.fileSystemOther);
  }

  return labels.join(", ") || "None selected";
}

export function formatWaitlistPainPoints(signup: WaitlistSignup) {
  return signup.painPoints.map(getWaitlistPainPointLabel).join(", ") || "—";
}

export function formatWaitlistStatus(status: WaitlistSignupStatus) {
  return getWaitlistStatusLabel(status);
}

export function buildWaitlistExportHref(filters: WaitlistFilters) {
  const params = new URLSearchParams();

  if (filters.query) {
    params.set("q", filters.query);
  }

  if (filters.fileSystem !== "all") {
    params.set("fileSystem", filters.fileSystem);
  }

  if (filters.status !== "all") {
    params.set("status", filters.status);
  }

  const queryString = params.toString();
  return queryString
    ? `/admin/waitlist/export?${queryString}`
    : "/admin/waitlist/export";
}

export function buildWaitlistCsv(signups: WaitlistSignup[]) {
  const rows = [
    [
      "created_at",
      "name",
      "email",
      "firm",
      "phone",
      "file_systems",
      "pain_points",
      "notes",
      "status",
    ],
    ...signups.map((signup) => [
      signup.createdAt,
      signup.name,
      signup.email,
      signup.firm,
      signup.phone ?? "",
      formatWaitlistFileSystems(signup),
      formatWaitlistPainPoints(signup),
      signup.notes ?? "",
      formatWaitlistStatus(signup.status),
    ]),
  ];

  return rows.map((row) => row.map(toCsvCell).join(",")).join("\n");
}

function toCsvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
