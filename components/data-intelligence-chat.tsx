"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  canCopyDetailRow,
  canRevealDetailRow,
  DETAIL_COPY_RESET_MS,
  buildDetailSectionTitle,
  buildPrimarySourceFileHref,
  buildSourceDetailRows,
  getDetailRowCopyValue,
  getDetailRowVisibleValue,
  hasDetailPanelContent,
  toggleExpandedDetailsMessage,
} from "@/lib/data-intelligence-source-ui";
import {
  DATA_INTELLIGENCE_HISTORY_MAX_MESSAGES,
  DATA_INTELLIGENCE_HISTORY_MAX_TEXT_LENGTH,
  deriveDataIntelligenceConversationStateFromResult,
  type DataIntelligenceConversationState,
  type DataIntelligenceConversationMessage,
} from "@/lib/data-intelligence-conversation";
import {
  DATA_INTELLIGENCE_EMPTY_SUBTEXT,
  DATA_INTELLIGENCE_EMPTY_TITLE,
  isSubmittableDataIntelligenceQuestion,
} from "@/lib/data-intelligence-ui";
import styles from "./data-intelligence-chat.module.css";

type AssistantSource = {
  sourceFileId?: string | null;
  sourceName: string | null;
  documentDate: string | null;
  statementEndDate?: string | null;
  institutionName?: string | null;
  accountType?: string | null;
  registrationType?: string | null;
  partyDisplayName?: string | null;
  accountLast4?: string | null;
  accountNumber?: string | null;
  maskedAccountNumber?: string | null;
  valueLabel?: string | null;
  valueAmount?: string | null;
  contactValue?: string | null;
  birthDate?: string | null;
  addressText?: string | null;
  issuingAuthority?: string | null;
  expirationDate?: string | null;
  idType?: string | null;
};

type AssistantResult = {
  status: "answered" | "not_found" | "ambiguous" | "unsupported";
  intent: string | null;
  question: string;
  title: string;
  answer: string;
  details: string[];
  sources: AssistantSource[];
  presentation: {
    mode:
      | "concise_answer"
      | "concise_answer_with_source"
      | "summary_answer"
      | "ambiguity_prompt"
      | "not_found"
      | "unsupported";
    shellTone: "assistant" | "warning";
    showTitle: boolean;
    showDetails: boolean;
    detailLabel: string | null;
    showSourceLine: boolean;
    sourceLine: string | null;
    showSources: boolean;
    followUp: string | null;
  };
};

type ChatMessage =
  | {
      id: string;
      role: "user";
      text: string;
    }
  | {
      id: string;
      role: "assistant";
      result: AssistantResult;
    }
  | {
      id: string;
      role: "assistant";
      error: string;
    };

export const DATA_INTELLIGENCE_EXAMPLE_PROMPTS = [
  "latest 401(k) snapshot for Christopher Bakken",
  "rollover support phone for Christopher Bakken's 401(k)",
  "what is Christopher T Bakken's DOB?",
  "what address is on Christopher Bakken's latest ID?",
  "do we have an unexpired driver's license on file for Christopher Bakken?",
] as const;

export function DataIntelligenceChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationState, setConversationState] =
    useState<DataIntelligenceConversationState | null>(null);
  const [expandedDetailsMessageId, setExpandedDetailsMessageId] = useState<string | null>(
    null,
  );
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const hasMessages = messages.length > 0;
  const canSubmit = isSubmittableDataIntelligenceQuestion(question) && !isLoading;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({
      behavior: hasMessages ? "smooth" : "auto",
      block: "end",
    });
  }, [hasMessages, isLoading, messages]);

  async function submitQuestion(nextQuestion?: string) {
    const activeQuestion = (nextQuestion ?? question).trim();
    if (!activeQuestion || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId("user"),
      role: "user",
      text: activeQuestion,
    };

    setMessages((current) => [...current, userMessage]);
    setExpandedDetailsMessageId(null);
    setQuestion("");
    setIsLoading(true);

    try {
      const history = buildRequestHistory(messages);
      const response = await fetch("/api/query-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: activeQuestion,
          history,
          conversationState,
        }),
      });

      const payload = (await response.json()) as AssistantResult | { error?: unknown };

      if (!response.ok || !isAssistantResult(payload)) {
        const errorMessage = readErrorMessage(payload);
        throw new Error(errorMessage ?? "The query assistant request failed.");
      }

      setMessages((current) => [
        ...current,
        {
          id: createMessageId("assistant"),
          role: "assistant",
          result: payload,
        },
      ]);
      setConversationState((current) =>
        deriveDataIntelligenceConversationStateFromResult({
          previousState: current,
          result: payload,
        }),
      );
    } catch (requestError) {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId("assistant-error"),
          role: "assistant",
          error:
            requestError instanceof Error
              ? requestError.message
              : "The query assistant request failed.",
        },
      ]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }

  return (
    <section className={styles.workspace} aria-label="Data Intelligence assistant">
      <div className={styles.transcript}>
        {!hasMessages ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateInner}>
              <h2>{DATA_INTELLIGENCE_EMPTY_TITLE}</h2>
              <p className={styles.emptyCopy}>{DATA_INTELLIGENCE_EMPTY_SUBTEXT}</p>

              <div className={styles.exampleGrid}>
                {DATA_INTELLIGENCE_EXAMPLE_PROMPTS.map((example) => (
                  <button
                    key={example}
                    className={styles.examplePrompt}
                    disabled={isLoading}
                    onClick={() => {
                      setQuestion(example);
                      void submitQuestion(example);
                    }}
                    type="button"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.messageList}>
            {messages.map((message) =>
              message.role === "user" ? (
                <div className={styles.userRow} key={message.id}>
                  <div className={styles.userBubble}>{message.text}</div>
                </div>
              ) : "result" in message ? (
                <article
                  className={styles.assistantCard}
                  data-mode={message.result.presentation.mode}
                  data-status={message.result.status}
                  data-tone={message.result.presentation.shellTone}
                  key={message.id}
                >
                  {shouldRenderMetaHeader(message.result) ? (
                    <div className={styles.cardHeader}>
                      <span className={styles.statusBadge}>
                        {labelForPresentationMode(message.result.presentation.mode)}
                      </span>
                      {message.result.presentation.showTitle ? (
                        <h3>{message.result.title}</h3>
                      ) : null}
                    </div>
                  ) : null}

                  <p className={styles.answer}>{message.result.answer}</p>

                  {message.result.presentation.followUp ? (
                    <p className={styles.followUp}>{message.result.presentation.followUp}</p>
                  ) : null}

                  {message.result.presentation.showDetails &&
                  message.result.details.length > 0 &&
                  message.result.status !== "answered" ? (
                    <section className={styles.detailSection}>
                      {message.result.presentation.detailLabel ? (
                        <p className={styles.sectionLabel}>
                          {message.result.presentation.detailLabel}
                        </p>
                      ) : null}
                      <ul className={styles.detailList}>
                        {message.result.details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  <AssistantMessageActions
                    expandedDetailsMessageId={expandedDetailsMessageId}
                    messageId={message.id}
                    result={message.result}
                    setExpandedDetailsMessageId={setExpandedDetailsMessageId}
                  />
                </article>
              ) : (
                <article className={styles.errorCard} key={message.id}>
                  <p className={styles.statusBadge}>Request error</p>
                  <p className={styles.answer}>{message.error}</p>
                </article>
              ),
            )}

            {isLoading ? (
              <div className={styles.loadingRow}>
                <div className={styles.loadingCard}>
                  <span className={styles.loadingDot} />
                  <span>Searching the firm document store...</span>
                </div>
              </div>
            ) : null}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>

      <div className={styles.composer}>
        <div className={styles.composerInner}>
          <textarea
            ref={textareaRef}
            className={styles.input}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitQuestion();
              }
            }}
            placeholder="Ask about a latest statement, support contact, DOB, address, or license expiration."
            rows={1}
            value={question}
          />
          <div className={styles.composerActions}>
            <p className={styles.composerHint}>Statements and IDs for now.</p>
            <button
              aria-label="Send question"
              className={styles.submitButton}
              disabled={!canSubmit}
              onClick={() => void submitQuestion()}
              type="button"
            >
              <span aria-hidden="true" className={styles.submitIcon}>
                {isLoading ? "…" : "↑"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function buildRequestHistory(messages: ChatMessage[]): DataIntelligenceConversationMessage[] {
  return messages
    .map((message): DataIntelligenceConversationMessage | null => {
      if (message.role === "user") {
        return {
          role: "user",
          text: message.text.trim().slice(0, DATA_INTELLIGENCE_HISTORY_MAX_TEXT_LENGTH),
        };
      }

      if ("result" in message) {
        return {
          role: "assistant",
          text: message.result.answer
            .trim()
            .slice(0, DATA_INTELLIGENCE_HISTORY_MAX_TEXT_LENGTH),
        };
      }

      if ("error" in message) {
        return {
          role: "assistant",
          text: message.error
            .trim()
            .slice(0, DATA_INTELLIGENCE_HISTORY_MAX_TEXT_LENGTH),
        };
      }

      return null;
    })
    .filter((message): message is DataIntelligenceConversationMessage =>
      Boolean(message?.text),
    )
    .slice(-DATA_INTELLIGENCE_HISTORY_MAX_MESSAGES);
}

function AssistantMessageActions({
  expandedDetailsMessageId,
  messageId,
  result,
  setExpandedDetailsMessageId,
}: {
  expandedDetailsMessageId: string | null;
  messageId: string;
  result: AssistantResult;
  setExpandedDetailsMessageId: Dispatch<SetStateAction<string | null>>;
}) {
  const [copiedRowKey, setCopiedRowKey] = useState<string | null>(null);
  const [revealedRowKeys, setRevealedRowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!copiedRowKey) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopiedRowKey(null);
    }, DETAIL_COPY_RESET_MS);

    return () => window.clearTimeout(timeoutId);
  }, [copiedRowKey]);

  if (result.status !== "answered") {
    return null;
  }

  const hasDetails = hasDetailPanelContent(result.sources, result.details.length);
  const fileHref = buildPrimarySourceFileHref(result.sources);
  if (!hasDetails && !fileHref) {
    return null;
  }

  const isExpanded = expandedDetailsMessageId === messageId;

  async function handleCopyValue(value: string, rowKey: string) {
    const copied = await copyTextValue(value);
    if (copied) {
      setCopiedRowKey(rowKey);
    }
  }

  return (
    <div className={styles.messageActionSection}>
      <div className={styles.messageActions}>
        {hasDetails ? (
          <button
            aria-expanded={isExpanded}
            className={styles.detailToggle}
            onClick={() =>
              setExpandedDetailsMessageId((current) =>
                toggleExpandedDetailsMessage(current, messageId),
              )
            }
            type="button"
          >
            Details
          </button>
        ) : null}

        {fileHref ? (
          <a
            aria-label="Open source file"
            className={styles.fileAction}
            href={fileHref}
            rel="noreferrer"
            target="_blank"
            title="Open source file"
          >
            <svg
              aria-hidden="true"
              className={styles.fileActionIcon}
              viewBox="0 0 16 16"
            >
              <path
                d="M4 1.5h5l3 3V14a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 14z"
                fill="none"
                stroke="currentColor"
                strokeLinejoin="round"
              />
              <path d="M9 1.5V5h3" fill="none" stroke="currentColor" strokeLinejoin="round" />
            </svg>
          </a>
        ) : null}
      </div>

      {hasDetails && isExpanded ? (
        <div className={styles.detailsPanel}>
          {result.sources.map((source, index) => {
            const rows = buildSourceDetailRows(source);
            if (rows.length === 0) {
              return null;
            }

            return (
              <section
                className={styles.detailCard}
                key={`${source.sourceName ?? "source"}-${index}`}
              >
                {buildDetailSectionTitle(index, result.sources.length) ? (
                  <p className={styles.detailCardTitle}>
                    {buildDetailSectionTitle(index, result.sources.length)}
                  </p>
                ) : null}
                <dl className={styles.detailGrid}>
                  {rows.map((row) => (
                    <div className={styles.detailRow} key={row.key}>
                      <dt className={styles.detailTerm}>{row.label}</dt>
                      <div className={styles.detailValueRow}>
                        <dd className={styles.detailValue}>
                          {getDetailRowVisibleValue(row, Boolean(revealedRowKeys[row.key]))}
                        </dd>
                        <div className={styles.detailInlineActions}>
                          {canRevealDetailRow(row) ? (
                            <button
                              aria-label={
                                revealedRowKeys[row.key]
                                  ? `Hide ${row.label}`
                                  : `Show ${row.label}`
                              }
                              className={styles.inlineActionButton}
                              onClick={() =>
                                setRevealedRowKeys((current) => ({
                                  ...current,
                                  [row.key]: !current[row.key],
                                }))
                              }
                              type="button"
                            >
                              {revealedRowKeys[row.key] ? (
                                <svg
                                  aria-hidden="true"
                                  className={styles.inlineActionIcon}
                                  viewBox="0 0 16 16"
                                >
                                  <path
                                    d="M2 2l12 12"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                  />
                                  <path
                                    d="M5.2 5.2A6.47 6.47 0 0 1 8 4.6c3 0 5.2 1.5 6.3 4.4-.38 1-.9 1.82-1.53 2.46"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M4.1 6.95A2.95 2.95 0 0 0 8 10.9"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M1.7 8c.42-1.12 1-2.03 1.72-2.73M8 13.4c-3 0-5.2-1.5-6.3-4.4"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              ) : (
                                <svg
                                  aria-hidden="true"
                                  className={styles.inlineActionIcon}
                                  viewBox="0 0 16 16"
                                >
                                  <path
                                    d="M1.4 8C2.43 4.67 4.78 3 8 3s5.57 1.67 6.6 5c-1.03 3.33-3.38 5-6.6 5S2.43 11.33 1.4 8Z"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinejoin="round"
                                  />
                                  <circle
                                    cx="8"
                                    cy="8"
                                    fill="none"
                                    r="2.2"
                                    stroke="currentColor"
                                  />
                                </svg>
                              )}
                            </button>
                          ) : null}

                          {canCopyDetailRow(row) ? (
                            <button
                              aria-label={`Copy ${row.label}`}
                              className={styles.inlineActionButton}
                              onClick={() =>
                                void handleCopyValue(
                                  getDetailRowCopyValue(row, Boolean(revealedRowKeys[row.key])),
                                  row.key,
                                )
                              }
                              type="button"
                            >
                              {copiedRowKey === row.key ? (
                                <span className={styles.copySuccess} aria-hidden="true">
                                  ✓
                                </span>
                              ) : (
                                <svg
                                  aria-hidden="true"
                                  className={styles.inlineActionIcon}
                                  viewBox="0 0 16 16"
                                >
                                  <path
                                    d="M5 2.5h5.2c.72 0 1.3.58 1.3 1.3V13a.5.5 0 0 1-.5.5H5A1.5 1.5 0 0 1 3.5 12V4A1.5 1.5 0 0 1 5 2.5Z"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M6.2 1.5h3.6c.39 0 .7.31.7.7v1.1H5.5V2.2c0-.39.31-.7.7-.7Z"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}

          {result.details.length > 0 ? (
            <section className={styles.detailCard}>
              {result.presentation.detailLabel ? (
                <p className={styles.detailCardTitle}>{result.presentation.detailLabel}</p>
              ) : null}
              <ul className={styles.panelDetailList}>
                {result.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isAssistantResult(
  value: AssistantResult | { error?: unknown },
): value is AssistantResult {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "status" in value &&
    "title" in value &&
    "answer" in value &&
    "details" in value &&
    Array.isArray(value.details) &&
    "sources" in value &&
    Array.isArray(value.sources) &&
    "presentation" in value &&
    Boolean(value.presentation)
  );
}

function readErrorMessage(value: AssistantResult | { error?: unknown }) {
  if (value && typeof value === "object" && "error" in value) {
    return typeof value.error === "string" ? value.error : null;
  }

  return null;
}

function shouldRenderMetaHeader(result: AssistantResult) {
  return (
    result.presentation.mode === "ambiguity_prompt" ||
    result.presentation.mode === "not_found" ||
    result.presentation.mode === "unsupported"
  );
}

function labelForPresentationMode(mode: AssistantResult["presentation"]["mode"]) {
  switch (mode) {
    case "ambiguity_prompt":
      return "Need more detail";
    case "not_found":
      return "Not found";
    case "unsupported":
      return "Unsupported";
    case "summary_answer":
      return "Summary";
    default:
      return "Answer";
  }
}

async function copyTextValue(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return fallbackCopyTextValue(value);
    }
  }

  return fallbackCopyTextValue(value);
}

function fallbackCopyTextValue(value: string) {
  if (typeof document === "undefined") {
    return false;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "absolute";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(input);
  }
}
