import { requireWaitlistAdminSession } from "@/lib/admin";
import { getWaitlistSignups } from "@/lib/db";
import {
  buildWaitlistCsv,
  filterWaitlistSignups,
  getSearchParamValue,
  normalizeWaitlistFileSystemFilter,
  normalizeWaitlistStatusFilter,
  sortWaitlistSignups,
} from "@/lib/waitlist-admin-view";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireWaitlistAdminSession();

  const url = new URL(request.url);
  const filters = {
    fileSystem: normalizeWaitlistFileSystemFilter(
      url.searchParams.get("fileSystem"),
    ),
    query: getSearchParamValue(url.searchParams.get("q")),
    status: normalizeWaitlistStatusFilter(url.searchParams.get("status")),
  };
  const signups = sortWaitlistSignups(
    filterWaitlistSignups(getWaitlistSignups(), filters),
  );
  const csv = buildWaitlistCsv(signups);

  return new Response(csv, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${buildFilename(filters)}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}

function buildFilename(filters: {
  fileSystem: string;
  query: string;
  status: string;
}) {
  const slug = [filters.query, filters.status, filters.fileSystem]
    .filter((value) => value && value !== "all")
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug ? `ria-file-ops-waitlist-${slug}.csv` : "ria-file-ops-waitlist.csv";
}
