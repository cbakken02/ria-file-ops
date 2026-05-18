"use client";

import { signOut } from "next-auth/react";

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
      await signOut({ callbackUrl: "/" });
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
