"use client";

import { signIn } from "next-auth/react";
import { getGoogleSignInAuthorizationParams } from "@/lib/auth/google-signin";

type Props = {
  callbackUrl: string;
  className: string;
  disabled?: boolean;
  forceAccountSelection?: boolean;
  label: string;
};

export function GoogleSignInButton({
  callbackUrl,
  className,
  disabled = false,
  forceAccountSelection = false,
  label,
}: Props) {
  const authorizationParams = getGoogleSignInAuthorizationParams({
    forceAccountSelection,
  });

  return (
    <button
      className={className}
      disabled={disabled}
      onClick={() => signIn("google", { callbackUrl }, authorizationParams)}
      type="button"
    >
      {label}
    </button>
  );
}
