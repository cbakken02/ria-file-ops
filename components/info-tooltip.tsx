import Link from "next/link";
import styles from "./info-tooltip.module.css";

type InfoTooltipProps = {
  content: string;
  href?: string;
  hrefLabel?: string;
};

export function InfoTooltip({
  content,
  href,
  hrefLabel = "Open settings",
}: InfoTooltipProps) {
  return (
    <span
      aria-label={content}
      className={styles.wrapper}
      tabIndex={0}
    >
      <span aria-hidden="true" className={styles.trigger}>
        i
      </span>
      <span className={styles.bubble} role="tooltip">
        <span>{content}</span>
        {href ? (
          <Link className={styles.link} href={href}>
            {hrefLabel}
          </Link>
        ) : null}
      </span>
    </span>
  );
}
