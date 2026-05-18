"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { SafeAccountSessionStatus } from "@/lib/auth/account-session-status";
import styles from "./account-session-status.module.css";

type AccountSessionStatusProps = {
  showDetails?: boolean;
  initialStatus: SafeAccountSessionStatus;
};

type KeepaliveState =
  | {
      message: string;
      toneClass: "toneError" | "toneSuccess";
    }
  | null;

const TICK_INTERVAL_MS = 30 * 1000;

export function AccountSessionStatus({
  showDetails = true,
  initialStatus,
}: AccountSessionStatusProps) {
  const [status, setStatus] = useState(initialStatus);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [keepaliveState, setKeepaliveState] = useState<KeepaliveState>(null);
  const [isPending, startTransition] = useTransition();
  const sessionView = useMemo(
    () => getSessionView(status, nowMs),
    [nowMs, status],
  );

  useEffect(() => {
    const timer = window.setInterval(
      () => setNowMs(Date.now()),
      TICK_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  function continueSession() {
    setKeepaliveState(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/session/keepalive", {
          credentials: "same-origin",
          method: "POST",
        });

        const payload = (await response.json().catch(() => null)) as
          | SafeAccountSessionStatus
          | { error?: string }
          | null;

        if (!response.ok) {
          setKeepaliveState({
            message:
              payload && "error" in payload
                ? payload.error ?? "Session expired."
                : "Session expired.",
            toneClass: "toneError",
          });
          return;
        }

        setStatus(payload as SafeAccountSessionStatus);
        setNowMs(Date.now());
        setKeepaliveState({
          message: "Session continued.",
          toneClass: "toneSuccess",
        });
      } catch {
        setKeepaliveState({
          message: "Could not continue the session.",
          toneClass: "toneError",
        });
      }
    });
  }

  return (
    <>
      {sessionView.shouldWarn ? (
        <div
          className={`${styles.warning} ${
            sessionView.status === "expired" ? styles.warningExpired : ""
          }`}
          role="status"
        >
          <div>
            <strong>{sessionView.warningTitle}</strong>
            <span>{sessionView.warningMessage}</span>
          </div>
          {sessionView.status === "expired" ? (
            <a
              className={styles.warningButton}
              href="/login?reason=idle_timeout"
            >
              Log in
            </a>
          ) : (
            <button
              className={styles.warningButton}
              disabled={isPending}
              onClick={continueSession}
              type="button"
            >
              {isPending ? "Continuing..." : "Continue"}
            </button>
          )}
        </div>
      ) : null}

      {showDetails ? (
        <div className={styles.details} aria-label="Account session status">
          <div className={styles.detailRow}>
            <span>Signed in</span>
            <strong>{status.user.email}</strong>
          </div>
          <div className={styles.detailRow}>
            <span>Role</span>
            <strong>{formatRole(status.user.role)}</strong>
          </div>
          <div className={styles.detailRow}>
            <span>Session</span>
            <strong className={styles[sessionView.toneClass]}>
              {sessionView.statusLabel}
            </strong>
          </div>
          <div className={styles.detailRow}>
            <span>Idle logout</span>
            <strong>{sessionView.idleLabel}</strong>
          </div>
          <div className={styles.detailRow}>
            <span>Storage</span>
            <strong className={styles[getStorageTone(status.storage.status)]}>
              {getStorageLabel(status.storage)}
            </strong>
          </div>
          {status.storage.accountIdentifier ? (
            <div className={styles.detailRow}>
              <span>Storage account</span>
              <strong>{status.storage.accountIdentifier}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {showDetails && keepaliveState ? (
        <p
          className={`${styles.statusMessage} ${
            styles[keepaliveState.toneClass]
          }`}
        >
          {keepaliveState.message}
        </p>
      ) : null}
    </>
  );
}

function getSessionView(status: SafeAccountSessionStatus, nowMs: number) {
  const idleExpiresAtMs = new Date(status.session.idleExpiresAt).getTime();
  const idleWarningStartsAtMs = new Date(
    status.session.idleWarningStartsAt,
  ).getTime();
  const absoluteExpiresAtMs = new Date(status.session.absoluteExpiresAt).getTime();
  const expiresAtMs = Math.min(idleExpiresAtMs, absoluteExpiresAtMs);
  const remainingMs = expiresAtMs - nowMs;
  const expired = status.session.status === "expired" || remainingMs <= 0;
  const warning =
    !expired &&
    (status.session.status === "idle_warning" ||
      nowMs >= idleWarningStartsAtMs);
  const idleLabel = expired
    ? "Expired"
    : `in ${formatRemainingTime(remainingMs)}`;

  if (expired) {
    return {
      idleLabel,
      shouldWarn: true,
      status: "expired" as const,
      statusLabel: "Expired",
      toneClass: "toneError" as const,
      warningMessage: "Log in again before continuing work.",
      warningTitle: "Session expired",
    };
  }

  if (warning) {
    return {
      idleLabel,
      shouldWarn: true,
      status: "idle_warning" as const,
      statusLabel: "Idle warning",
      toneClass: "toneWarning" as const,
      warningMessage: `Idle logout ${idleLabel}.`,
      warningTitle: "Session nearly idle",
    };
  }

  return {
    idleLabel,
    shouldWarn: false,
    status: "active" as const,
    statusLabel: "Active",
    toneClass: "toneSuccess" as const,
    warningMessage: "",
    warningTitle: "",
  };
}

function getStorageLabel(storage: SafeAccountSessionStatus["storage"]) {
  if (storage.status === "not_connected") {
    return "Not connected";
  }

  if (storage.status === "needs_reconnect") {
    return `${storage.providerLabel} needs reconnect`;
  }

  return `${storage.providerLabel} connected`;
}

function getStorageTone(status: SafeAccountSessionStatus["storage"]["status"]) {
  if (status === "connected") {
    return "toneSuccess";
  }

  if (status === "needs_reconnect") {
    return "toneWarning";
  }

  return "toneMuted";
}

function formatRemainingTime(remainingMs: number) {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const extraMinutes = minutes % 60;
    return extraMinutes > 0 ? `${hours}h ${extraMinutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

function formatRole(role: SafeAccountSessionStatus["user"]["role"]) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
