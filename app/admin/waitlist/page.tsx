import type { Metadata } from "next";
import Link from "next/link";
import { requireWaitlistAdminSession } from "@/lib/admin";
import { getWaitlistSignups } from "@/lib/db";
import {
  buildWaitlistExportHref,
  filterWaitlistSignups,
  formatWaitlistFileSystems,
  formatWaitlistPainPoints,
  getSearchParamValue,
  normalizeWaitlistFileSystemFilter,
  normalizeWaitlistStatusFilter,
  sortWaitlistSignups,
} from "@/lib/waitlist-admin-view";
import {
  WAITLIST_FILE_SYSTEM_OPTIONS,
  WAITLIST_STATUS_OPTIONS,
  type WaitlistSignup,
  type WaitlistSignupStatus,
} from "@/lib/waitlist-signups";
import { updateWaitlistSignupStatusAction } from "./actions";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Waitlist Admin | RIA File Ops",
};

export default async function AdminWaitlistPage({
  searchParams,
}: {
  searchParams?: Promise<{
    fileSystem?: string;
    q?: string;
    status?: string;
  }>;
}) {
  const session = await requireWaitlistAdminSession();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const filters = {
    fileSystem: normalizeWaitlistFileSystemFilter(
      resolvedSearchParams?.fileSystem,
    ),
    query: getSearchParamValue(resolvedSearchParams?.q),
    status: normalizeWaitlistStatusFilter(resolvedSearchParams?.status),
  };
  const allSignups = sortWaitlistSignups(getWaitlistSignups());
  const signups = filterWaitlistSignups(allSignups, filters);
  const exportHref = buildWaitlistExportHref(filters);
  const newCount = allSignups.filter((signup) => signup.status === "new").length;
  const contactedCount = allSignups.filter(
    (signup) =>
      signup.status === "contacted" || signup.status === "demo_scheduled",
  ).length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/dashboard">
          <span className={styles.brandMark}>RF</span>
          <span>RIA File Ops</span>
        </Link>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href="/dashboard">
            Dashboard
          </Link>
          <Link className={styles.secondaryButton} href="/">
            Home
          </Link>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Internal admin</p>
          <h1>Waitlist submissions</h1>
          <p>
            Signed in as {session.user?.email}. View, filter, export, and update
            waitlist status.
          </p>
        </div>
        <div className={styles.summaryGrid} aria-label="Waitlist summary">
          <SummaryCard label="Total" value={allSignups.length} />
          <SummaryCard label="New" value={newCount} />
          <SummaryCard label="In follow-up" value={contactedCount} />
        </div>
      </section>

      <section className={styles.controls} aria-label="Waitlist filters">
        <form action="/admin/waitlist" className={styles.filterForm}>
          <input
            aria-label="Search waitlist submissions"
            className={styles.searchInput}
            defaultValue={filters.query}
            name="q"
            placeholder="Search name, email, firm, phone, or notes"
            type="search"
          />

          <label className={styles.selectLabel}>
            <span>Status</span>
            <select
              className={styles.controlSelect}
              defaultValue={filters.status}
              name="status"
            >
              <option value="all">All statuses</option>
              {WAITLIST_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.selectLabel}>
            <span>File system</span>
            <select
              className={styles.controlSelect}
              defaultValue={filters.fileSystem}
              name="fileSystem"
            >
              <option value="all">All file systems</option>
              {WAITLIST_FILE_SYSTEM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button className={styles.primaryButton} type="submit">
            Apply
          </button>
          <Link className={styles.secondaryButton} href="/admin/waitlist">
            Clear
          </Link>
        </form>

        <Link className={styles.exportButton} href={exportHref}>
          Export CSV
        </Link>
      </section>

      <section className={styles.tableCard} aria-labelledby="waitlist-table-title">
        <div className={styles.tableHeader}>
          <div>
            <p className={styles.eyebrow}>Results</p>
            <h2 id="waitlist-table-title">
              {signups.length === allSignups.length
                ? `${signups.length} submissions`
                : `${signups.length} of ${allSignups.length} submissions`}
            </h2>
          </div>
        </div>

        {signups.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Firm</th>
                  <th>Phone</th>
                  <th>File systems</th>
                  <th>Pain points</th>
                  <th>Notes</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {signups.map((signup) => (
                  <WaitlistRow key={signup.id} signup={signup} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            No waitlist submissions match these filters.
          </div>
        )}
      </section>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.summaryCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WaitlistRow({ signup }: { signup: WaitlistSignup }) {
  return (
    <tr>
      <td>
        <time dateTime={signup.createdAt}>{formatDate(signup.createdAt)}</time>
      </td>
      <td>{signup.name}</td>
      <td>
        <a className={styles.emailLink} href={`mailto:${signup.email}`}>
          {signup.email}
        </a>
      </td>
      <td>{signup.firm}</td>
      <td>{signup.phone || "—"}</td>
      <td>{formatWaitlistFileSystems(signup)}</td>
      <td>{formatWaitlistPainPoints(signup)}</td>
      <td className={styles.notesCell}>{signup.notes || "—"}</td>
      <td>
        <form action={updateWaitlistSignupStatusAction} className={styles.statusForm}>
          <input name="id" type="hidden" value={signup.id} />
          <label className={styles.srOnly} htmlFor={`status-${signup.id}`}>
            Status for {signup.email}
          </label>
          <select
            className={`${styles.statusSelect} ${styles[statusClass(signup.status)]}`}
            defaultValue={signup.status}
            id={`status-${signup.id}`}
            name="status"
          >
            {WAITLIST_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button className={styles.saveButton} type="submit">
            Save
          </button>
        </form>
      </td>
    </tr>
  );
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusClass(status: WaitlistSignupStatus) {
  return `status_${status}` as const;
}
