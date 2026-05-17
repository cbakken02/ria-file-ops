import type { Metadata } from "next";
import Link from "next/link";
import { WaitlistForm } from "./waitlist-form";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Join Waitlist | RIA File Ops",
  description:
    "Join the RIA File Ops waitlist for automated client upload filing built for RIA operations teams.",
};

export default function JoinWaitlistPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="RIA File Ops home">
          <span className={styles.brandMark}>RF</span>
          <span>RIA File Ops</span>
        </Link>

        <Link className={styles.headerAction} href="/">
          Back to Home
        </Link>
      </header>

      <section className={styles.hero} aria-labelledby="waitlist-heading">
        <div className={styles.copyPanel}>
          <p className={styles.eyebrow}>Private waitlist</p>
          <h1 id="waitlist-heading">Join the RIA File Ops waitlist.</h1>
          <p className={styles.lead}>
            RIA File Ops helps advisory teams turn messy client uploads into
            clean, convention-ready folders. Tell us where your files live
            today and we&apos;ll follow up when we&apos;re ready to onboard more
            firms.
          </p>

        </div>

        <WaitlistForm />
      </section>
    </main>
  );
}
