import Link from "next/link";
import styles from "./storage-status-panel.module.css";

type StorageStatusPanelProps = {
  title: string;
  message: string;
  detail?: string | null;
  actionLabel?: string;
  actionHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  className?: string;
};

export function StorageStatusPanel({
  title,
  message,
  detail = null,
  actionLabel = "Open workspace settings",
  actionHref = "/setup?section=workspace",
  secondaryLabel,
  secondaryHref,
  className,
}: StorageStatusPanelProps) {
  return (
    <section className={`${styles.panel} ${className ?? ""}`.trim()}>
      <div className={styles.surface}>
        <div className={styles.inner}>
          <div className={styles.copy}>
            <strong>{title}</strong>
            <p>{message}</p>
            {detail ? <p className={styles.detail}>{detail}</p> : null}
          </div>

          <div className={styles.actions}>
            <Link className={styles.action} href={actionHref}>
              {actionLabel}
            </Link>
            {secondaryLabel && secondaryHref ? (
              <Link className={styles.secondaryAction} href={secondaryHref}>
                {secondaryLabel}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
