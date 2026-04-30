import type { V2AssistantResponse } from "@/lib/data-intelligence-v2/assistant-response";
import type { V2SourceRef } from "@/lib/data-intelligence-v2/types";
import { DraftNoteCard } from "@/components/data-intelligence-v2/draft-note-card";
import { SafeMarkdownText } from "@/components/data-intelligence-v2/safe-markdown-text";
import { SecureRevealCard } from "@/components/data-intelligence-v2/secure-reveal-card";
import { SourceChip } from "@/components/data-intelligence-v2/source-chip";
import styles from "../data-intelligence-chat.module.css";

type AssistantResponseViewProps = {
  response: V2AssistantResponse;
  onFollowupSuggestion?: (suggestion: string) => void;
};

export function AssistantResponseView({
  response,
  onFollowupSuggestion,
}: AssistantResponseViewProps) {
  const sources = collectSources(response);

  return (
    <article
      className={response.responseType === "error" ? styles.errorCard : styles.assistantCard}
      data-status={response.responseType}
    >
      <div className={styles.cardHeader}>
        <span className={styles.statusBadge}>
          {labelForResponseType(response.responseType)}
        </span>
      </div>

      {response.answerMarkdown ? (
        <SafeMarkdownText
          className={styles.answer}
          text={response.answerMarkdown}
        />
      ) : null}

      {response.sourceBackedFacts.length > 0 ? (
        <section className={styles.responseSection}>
          <p className={styles.responseSectionTitle}>Found in client data</p>
          <div className={styles.responseSectionBody}>
            <ul>
              {response.sourceBackedFacts.map((fact) => (
                <li key={fact.fact}>
                  <span>{fact.fact}</span>
                  {fact.sourceRefs.length > 0 ? (
                    <div className={styles.suggestionRow}>
                      {fact.sourceRefs.map((sourceRef) => (
                        <SourceChip
                          key={`${sourceRef.sourceId}-${sourceRef.label}`}
                          sourceRef={sourceRef}
                        />
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {response.missingOrUnverified.length > 0 ? (
        <section className={styles.responseSection}>
          <p className={styles.responseSectionTitle}>Missing / needs verification</p>
          <div className={styles.responseSectionBody}>
            <ul>
              {response.missingOrUnverified.map((item) => (
                <li key={`${item.item}-${item.reason}`}>
                  {item.item}: {item.reason}
                  {item.checked.length > 0
                    ? ` Checked: ${item.checked.join(", ")}.`
                    : ""}
                  {item.suggestedNextStep
                    ? ` Next: ${item.suggestedNextStep}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {response.recommendedSteps.length > 0 ? (
        <section className={styles.responseSection}>
          <p className={styles.responseSectionTitle}>Recommended next steps</p>
          <div className={styles.responseSectionBody}>
            <ul>
              {response.recommendedSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {response.secureRevealCards.length > 0 ? (
        <section className={styles.responseSection}>
          <p className={styles.responseSectionTitle}>Secure values</p>
          <div className={styles.responseSections}>
            {response.secureRevealCards.map((card) => (
              <SecureRevealCard card={card} key={card.revealCardId} />
            ))}
          </div>
        </section>
      ) : null}

      {response.draftNote ? (
        <DraftNoteCard draftNote={response.draftNote} />
      ) : null}

      {sources.length > 0 ? (
        <section className={styles.responseSection}>
          <p className={styles.responseSectionTitle}>Sources</p>
          <div className={styles.suggestionRow}>
            {sources.map((sourceRef) => (
              <SourceChip
                key={`${sourceRef.sourceId}-${sourceRef.label}`}
                sourceRef={sourceRef}
              />
            ))}
          </div>
        </section>
      ) : null}

      {response.followupSuggestions.length > 0 ? (
        <section className={styles.responseSection}>
          <p className={styles.responseSectionTitle}>Follow-up suggestions</p>
          <div className={styles.suggestionRow}>
            {response.followupSuggestions.map((suggestion) => (
              <button
                className={styles.suggestionChip}
                key={suggestion}
                onClick={() => onFollowupSuggestion?.(suggestion)}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function collectSources(response: V2AssistantResponse): V2SourceRef[] {
  const byId = new Map<string, V2SourceRef>();
  for (const fact of response.sourceBackedFacts) {
    for (const sourceRef of fact.sourceRefs) {
      byId.set(`${sourceRef.sourceId}:${sourceRef.label}`, sourceRef);
    }
  }
  return [...byId.values()];
}

function labelForResponseType(responseType: V2AssistantResponse["responseType"]) {
  return responseType.replaceAll("_", " ");
}
