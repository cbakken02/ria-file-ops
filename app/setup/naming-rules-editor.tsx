"use client";

import { useMemo, useState } from "react";
import {
  getAvailableTokensForDocumentType,
  getNamingDocumentTypeOptions,
  getNamingRuleDefinition,
  getNamingRuleExample,
  getRulePatternSummary,
  isRuleUsingRecommendedDefault,
  NAMING_TOKEN_DEFINITIONS,
  type NamingRuleDocumentType,
  type NamingTokenId,
  type NamingRulesConfig,
} from "@/lib/naming-rules";
import styles from "./naming-rules-editor.module.css";

type NamingRulesEditorProps = {
  onChange: (value: NamingRulesConfig) => void;
  value: NamingRulesConfig;
};

type DraggingItem = {
  source: "available" | "builder";
  tokenId: NamingTokenId;
};

export function NamingRulesEditor({
  onChange,
  value,
}: NamingRulesEditorProps) {
  const [editingRule, setEditingRule] = useState<NamingRuleDocumentType | null>(null);
  const [draftTokens, setDraftTokens] = useState<NamingTokenId[]>([]);
  const [draggingItem, setDraggingItem] = useState<DraggingItem | null>(null);

  const rows = useMemo(
    () =>
      getNamingDocumentTypeOptions().map((option) => ({
        documentType: option.id,
        example: getNamingRuleExample(value, option.id),
        label: option.label,
        pattern: getRulePatternSummary(value.rules[option.id]),
        usesDefault: isRuleUsingRecommendedDefault(value, option.id),
      })),
    [value],
  );

  const activeDefinition = editingRule
    ? getNamingRuleDefinition(editingRule)
    : null;
  const availableTokens = editingRule
    ? getAvailableTokensForDocumentType(editingRule)
    : [];
  const matchesRecommended = activeDefinition
    ? draftTokens.join("|") === activeDefinition.defaultTokens.join("|")
    : false;
  const hasUnsavedChanges =
    editingRule !== null &&
    draftTokens.join("|") !== value.rules[editingRule].join("|");
  const selectedTokenDefinitions = draftTokens
    .map((tokenId) =>
      NAMING_TOKEN_DEFINITIONS.find((definition) => definition.id === tokenId),
    )
    .filter((value): value is (typeof NAMING_TOKEN_DEFINITIONS)[number] => Boolean(value));

  function updateRule(nextTokens: NamingTokenId[]) {
    if (!editingRule) {
      return;
    }

    const safeTokens = nextTokens.length
      ? nextTokens
      : [...getNamingRuleDefinition(editingRule).defaultTokens];
    setDraftTokens(safeTokens);
  }

  function clearDraggingItem() {
    setDraggingItem(null);
  }

  function placeTokenAtIndex(tokenId: NamingTokenId, targetIndex: number) {
    if (!editingRule) {
      return;
    }

    setDraftTokens((current) => {
      const clampedTarget = Math.max(0, Math.min(targetIndex, current.length));
      const currentIndex = current.indexOf(tokenId);
      const nextTokens = [...current];

      if (currentIndex !== -1) {
        nextTokens.splice(currentIndex, 1);
        const adjustedIndex =
          currentIndex < clampedTarget ? clampedTarget - 1 : clampedTarget;

        if (adjustedIndex === currentIndex) {
          return current;
        }

        nextTokens.splice(adjustedIndex, 0, tokenId);
        return nextTokens;
      }

      nextTokens.splice(clampedTarget, 0, tokenId);
      return nextTokens;
    });
  }

  function removeTokenFromRule(tokenId: NamingTokenId) {
    updateRule(draftTokens.filter((draftToken) => draftToken !== tokenId));
  }

  function saveDraftRule() {
    if (!editingRule) {
      return;
    }

    onChange({
      ...value,
      rules: {
        ...value.rules,
        [editingRule]: draftTokens,
      },
    });
    setEditingRule(null);
  }

  return (
    <section className={styles.section}>
      <div className={styles.ruleList}>
        {rows.map((row) => (
          <button
            key={row.documentType}
            className={styles.ruleRow}
            onClick={() => {
              setDraftTokens(value.rules[row.documentType]);
              setEditingRule(row.documentType);
            }}
            type="button"
          >
            <span className={styles.ruleLabel}>{row.label}</span>
            <span className={styles.ruleMeta}>
              <span className={styles.pattern}>{row.pattern}</span>
              <span className={styles.example}>{row.example}</span>
            </span>
            <span className={styles.ruleStatus}>
                <span
                  className={
                    row.usesDefault ? styles.defaultBadge : styles.customBadge
                  }
                >
                  {row.usesDefault ? "Recommended" : "Custom"}
                </span>
            </span>
            <span className={styles.ruleChevron}>›</span>
          </button>
        ))}
      </div>

      {editingRule && activeDefinition ? (
        <div
          className={styles.modalOverlay}
          role="presentation"
        >
          <div
            className={styles.modal}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.modalEyebrow}>Naming convention</p>
                <h3>{activeDefinition.label}</h3>
              </div>
            </div>

            <section className={styles.modalBlock}>
              <div className={styles.blockHeader}>
                <strong>Filename builder</strong>
                <button
                  className={
                    matchesRecommended
                      ? styles.recommendButtonActive
                      : styles.recommendButton
                  }
                  onClick={() =>
                    updateRule([...activeDefinition.defaultTokens])
                  }
                  type="button"
                >
                  {matchesRecommended ? "Recommended" : "Use recommended"}
                </button>
              </div>

              <div className={styles.builderHint}>
                Drag fields in, out, and across. The filename reads left to right. Client 2 fields only appear when a second owner is identified.
              </div>
              <div
                className={
                  draggingItem?.source === "available"
                    ? `${styles.builderRow} ${styles.builderRowDropActive}`
                    : styles.builderRow
                }
                onDragOver={(event) => {
                  if (!draggingItem) {
                    return;
                  }

                  if (event.target !== event.currentTarget) {
                    return;
                  }

                  event.preventDefault();
                  placeTokenAtIndex(draggingItem.tokenId, draftTokens.length);
                }}
                onDrop={(event) => {
                  if (event.target !== event.currentTarget) {
                    return;
                  }

                  event.preventDefault();
                  clearDraggingItem();
                }}
              >
                {selectedTokenDefinitions.map((token, index) => (
                  <div key={`${token.id}-${index}`} className={styles.builderTokenWrap}>
                    <div
                      className={
                        draggingItem?.tokenId === token.id &&
                        draggingItem.source === "builder"
                          ? styles.builderTokenDragging
                          : styles.builderToken
                      }
                      draggable
                      onDragEnd={clearDraggingItem}
                      onDragOver={(event) => {
                        if (!draggingItem) {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        placeTokenAtIndex(draggingItem.tokenId, index);
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", token.id);
                        setDraggingItem({
                          source: "builder",
                          tokenId: token.id,
                        });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        clearDraggingItem();
                      }}
                    >
                      <span className={styles.builderTokenLabel}>{token.shortLabel}</span>
                      <span
                        className={styles.dragHandle}
                        aria-label={`Drag ${token.label}`}
                        role="button"
                        tabIndex={-1}
                      >
                        <span className={styles.dragDot} aria-hidden="true" />
                        <span className={styles.dragDot} aria-hidden="true" />
                        <span className={styles.dragDot} aria-hidden="true" />
                        <span className={styles.dragDot} aria-hidden="true" />
                        <span className={styles.dragDot} aria-hidden="true" />
                        <span className={styles.dragDot} aria-hidden="true" />
                      </span>
                      <button
                        className={styles.removeGlyph}
                        aria-label={`Remove ${token.label}`}
                        onClick={() => removeTokenFromRule(token.id)}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                    {index < selectedTokenDefinitions.length - 1 ? (
                      <span className={styles.builderSeparator} aria-hidden="true">
                        _
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.modalBlock}>
              <strong>Available fields</strong>
              <div
                className={
                  draggingItem?.source === "builder"
                    ? `${styles.availableTokenGrid} ${styles.availableTokenGridDropActive}`
                    : styles.availableTokenGrid
                }
                onDragOver={(event) => {
                  if (draggingItem?.source !== "builder") {
                    return;
                  }

                  event.preventDefault();
                }}
                onDrop={(event) => {
                  if (draggingItem?.source !== "builder") {
                    return;
                  }

                  event.preventDefault();
                  removeTokenFromRule(draggingItem.tokenId);
                  clearDraggingItem();
                }}
              >
                {availableTokens.map((token) => {
                  const alreadyIncluded = draftTokens.includes(token.id);

                  return (
                    <button
                      key={token.id}
                      draggable={!alreadyIncluded}
                      className={
                        alreadyIncluded
                          ? styles.availableTokenDisabled
                          : styles.availableToken
                      }
                      disabled={alreadyIncluded}
                      onDragEnd={clearDraggingItem}
                      onDragStart={(event) => {
                        if (alreadyIncluded) {
                          return;
                        }

                        event.dataTransfer.effectAllowed = "copyMove";
                        event.dataTransfer.setData("text/plain", token.id);
                        setDraggingItem({
                          source: "available",
                          tokenId: token.id,
                        });
                      }}
                      onClick={() => updateRule([...draftTokens, token.id])}
                      type="button"
                    >
                      {token.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={styles.modalBlock}>
              <strong>Live example</strong>
              <p className={styles.examplePreview}>
                {getNamingRuleExample(
                  {
                    ...value,
                    rules: {
                      ...value.rules,
                      [editingRule]: draftTokens,
                    },
                  },
                  editingRule,
                )}
              </p>
            </section>

            <div className={styles.modalActions}>
              <button
                className={
                  hasUnsavedChanges ? styles.primaryButton : styles.secondaryButton
                }
                onClick={() => setEditingRule(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className={
                  hasUnsavedChanges ? styles.secondaryButton : styles.primaryButton
                }
                onClick={saveDraftRule}
                type="button"
              >
                Save rule
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
