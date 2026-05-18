import Link from "next/link";
import styles from "./add-storage-connection-button.module.css";

type ExistingConnection = {
  accountEmail: string | null;
  accountName: string | null;
  id: string;
  isPrimary: boolean;
  provider: string;
  status?: "connected" | "needs_reauth";
};

type Props = {
  activeConnection?: ExistingConnection | null;
  variant?: "default" | "ghost";
};

export function AddStorageConnectionButton({
  activeConnection = null,
  variant = "default",
}: Props) {
  const action = getStorageAction(activeConnection);

  return (
    <Link
      aria-label={action.label}
      className={
        variant === "ghost" ? styles.launchButtonGhost : styles.launchButton
      }
      href={action.href}
    >
      {action.label}
    </Link>
  );
}

function getStorageAction(connection: ExistingConnection | null) {
  if (!connection) {
    return {
      href: "/api/storage/google/start",
      label: "Connect Google Drive",
    };
  }

  if (connection.status === "needs_reauth") {
    return {
      href: "/api/storage/google/start",
      label: `Reconnect ${getProviderLabel(connection.provider)}`,
    };
  }

  return {
    href: "/api/storage/google/start?replace=1",
    label: "Replace storage connection",
  };
}

function getProviderLabel(provider: string) {
  switch (provider) {
    case "google_drive":
      return "Google Drive";
    case "sharefile":
      return "Progress ShareFile";
    case "sharepoint":
      return "Microsoft SharePoint";
    case "dropbox":
      return "Dropbox";
    default:
      return "storage";
  }
}
