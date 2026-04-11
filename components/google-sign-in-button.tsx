"use client";

import { signIn } from "next-auth/react";

type Props = {
  callbackUrl: string;
  className: string;
  disabled?: boolean;
  label: string;
};

export function GoogleSignInButton({
  callbackUrl,
  className,
  disabled = false,
  label,
}: Props) {
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={() => signIn("google", { callbackUrl })}
      type="button"
    >
      {label}
    </button>
  );
}
