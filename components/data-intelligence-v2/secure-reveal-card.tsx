"use client";

import { useState } from "react";
import type { ModelSafeRevealCard } from "@/lib/data-intelligence-v2/types";
import styles from "../data-intelligence-chat.module.css";

type SecureRevealCardProps = {
  card: ModelSafeRevealCard;
};

type RevealApiSuccess = {
  status: "success";
  revealCardId: string;
  fieldKey: string;
  label: string;
  value: string;
  expiresAt: string;
};

export function SecureRevealCard({ card }: SecureRevealCardProps) {
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revealValue() {
    if (isRevealing || card.status !== "on_file") {
      return;
    }

    setError(null);
    setIsRevealing(true);
    try {
      const response = await fetch("/api/data-intelligence/v2/reveal", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ revealCardId: card.revealCardId }),
      });

      const payload = (await response.json()) as unknown;
      if (!response.ok || !isRevealSuccess(payload)) {
        setError(safeRevealError(response.status));
        return;
      }

      setRevealedValue(payload.value);
    } catch {
      setError("Reveal failed.");
    } finally {
      setIsRevealing(false);
    }
  }

  return (
    <section className={styles.detailCard} aria-label="Secure reveal card">
      <div className={styles.cardHeader}>
        <span className={styles.statusBadge}>Secure value</span>
        <h3>{card.label}</h3>
      </div>

      <div className={styles.detailGrid}>
        <div className={styles.detailRow}>
          <p className={styles.detailTerm}>Field</p>
          <p className={styles.detailValue}>{card.fieldLabel}</p>
        </div>
        <div className={styles.detailRow}>
          <p className={styles.detailTerm}>Status</p>
          <p className={styles.detailValue}>{card.status.replaceAll("_", " ")}</p>
        </div>
        {card.maskedValue ? (
          <div className={styles.detailRow}>
            <p className={styles.detailTerm}>Masked value</p>
            <p className={styles.detailValue}>{card.maskedValue}</p>
          </div>
        ) : null}
        <div className={styles.detailRow}>
          <p className={styles.detailTerm}>Expires</p>
          <p className={styles.detailValue}>{card.expiresAt}</p>
        </div>
      </div>

      {revealedValue ? (
        <div className={styles.detailSection}>
          <p className={styles.detailTerm}>Revealed value</p>
          <p className={styles.detailValue}>{revealedValue}</p>
          <button
            className={styles.detailToggle}
            onClick={() => setRevealedValue(null)}
            type="button"
          >
            Hide
          </button>
        </div>
      ) : (
        <button
          className={styles.detailToggle}
          disabled={isRevealing || card.status !== "on_file"}
          onClick={() => void revealValue()}
          type="button"
        >
          {isRevealing ? "Revealing..." : "Reveal"}
        </button>
      )}

      {error ? <p className={styles.followUp}>{error}</p> : null}
      <p className={styles.followUp}>
        The raw value is displayed only in this card after authorization.
      </p>
    </section>
  );
}

function isRevealSuccess(value: unknown): value is RevealApiSuccess {
  return (
    Boolean(value && typeof value === "object") &&
    (value as RevealApiSuccess).status === "success" &&
    typeof (value as RevealApiSuccess).value === "string"
  );
}

function safeRevealError(status: number) {
  switch (status) {
    case 401:
      return "Sign in is required to reveal this value.";
    case 403:
      return "Reveal denied.";
    case 404:
      return "Reveal card not found.";
    case 410:
      return "Reveal card expired.";
    default:
      return "Reveal failed.";
  }
}
