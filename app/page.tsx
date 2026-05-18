import Link from "next/link";
import { auth } from "@/auth";
import styles from "./page.module.css";

const workflowSteps = [
  {
    title: "Connect your storage",
    body: "Link Google Drive first, then expand to other systems like SharePoint or ShareFile later.",
  },
  {
    title: "Choose your rules",
    body: "Set a standard folder structure, file naming format, and review thresholds once for the firm.",
  },
  {
    title: "Process new uploads",
    body: "Incoming files are read, classified, renamed, and filed automatically, with uncertain items sent to review.",
  },
];

const documentTypes = [
  "Account statements",
  "Driver's licenses",
  "Tax documents",
  "Trust paperwork",
  "Household intake forms",
  "Scanned images and PDFs",
];

export default async function Home() {
  const session = await auth();

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>RIA document intake, cleaned up</p>
          <h1>Turn messy client uploads into a clean, searchable client record.</h1>
          <p className={styles.lead}>
            This starter app is the first version of a product for advisory firms:
            connect storage, standardize folders, rename files consistently, and
            route uncertain documents to a review queue instead of letting them pile
            up in chaos.
          </p>
          <div className={styles.actions}>
            <Link
              className={styles.primaryAction}
              href={session?.user ? "/dashboard" : "/login"}
            >
              {session?.user ? "Open dashboard" : "Sign in to begin"}
            </Link>
            <Link className={styles.secondaryAction} href="/setup">
              Open settings
            </Link>
          </div>
        </div>

        <div className={styles.heroPanel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelLabel}>Sample intake run</span>
            <span className={styles.panelBadge}>8 of 10 auto-filed</span>
          </div>

          <div className={styles.metricRow}>
            <article className={styles.metricCard}>
              <strong>10</strong>
              <span>Files received</span>
            </article>
            <article className={styles.metricCard}>
              <strong>2</strong>
              <span>Needs review</span>
            </article>
            <article className={styles.metricCard}>
              <strong>4 min</strong>
              <span>Staff time saved</span>
            </article>
          </div>

          <div className={styles.fileList}>
            <div className={styles.fileRow}>
              <div>
                <p>schwab_march.pdf</p>
                <span>Matched to Bakken_Christopher</span>
              </div>
              <strong>Accounts</strong>
            </div>
            <div className={styles.fileRow}>
              <div>
                <p>IMG_1098.PNG</p>
                <span>Driver&apos;s license detected</span>
              </div>
              <strong>Client Info</strong>
            </div>
            <div className={styles.fileRow}>
              <div>
                <p>tax docs final.pdf</p>
                <span>Confidence too low for full automation</span>
              </div>
              <strong>Review</strong>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <p className={styles.sectionLabel}>How it works</p>
          <h2>Start with a simple workflow the ops team can trust.</h2>
        </div>

        <div className={styles.workflowGrid}>
          {workflowSteps.map((step) => (
            <article key={step.title} className={styles.workflowCard}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <p className={styles.sectionLabel}>What it handles</p>
          <h2>Built for the kinds of intake documents RIAs already chase by hand.</h2>
        </div>

        <div className={styles.documentGrid}>
          {documentTypes.map((documentType) => (
            <div key={documentType} className={styles.documentPill}>
              {documentType}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <p className={styles.sectionLabel}>Why this matters</p>
          <h2>The first version does not need to be magical. It needs to be dependable.</h2>
        </div>

        <div className={styles.valueGrid}>
          <article className={styles.valueCard}>
            <h3>Less staff cleanup</h3>
            <p>
              Client service associates should not spend hours renaming files that
              were uploaded with names like `scan0002.pdf`.
            </p>
          </article>
          <article className={styles.valueCard}>
            <h3>Better planning readiness</h3>
            <p>
              Advisors get a standard file structure, clearer records, and less
              digging when they need key household information later.
            </p>
          </article>
          <article className={styles.valueCard}>
            <h3>Human review when needed</h3>
            <p>
              Uncertain matches should go to a review queue instead of silently
              landing in the wrong client folder.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
