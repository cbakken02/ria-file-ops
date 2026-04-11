"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import modalStyles from "./add-storage-connection-button.module.css";

type ExistingConnection = {
  accountEmail: string | null;
  accountName: string | null;
  id: string;
  isPrimary: boolean;
  provider: string;
};

type Props = {
  activeConnection?: ExistingConnection | null;
  existingConnections?: ExistingConnection[];
  variant?: "default" | "ghost";
};

export function AddStorageConnectionButton({
  activeConnection = null,
  existingConnections = [],
  variant = "default",
}: Props) {
  const [open, setOpen] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [fetchedActiveConnection, setFetchedActiveConnection] =
    useState<ExistingConnection | null>(activeConnection);
  const [fetchedConnections, setFetchedConnections] =
    useState<ExistingConnection[]>(existingConnections);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const resolvedActiveConnection = fetchedActiveConnection ?? activeConnection;
  const resolvedConnections = fetchedConnections.length
    ? fetchedConnections
    : existingConnections;
  const otherConnections = dedupeConnections(
    resolvedActiveConnection
      ? resolvedConnections.filter(
          (connection) => connection.id !== resolvedActiveConnection.id,
        )
      : resolvedConnections,
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!dialogRef.current?.contains(event.target as Node)) {
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

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function loadConnections() {
      setLoadingConnections(true);
      setConnectionError(null);

      try {
        const response = await fetch("/api/storage/connections", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Unable to load storage connections.");
        }

        const payload = (await response.json()) as {
          activeConnection: ExistingConnection | null;
          connections: ExistingConnection[];
        };

        if (!cancelled) {
          setFetchedActiveConnection(payload.activeConnection);
          setFetchedConnections(payload.connections);
        }
      } catch (error) {
        if (!cancelled) {
          setConnectionError(
            error instanceof Error
              ? error.message
              : "Unable to load storage connections.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingConnections(false);
        }
      }
    }

    void loadConnections();

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Add a new storage connection"
        className={
          variant === "ghost"
            ? modalStyles.launchButtonGhost
            : modalStyles.launchButton
        }
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        type="button"
      >
        <span aria-hidden="true">+</span>
      </button>

      {open ? (
        <div className={modalStyles.overlay} role="presentation">
          <div
            aria-labelledby="add-storage-title"
            aria-modal="true"
            className={modalStyles.dialog}
            ref={dialogRef}
            role="dialog"
          >
            <div className={modalStyles.dialogHeader}>
              <div>
                <h2 id="add-storage-title">Add storage connection</h2>
              </div>

              <button
                aria-label="Close add storage connection dialog"
                className={modalStyles.closeButton}
                onClick={() => setOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            {resolvedActiveConnection ? (
              <div className={modalStyles.section}>
                <div className={modalStyles.sectionHeader}>
                  <p className={modalStyles.sectionLabel}>Already connected</p>
                  <span className={modalStyles.sectionMeta}>Current workspace</span>
                </div>

                <div className={modalStyles.connectedList}>
                  <div className={modalStyles.connectedRow} key={resolvedActiveConnection.id}>
                    <div className={modalStyles.providerIdentity}>
                      <span className={modalStyles.logoWrap}>
                        {resolvedActiveConnection.provider === "google_drive" ? (
                          <GoogleDriveLogo />
                        ) : resolvedActiveConnection.provider === "sharepoint" ? (
                          <SharePointLogo />
                        ) : resolvedActiveConnection.provider === "dropbox" ? (
                          <DropboxLogo />
                        ) : (
                          <ProgressShareFileLogo />
                        )}
                      </span>
                      <div>
                        <strong>{getProviderLabel(resolvedActiveConnection.provider)}</strong>
                        <p>
                          {resolvedActiveConnection.accountEmail ??
                            resolvedActiveConnection.accountName ??
                            "Connected account"}
                        </p>
                      </div>
                    </div>
                    <span className={modalStyles.activeConnectionPill}>Active now</span>
                  </div>
                </div>
              </div>
            ) : null}

            {otherConnections.length ? (
              <div className={modalStyles.section}>
                <div className={modalStyles.sectionHeader}>
                  <p className={modalStyles.sectionLabel}>Other attached connections</p>
                  <span className={modalStyles.sectionMeta}>{otherConnections.length} more</span>
                </div>

                <div className={modalStyles.connectedList}>
                  {otherConnections.map((connection) => (
                    <div className={modalStyles.connectedRow} key={connection.id}>
                      <div className={modalStyles.providerIdentity}>
                        <span className={modalStyles.logoWrap}>
                          {connection.provider === "google_drive" ? (
                            <GoogleDriveLogo />
                          ) : connection.provider === "sharepoint" ? (
                            <SharePointLogo />
                          ) : connection.provider === "dropbox" ? (
                            <DropboxLogo />
                          ) : (
                            <ProgressShareFileLogo />
                          )}
                        </span>
                        <div>
                          <strong>{getProviderLabel(connection.provider)}</strong>
                          <p>
                            {connection.accountEmail ??
                              connection.accountName ??
                              "Connected account"}
                          </p>
                        </div>
                      </div>
                      <span className={modalStyles.connectedListPill}>Connected</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {loadingConnections ? (
              <p className={modalStyles.statusText}>Loading connected storage accounts…</p>
            ) : null}

            {connectionError ? (
              <p className={modalStyles.statusText}>{connectionError}</p>
            ) : null}

            <div className={modalStyles.section}>
              <div className={modalStyles.sectionHeader}>
                <p className={modalStyles.sectionLabel}>Add another connection</p>
              </div>

            <div className={modalStyles.providerGrid}>
              <Link
                className={`${modalStyles.providerCard} ${modalStyles.providerCardLink}`}
                href="/api/storage/google/start"
                onClick={() => setOpen(false)}
              >
                <div className={modalStyles.providerTopRow}>
                  <div className={modalStyles.providerIdentity}>
                    <span className={modalStyles.logoWrap}>
                      <GoogleDriveLogo />
                    </span>
                    <div>
                      <strong>Google Drive</strong>
                      <p>Connect another Google Drive account</p>
                    </div>
                  </div>
                  <span className={modalStyles.availablePill}>Available now</span>
                </div>
              </Link>

              <article className={modalStyles.providerCard}>
                <div className={modalStyles.providerTopRow}>
                  <div className={modalStyles.providerIdentity}>
                    <span className={modalStyles.logoWrap}>
                      <SharePointLogo />
                    </span>
                    <div>
                      <strong>Microsoft SharePoint</strong>
                      <p>Planned provider</p>
                    </div>
                  </div>
                  <span className={modalStyles.comingSoonPill}>Coming soon</span>
                </div>
              </article>

              <article className={modalStyles.providerCard}>
                <div className={modalStyles.providerTopRow}>
                  <div className={modalStyles.providerIdentity}>
                    <span className={modalStyles.logoWrap}>
                      <ProgressShareFileLogo />
                    </span>
                    <div>
                      <strong>Progress ShareFile</strong>
                      <p>Planned provider</p>
                    </div>
                  </div>
                  <span className={modalStyles.comingSoonPill}>Coming soon</span>
                </div>
              </article>

              <article className={modalStyles.providerCard}>
                <div className={modalStyles.providerTopRow}>
                  <div className={modalStyles.providerIdentity}>
                    <span className={modalStyles.logoWrap}>
                      <DropboxLogo />
                    </span>
                    <div>
                      <strong>Dropbox</strong>
                      <p>Planned provider</p>
                    </div>
                  </div>
                  <span className={modalStyles.comingSoonPill}>Coming soon</span>
                </div>
              </article>
            </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function getProviderLabel(provider: string) {
  switch (provider) {
    case "google_drive":
      return "Google Drive";
    case "dropbox":
      return "Dropbox";
    case "sharepoint":
      return "Microsoft SharePoint";
    case "sharefile":
      return "Progress ShareFile";
    default:
      return provider;
  }
}

function dedupeConnections(connections: ExistingConnection[]) {
  const seen = new Set<string>();
  return connections.filter((connection) => {
    if (seen.has(connection.id)) {
      return false;
    }
    seen.add(connection.id);
    return true;
  });
}

function GoogleDriveLogo() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 64 56"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M20 2h12l20 34H40L20 2Z" fill="#0F9D58" />
      <path d="M12 16 20 2l20 34-8 14L12 16Z" fill="#34A853" />
      <path d="M12 16 0 36h40l12-20H12Z" fill="#FBBC04" />
      <path d="M32 50 40 36H0l8 14h24Z" fill="#4285F4" />
    </svg>
  );
}

function ProgressShareFileLogo() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M16 17.5c0-1.93 1.57-3.5 3.5-3.5H34c7.73 0 14 6.27 14 14s-6.27 14-14 14h-8v8h-6c-2.21 0-4-1.79-4-4v-28.5Z"
        fill="#0E9F6E"
      />
      <path
        d="M26 42h8c7.73 0 14-6.27 14-14 0-2.37-.59-4.61-1.63-6.56L33 35h-7v7Z"
        fill="#2563EB"
      />
      <path
        d="M21 22h12c3.31 0 6 2.69 6 6s-2.69 6-6 6h-7v8h-5V22Z"
        fill="#F8FAFC"
      />
    </svg>
  );
}

function SharePointLogo() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="30" y="14" width="22" height="36" rx="6" fill="#0EA5E9" opacity=".24" />
      <rect x="24" y="18" width="22" height="28" rx="6" fill="#0D9488" opacity=".4" />
      <circle cx="22" cy="32" r="16" fill="#0F766E" />
      <path
        d="M18 25.5c0-2.49 2.01-4.5 4.5-4.5H31v5h-8.5a1 1 0 0 0 0 2H28c3.31 0 6 2.69 6 6s-2.69 6-6 6h-10v-5h10a1 1 0 0 0 0-2h-5.5c-2.49 0-4.5-2.01-4.5-4.5Z"
        fill="#F8FAFC"
      />
    </svg>
  );
}

function DropboxLogo() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m18 12 14 9-10 8-14-9 10-8Z" fill="#0061FF" />
      <path d="m46 12 10 8-14 9-10-8 14-9Z" fill="#0061FF" />
      <path d="m8 36 14-9 10 8-14 9-10-8Z" fill="#0061FF" />
      <path d="m56 36-14-9-10 8 14 9 10-8Z" fill="#0061FF" />
      <path d="m22 48 10-8 10 8-10 6-10-6Z" fill="#0061FF" opacity=".8" />
    </svg>
  );
}
