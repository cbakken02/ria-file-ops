"use client";

import { useEffect, useRef, useState } from "react";
import { AssistantResponseView } from "@/components/data-intelligence-v2/assistant-response-view";
import type { V2AssistantResponse } from "@/lib/data-intelligence-v2/assistant-response";
import {
  buildV2ChatApiRequestBody,
  createV2ClientMessageId,
  stripRevealedValuesFromClientMessage,
  type V2ClientChatMessage,
} from "@/lib/data-intelligence-v2/client-history";
import { sanitizeSafeConversationState } from "@/lib/data-intelligence-v2/conversation-state";
import { sanitizeTextForModel } from "@/lib/data-intelligence-v2/safe-memory";
import type { SafeConversationState } from "@/lib/data-intelligence-v2/types";
import styles from "../data-intelligence-chat.module.css";

type V2ChatApiSuccess = {
  status: "success" | "error";
  response: V2AssistantResponse;
  nextConversationState: SafeConversationState;
};

const EXAMPLE_PROMPTS = [
  "Check the latest statement for a client",
  "Prepare a transfer requirements checklist",
  "Find available tax documents for a client",
  "Create a secure reveal card for a form field",
] as const;

export function DataIntelligenceV2CopilotChat() {
  const [messages, setMessages] = useState<V2ClientChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationState, setConversationState] =
    useState<SafeConversationState>({});
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const hasMessages = messages.length > 0;
  const canSubmit = input.trim().length > 0 && !isLoading;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({
      behavior: hasMessages ? "smooth" : "auto",
      block: "end",
    });
  }, [hasMessages, isLoading, messages]);

  async function submitMessage(nextMessage?: string) {
    const activeMessage = (nextMessage ?? input).trim();
    if (!activeMessage || isLoading) {
      return;
    }

    const safeUserContent = sanitizeTextForModel(activeMessage);
    const userMessage: V2ClientChatMessage = {
      id: createV2ClientMessageId(),
      role: "user",
      content: safeUserContent,
      createdAt: new Date().toISOString(),
    };
    const requestBody = buildV2ChatApiRequestBody({
      message: activeMessage,
      messages,
      conversationState,
    });

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/data-intelligence/v2/chat", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok || !isChatApiSuccess(payload)) {
        throw new Error("The V2 copilot request failed.");
      }

      const assistantMessage = stripRevealedValuesFromClientMessage({
        id: createV2ClientMessageId(),
        role: "assistant",
        content: payload.response.answerMarkdown,
        createdAt: new Date().toISOString(),
        response: payload.response,
      });

      setMessages((current) => [...current, assistantMessage]);
      setConversationState(
        sanitizeSafeConversationState(payload.nextConversationState),
      );
    } catch {
      setError("The V2 copilot request failed.");
      setMessages((current) => [
        ...current,
        {
          id: createV2ClientMessageId(),
          role: "assistant",
          content: "The V2 copilot request failed.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }

  return (
    <section className={styles.workspace} aria-label="Data Intelligence V2 copilot">
      <div className={styles.transcript}>
        {!hasMessages ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateInner}>
              <h2>Data Intelligence Ops Copilot</h2>
              <p className={styles.emptyCopy}>
                Ask for source-backed client facts, workflow checks, and secure
                reveal cards.
              </p>

              <div className={styles.exampleGrid}>
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    className={styles.examplePrompt}
                    disabled={isLoading}
                    key={example}
                    onClick={() => setInput(example)}
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
                  <div className={styles.userBubble}>{message.content}</div>
                </div>
              ) : message.response ? (
                <AssistantResponseView
                  key={message.id}
                  onFollowupSuggestion={setInput}
                  response={message.response}
                />
              ) : (
                <article className={styles.errorCard} key={message.id}>
                  <p className={styles.statusBadge}>Request error</p>
                  <p className={styles.answer}>{message.content}</p>
                </article>
              ),
            )}

            {isLoading ? (
              <div className={styles.loadingRow}>
                <div className={styles.loadingCard}>
                  <span className={styles.loadingDot} />
                  <span>Running V2 tool plan...</span>
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
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitMessage();
              }
            }}
            placeholder="Ask the V2 copilot for source-backed client data or workflow help."
            rows={1}
            value={input}
          />
          <div className={styles.composerActions}>
            <p className={styles.composerHint}>
              Secure values appear only in reveal cards.
            </p>
            <button
              aria-label="Send V2 copilot message"
              className={styles.submitButton}
              disabled={!canSubmit}
              onClick={() => void submitMessage()}
              type="button"
            >
              <span aria-hidden="true" className={styles.submitIcon}>
                {isLoading ? "..." : "↑"}
              </span>
            </button>
          </div>
          {error ? <p className={styles.followUp}>{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

function isChatApiSuccess(value: unknown): value is V2ChatApiSuccess {
  return isRecord(value) && "response" in value && "nextConversationState" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
