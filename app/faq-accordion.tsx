"use client";

import { useState } from "react";
import styles from "./page.module.css";

type FAQItem = {
  question: string;
  answer: string;
};

type FAQAccordionProps = {
  items: FAQItem[];
};

export function FAQAccordion({ items }: FAQAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const faqColumns = [0, 1].map((columnIndex) =>
    items
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => index % 2 === columnIndex),
  );

  return (
    <div className={styles.faqGrid}>
      {faqColumns.map((column, columnIndex) => (
        <div className={styles.faqColumn} key={`faq-column-${columnIndex}`}>
          {column.map(({ item, index }) => (
            <details
              className={styles.faqItem}
              key={item.question}
              name="operational-faq"
              onToggle={(event) => {
                if (event.currentTarget.open) {
                  setOpenIndex(index);
                  return;
                }

                setOpenIndex((currentIndex) =>
                  currentIndex === index ? null : currentIndex,
                );
              }}
              open={openIndex === index}
              style={{ order: index }}
            >
              <summary className={styles.faqQuestion}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.question}</strong>
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      ))}
    </div>
  );
}
