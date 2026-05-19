"use client";

import { signOut } from "next-auth/react";
import { POST_LOGOUT_LANDING_URL } from "@/lib/auth/google-signin";

type Props = {
  className: string;
};

export function SignOutButton({ className }: Props) {
  async function handleSignOut() {
    try {
      await fetch("/api/session/logout", {
        credentials: "same-origin",
        method: "POST",
      });
    } finally {
      await signOut({ callbackUrl: POST_LOGOUT_LANDING_URL });
    }
  }

  return (
    <button
      className={className}
      onClick={handleSignOut}
      type="button"
    >
      Log out
    </button>
  );
}
