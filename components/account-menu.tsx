"use client";

import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ProductNavPath } from "@/lib/product-navigation";
import styles from "./product-shell.module.css";

type AccountMenuProps = {
  accountMeta: string | null;
  accountSubtitle: string;
  currentPath: ProductNavPath;
  displayName: string;
  image: string | null;
  initials: string;
};

export function AccountMenu({
  accountMeta,
  accountSubtitle,
  currentPath,
  displayName,
  image,
  initials,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [reportBugOpen, setReportBugOpen] = useState(false);
  const [bugMessage, setBugMessage] = useState("");
  const [bugReportStatus, setBugReportStatus] = useState<{
    status: "idle" | "error" | "success";
    message: string;
  }>({
    status: "idle",
    message: "",
  });
  const [isSubmittingBug, startBugSubmitTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setHelpOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setHelpOpen(false);
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
    if (!reportBugOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setReportBugOpen(false);
        setBugMessage("");
        setBugReportStatus({ status: "idle", message: "" });
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [reportBugOpen]);

  useEffect(() => {
    if (bugReportStatus.status !== "success" || !reportBugOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      setReportBugOpen(false);
      setBugReportStatus({ status: "idle", message: "" });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [bugReportStatus.status, reportBugOpen]);

  function openBugReportModal() {
    setOpen(false);
    setHelpOpen(false);
    setReportBugOpen(true);
    setBugMessage("");
    setBugReportStatus({ status: "idle", message: "" });
  }

  function closeBugReportModal() {
    if (isSubmittingBug) {
      return;
    }

    setReportBugOpen(false);
    setBugMessage("");
    setBugReportStatus({ status: "idle", message: "" });
  }

  function handleBugSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = bugMessage.trim();

    if (!trimmedMessage) {
      setBugReportStatus({
        status: "error",
        message: "Add a few details before submitting.",
      });
      return;
    }

    setBugReportStatus({ status: "idle", message: "" });

    startBugSubmitTransition(async () => {
      try {
        const response = await fetch("/api/bug-reports", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            currentPath,
            message: trimmedMessage,
          }),
        });

        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        if (!response.ok) {
          setBugReportStatus({
            status: "error",
            message: payload?.error ?? "Could not submit bug report.",
          });
          return;
        }

        setBugMessage("");
        setBugReportStatus({
          status: "success",
          message: "Bug report submitted.",
        });
      } catch {
        setBugReportStatus({
          status: "error",
          message: "Could not submit bug report.",
        });
      }
    });
  }

  return (
    <div
      className={`${styles.accountMenu} ${open ? styles.accountMenuOpen : ""}`}
      ref={containerRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={styles.accountButton}
        onClick={() => {
          if (open) {
            setHelpOpen(false);
          }

          setOpen((current) => !current);
        }}
        type="button"
      >
        <div className={styles.accountIdentity}>
          <ProfileAvatar
            displayName={displayName}
            image={image}
            initials={initials}
          />
          <div className={styles.accountText}>
            <strong>{displayName}</strong>
            <span>{accountSubtitle}</span>
          </div>
        </div>
        <span className={styles.accountChevron}>⌃</span>
      </button>

      {open ? (
        <div className={styles.accountPopover}>
          <div className={styles.accountPopoverHeader}>
            <div className={styles.accountIdentity}>
              <ProfileAvatar
                displayName={displayName}
                image={image}
                initials={initials}
              />
              <div className={styles.accountText}>
                <strong>{displayName}</strong>
                <span>{accountSubtitle}</span>
                {accountMeta ? <small>{accountMeta}</small> : null}
              </div>
            </div>
          </div>

          <div className={styles.accountMenuLinks} role="menu">
            <Link
              className={
                currentPath === "/setup"
                  ? styles.activeAccountLink
                  : styles.accountLink
              }
              href="/setup"
              onClick={() => setOpen(false)}
              prefetch={false}
              role="menuitem"
            >
              <span className={styles.accountRowIcon}>
                <GearIcon />
              </span>
              <span>Settings</span>
              <span className={styles.accountRowAccessory}>
                <ChevronRightIcon />
              </span>
            </Link>

            <button
              aria-expanded={helpOpen}
              className={styles.accountActionButton}
              onClick={() => setHelpOpen((current) => !current)}
              role="menuitem"
              type="button"
            >
              <span className={styles.accountRowIcon}>
                <HelpIcon />
              </span>
              <span>Help</span>
              <span
                className={`${styles.accountRowAccessory} ${
                  helpOpen ? styles.accountRowAccessoryOpen : ""
                }`}
              >
                <ChevronRightIcon />
              </span>
            </button>

            {helpOpen ? (
              <div className={styles.accountSubmenu}>
                <button
                  className={styles.accountSubmenuButton}
                  onClick={openBugReportModal}
                  type="button"
                >
                  <span className={styles.accountRowIcon}>
                    <BugIcon />
                  </span>
                  <span>Report a bug</span>
                </button>
              </div>
            ) : null}

            <button
              className={styles.accountActionButton}
              onClick={() => signOut({ callbackUrl: "/" })}
              role="menuitem"
              type="button"
            >
              <span className={styles.accountRowIcon}>
                <LogOutIcon />
              </span>
              <span>Log out</span>
            </button>
          </div>
        </div>
      ) : null}

      {reportBugOpen ? (
        <div
          className={styles.bugReportOverlay}
          onClick={closeBugReportModal}
          role="presentation"
        >
          <div
            aria-modal="true"
            className={styles.bugReportModal}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className={styles.bugReportHeader}>
              <button
                aria-label="Close bug report modal"
                className={styles.bugReportClose}
                onClick={closeBugReportModal}
                type="button"
              >
                ×
              </button>
              <h2 className={styles.bugReportTitle}>Report a bug</h2>
            </div>

            <form className={styles.bugReportBody} onSubmit={handleBugSubmit}>
              <textarea
                className={styles.bugReportTextarea}
                onChange={(event) => setBugMessage(event.target.value)}
                placeholder="Tell us what happened, where you were in the app, and what you expected instead."
                rows={8}
                value={bugMessage}
              />

              {bugReportStatus.message ? (
                <p
                  className={
                    bugReportStatus.status === "error"
                      ? styles.bugReportError
                      : styles.bugReportSuccess
                  }
                >
                  {bugReportStatus.message}
                </p>
              ) : null}

              <div className={styles.bugReportActions}>
                <button
                  className={styles.bugReportSubmit}
                  disabled={isSubmittingBug || bugMessage.trim().length === 0}
                  type="submit"
                >
                  {isSubmittingBug ? "Submitting..." : "Submit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProfileAvatar({
  displayName,
  image,
  initials,
}: {
  displayName: string;
  image: string | null;
  initials: string;
}) {
  if (image) {
    return (
      <Image
        alt={displayName}
        className={styles.avatarImage}
        height={36}
        unoptimized
        referrerPolicy="no-referrer"
        src={image}
        width={36}
      />
    );
  }

  return <span className={styles.avatar}>{initials}</span>;
}

function GearIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M8.48 2.41c.35-1.02 1.79-1.02 2.14 0l.25.74c.14.4.52.65.94.62l.78-.06c1.07-.08 1.79 1.16 1.19 2.04l-.44.64a.98.98 0 0 0 .07 1.12l.47.58c.68.84.09 2.13-.99 2.16l-.75.02a.98.98 0 0 0-.89.69l-.23.74c-.32 1.03-1.77 1.08-2.16.07l-.29-.72a.98.98 0 0 0-.94-.62l-.75.04c-1.08.07-1.79-1.18-1.17-2.05l.43-.61a.98.98 0 0 0-.05-1.13l-.47-.58c-.68-.84-.08-2.13 1-2.15l.74-.02c.42-.01.79-.28.92-.68l.24-.74Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7.9 7.55A2.4 2.4 0 0 1 10 6.4c1.38 0 2.5.94 2.5 2.2 0 1.78-2.1 2.08-2.1 3.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <circle cx="10" cy="14.2" r=".7" fill="currentColor" />
    </svg>
  );
}

function BugIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M10 6.1c2.4 0 4.1 1.82 4.1 4.3 0 2.52-1.74 4.5-4.1 4.5s-4.1-1.98-4.1-4.5c0-2.48 1.7-4.3 4.1-4.3Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8.35 6.2 7.1 4.8M11.65 6.2 12.9 4.8M5.1 8.35l-1.7-.7M14.9 8.35l1.7-.7M5 11.2H3.2M15 11.2h1.8M6.1 13.8l-1.3 1.2M13.9 13.8l1.3 1.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M8.1 4.2H5.9c-1 0-1.8.8-1.8 1.8v8c0 1 .8 1.8 1.8 1.8h2.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M10.1 6.4 14 10l-3.9 3.6M14 10H7.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="m7.6 4.8 5.1 5.2-5.1 5.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}
