import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { getAppPrincipalResultFromSession } from "@/lib/auth/principal";
import { googleOAuthConfigured } from "@/lib/env";
import styles from "./page.module.css";

type LoginPageProps = {
  searchParams?: Promise<{
    reason?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const notice = getLoginNotice(readSingleSearchParam(resolvedSearchParams.reason));
  const session = await auth();
  const principalResult = await getAppPrincipalResultFromSession(session);

  if (session?.user && principalResult.ok) {
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

        {notice ? (
          <div className={styles.statusBox}>
            <strong>{notice.title}</strong>
            <p>{notice.message}</p>
          </div>
        ) : null}

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

function readSingleSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getLoginNotice(reason: string | undefined) {
  switch (reason) {
    case "absolute_timeout":
      return {
        title: "Session expired",
        message: "Your session reached its maximum length. Log in again to continue.",
      };
    case "idle_timeout":
      return {
        title: "Session expired",
        message: "Your session expired after inactivity. Log in again to continue.",
      };
    case "invalidated":
      return {
        title: "Session ended",
        message: "This app session was signed out. Log in again to continue.",
      };
    case "logged_out":
      return {
        title: "You are logged out",
        message: "Sign in again when you are ready to return to RIA File Ops.",
      };
    case "access_denied":
      return {
        title: "Access denied",
        message: "Log in with an account that has access to this workspace.",
      };
    case "unauthorized":
      return {
        title: "Sign in required",
        message: "Log in before continuing to this workspace.",
      };
    default:
      return null;
  }
}
