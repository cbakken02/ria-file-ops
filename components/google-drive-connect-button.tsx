"use client";

import { signIn } from "next-auth/react";
import { GOOGLE_DRIVE_WRITE_SCOPE } from "@/lib/google-drive";

type Props = {
  className: string;
  disabled?: boolean;
};

export function GoogleDriveConnectButton({
  className,
  disabled = false,
}: Props) {
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={() =>
        signIn(
          "google",
          { callbackUrl: "/setup?section=storage" },
          {
            access_type: "offline",
            include_granted_scopes: "true",
            prompt: "consent",
            scope: `openid email profile ${GOOGLE_DRIVE_WRITE_SCOPE}`,
          },
        )
      }
      type="button"
    >
      Grant Google Drive access
    </button>
  );
}
