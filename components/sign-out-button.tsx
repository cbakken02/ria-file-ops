"use client";

import { signOut } from "next-auth/react";

type Props = {
  className: string;
};

export function SignOutButton({ className }: Props) {
  return (
    <button
      className={className}
      onClick={() => signOut({ callbackUrl: "/" })}
      type="button"
    >
      Log out
    </button>
  );
}
