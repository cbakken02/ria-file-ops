import type { Session } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";

export async function requireWaitlistAdminSession(): Promise<Session> {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  const email = session.user.email.trim().toLowerCase();

  if (!isWaitlistAdminEmail(email)) {
    notFound();
  }

  return session;
}

export function isWaitlistAdminEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return getWaitlistAdminEmails().has(normalizedEmail);
}

export function getWaitlistAdminEmails() {
  const configured =
    process.env.WAITLIST_ADMIN_EMAILS?.trim() ||
    process.env.ADMIN_EMAILS?.trim() ||
    "";

  return new Set(
    configured
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}
