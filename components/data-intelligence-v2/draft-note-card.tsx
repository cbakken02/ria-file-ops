import type { V2DraftNote } from "@/lib/data-intelligence-v2/assistant-response";
import { SafeMarkdownText } from "@/components/data-intelligence-v2/safe-markdown-text";
import styles from "../data-intelligence-chat.module.css";

type DraftNoteCardProps = {
  draftNote: V2DraftNote;
};

export function DraftNoteCard({ draftNote }: DraftNoteCardProps) {
  return (
    <section className={styles.detailCard} aria-label="Draft note">
      <p className={styles.detailCardTitle}>
        Draft note · {draftNote.audience}
      </p>
      <SafeMarkdownText className={styles.answer} text={draftNote.bodyMarkdown} />
      {draftNote.containsSensitivePlaceholders ? (
        <p className={styles.followUp}>
          This note contains placeholders and should be reviewed before use.
        </p>
      ) : null}
    </section>
  );
}
