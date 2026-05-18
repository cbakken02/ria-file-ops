import styles from "./workspace-storage-status.module.css";

export type WorkspaceStorageStatusConnection = {
  accountEmail: string | null;
  accountName: string | null;
  provider: string;
  status: "connected" | "needs_reauth";
};

type WorkspaceStorageStatusProps = {
  connection: WorkspaceStorageStatusConnection | null;
};

export function WorkspaceStorageStatus({
  connection,
}: WorkspaceStorageStatusProps) {
  const status = getStorageStatus(connection);

  return (
    <div className={styles.status} aria-label="Workspace storage status">
      <span className={styles.label}>Storage</span>
      <div className={styles.card}>
        <div className={styles.identity}>
          <strong>{getProviderLabel(connection?.provider ?? null)}</strong>
          <span>
            {connection?.accountEmail ??
              connection?.accountName ??
              "No account connected"}
          </span>
        </div>
        <span className={`${styles.pill} ${styles[status.tone]}`}>
          {status.label}
        </span>
      </div>
    </div>
  );
}

export function getProviderLabel(provider: string | null | undefined) {
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
      return "Storage";
  }
}

function getStorageStatus(connection: WorkspaceStorageStatusConnection | null) {
  if (!connection) {
    return { label: "Not connected", tone: "missing" as const };
  }

  if (connection.status === "needs_reauth") {
    return { label: "Needs reconnect", tone: "attention" as const };
  }

  return { label: "Connected", tone: "ready" as const };
}
