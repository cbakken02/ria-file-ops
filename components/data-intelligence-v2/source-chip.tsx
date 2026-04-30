import type { V2SourceRef } from "@/lib/data-intelligence-v2/types";
import styles from "../data-intelligence-chat.module.css";

type SourceChipProps = {
  sourceRef: V2SourceRef;
};

export function SourceChip({ sourceRef }: SourceChipProps) {
  const parts = [
    sourceRef.sourceType.replaceAll("_", " "),
    sourceRef.date,
    typeof sourceRef.page === "number" ? `page ${sourceRef.page}` : null,
    sourceRef.confidence,
  ].filter(Boolean);

  return (
    <span className={styles.suggestionChip}>
      {sourceRef.label}
      {parts.length > 0 ? ` · ${parts.join(" · ")}` : ""}
    </span>
  );
}
