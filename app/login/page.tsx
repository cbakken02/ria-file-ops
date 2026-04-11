import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { googleOAuthConfigured } from "@/lib/env";
import styles from "./page.module.css";

export default async function LoginPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Step 1</p>
        <h1>Sign in before the app touches anyone&apos;s documents.</h1>
        <p className={styles.lead}>
          For this first version, firms sign in with Google. After that, they can
          grant separate Google Drive access so the app can inspect intake folders.
        </p>

        <GoogleSignInButton
          callbackUrl="/dashboard"
          className={styles.primaryAction}
          disabled={!googleOAuthConfigured}
          label="Sign in with Google"
        />

        <div className={styles.note}>
          <strong>Why this matters</strong>
          <p>
            Login and Drive access are different permissions. A user can have an
            account in your app before giving the app access to their files.
          </p>
        </div>

        {!googleOAuthConfigured ? (
          <div className={styles.warningBox}>
            Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`
            before trying the real login flow.
          </div>
        ) : null}
      </section>
    </main>
  );
}
