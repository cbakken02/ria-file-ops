"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { setActiveStorageForPathAction } from "@/app/actions/set-active-storage";
import styles from "./storage-switcher.module.css";

export type StorageSwitcherConnection = {
  id: string;
  provider: string;
  accountName: string | null;
  accountEmail: string | null;
  isPrimary: boolean;
  status: "connected" | "needs_reauth";
};

type StorageSwitcherProps = {
  activeConnection: StorageSwitcherConnection | null;
  connections: StorageSwitcherConnection[];
  currentPath: string;
  workspaceName?: string | null;
};

export function StorageSwitcher({
  activeConnection,
  connections,
  currentPath,
  workspaceName = null,
}: StorageSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const linkedConnections = dedupeConnections(connections);
  const activeLabel = activeConnection
    ? workspaceName?.trim() ||
      activeConnection.accountName ||
      activeConnection.accountEmail ||
      "Connected storage"
    : linkedConnections.length
      ? "Reconnect storage"
      : "No connected storage";

  return (
    <div className={styles.switcher} ref={containerRef}>
      <span className={styles.label}>Active storage</span>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <div className={styles.triggerText}>
          <strong>{activeConnection ? getProviderLabel(activeConnection.provider) : "Storage"}</strong>
          <span>{activeLabel}</span>
        </div>
        <span className={styles.triggerDivider} aria-hidden="true" />
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>⌄</span>
      </button>

      {open ? (
        <div className={styles.popover} role="menu">
          <div className={styles.popoverHeader}>
            <strong>Linked storage</strong>
            <span>{linkedConnections.length} total</span>
          </div>

          <div className={styles.connectionList}>
            {linkedConnections.map((connection) => {
              const isActive = activeConnection?.id === connection.id;
              const connectionLabel =
                connection.accountName ??
                connection.accountEmail ??
                "Connected storage";

              if (isActive) {
                return (
                  <div key={connection.id} className={styles.connectionRowActive}>
                    <div className={styles.connectionMeta}>
                      <strong>{getProviderLabel(connection.provider)}</strong>
                      <span>{connectionLabel}</span>
                    </div>
                    <span
                      className={
                        connection.status === "connected"
                          ? styles.activeBadge
                          : styles.reauthHint
                      }
                    >
                      {connection.status === "connected" ? "Active" : "Reconnect"}
                    </span>
                  </div>
                );
              }

              return (
                <form
                  action={setActiveStorageForPathAction}
                  className={styles.connectionForm}
                  key={connection.id}
                >
                  <input name="connectionId" type="hidden" value={connection.id} />
                  <input name="returnTo" type="hidden" value={currentPath} />
                  <button className={styles.connectionRow} type="submit">
                    <div className={styles.connectionMeta}>
                      <strong>{getProviderLabel(connection.provider)}</strong>
                      <span>{connectionLabel}</span>
                    </div>
                    <span
                      className={
                        connection.status === "connected"
                          ? styles.switchHint
                          : styles.reauthHint
                      }
                    >
                      {connection.status === "connected" ? "Switch" : "Reconnect"}
                    </span>
                  </button>
                </form>
              );
            })}
          </div>

          <div className={styles.popoverFooter}>
            <Link
              className={styles.footerLink}
              href="/setup?section=storage"
              onClick={() => setOpen(false)}
            >
              Manage storage connections
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getProviderLabel(provider: string) {
  if (provider === "google_drive") {
    return "Google Drive";
  }

  if (provider === "sharefile") {
    return "ShareFile";
  }

  if (provider === "dropbox") {
    return "Dropbox";
  }

  return "Storage";
}

function dedupeConnections(connections: StorageSwitcherConnection[]) {
  const seen = new Set<string>();
  const unique: StorageSwitcherConnection[] = [];

  for (const connection of connections) {
    if (seen.has(connection.id)) {
      continue;
    }

    seen.add(connection.id);
    unique.push(connection);
  }

  return unique;
}
