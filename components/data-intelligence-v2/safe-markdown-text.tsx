import type { ReactNode } from "react";
import styles from "../data-intelligence-chat.module.css";

type SafeMarkdownTextProps = {
  className?: string;
  text: string;
};

type MarkdownBlock =
  | {
      level: 1 | 2 | 3;
      text: string;
      type: "heading";
    }
  | {
      lines: string[];
      type: "paragraph";
    }
  | {
      items: string[];
      type: "ordered-list";
    }
  | {
      items: string[];
      type: "unordered-list";
    };

export function SafeMarkdownText({ className, text }: SafeMarkdownTextProps) {
  const classNames = [styles.safeMarkdown, className].filter(Boolean).join(" ");
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className={classNames}>
      {blocks.map((block, blockIndex) => {
        if (block.type === "unordered-list") {
          return (
            <ul key={`ul-${blockIndex}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`ul-${blockIndex}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `ul-${blockIndex}-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered-list") {
          return (
            <ol key={`ol-${blockIndex}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`ol-${blockIndex}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `ol-${blockIndex}-${itemIndex}`)}
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === "heading") {
          const headingContent = renderInlineMarkdown(
            block.text,
            `heading-${blockIndex}`,
          );

          if (block.level === 1) {
            return <h2 key={`h-${blockIndex}`}>{headingContent}</h2>;
          }
          if (block.level === 2) {
            return <h3 key={`h-${blockIndex}`}>{headingContent}</h3>;
          }
          return <h4 key={`h-${blockIndex}`}>{headingContent}</h4>;
        }

        return (
          <p key={`p-${blockIndex}`}>
            {renderParagraphLines(block.lines, `p-${blockIndex}`)}
          </p>
        );
      })}
    </div>
  );
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    if (lines[index].trim() === "") {
      index += 1;
      continue;
    }

    const headingMatch = lines[index].match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
        type: "heading",
      });
      index += 1;
      continue;
    }

    const unorderedItems: string[] = [];
    while (index < lines.length) {
      const match = lines[index].match(/^\s*[-*]\s+(.+)$/);
      if (!match) {
        break;
      }
      unorderedItems.push(match[1]);
      index += 1;
    }
    if (unorderedItems.length > 0) {
      blocks.push({ items: unorderedItems, type: "unordered-list" });
      continue;
    }

    const orderedItems: string[] = [];
    while (index < lines.length) {
      const match = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
      if (!match) {
        break;
      }
      orderedItems.push(match[1]);
      index += 1;
    }
    if (orderedItems.length > 0) {
      blocks.push({ items: orderedItems, type: "ordered-list" });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+[.)]\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push({ lines: paragraphLines, type: "paragraph" });
  }

  return blocks;
}

function renderParagraphLines(lines: string[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      nodes.push(<br key={`${keyPrefix}-br-${lineIndex}`} />);
    }
    nodes.push(...renderInlineMarkdown(line, `${keyPrefix}-line-${lineIndex}`));
  });

  return nodes;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    if (text.startsWith("`", cursor)) {
      const end = text.indexOf("`", cursor + 1);
      if (end > cursor + 1) {
        nodes.push(
          <code key={`${keyPrefix}-code-${cursor}`}>
            {text.slice(cursor + 1, end)}
          </code>,
        );
        cursor = end + 1;
        continue;
      }
    }

    if (text.startsWith("**", cursor)) {
      const end = text.indexOf("**", cursor + 2);
      if (end > cursor + 2) {
        nodes.push(
          <strong key={`${keyPrefix}-strong-${cursor}`}>
            {renderInlineMarkdown(
              text.slice(cursor + 2, end),
              `${keyPrefix}-strong-${cursor}`,
            )}
          </strong>,
        );
        cursor = end + 2;
        continue;
      }
    }

    const emphasisMarker = getEmphasisMarker(text, cursor);
    if (emphasisMarker) {
      const end = text.indexOf(emphasisMarker, cursor + 1);
      if (end > cursor + 1) {
        nodes.push(
          <em key={`${keyPrefix}-em-${cursor}`}>
            {renderInlineMarkdown(
              text.slice(cursor + 1, end),
              `${keyPrefix}-em-${cursor}`,
            )}
          </em>,
        );
        cursor = end + 1;
        continue;
      }
    }

    const nextMarker = findNextInlineMarker(text, cursor + 1);
    const end = nextMarker === -1 ? text.length : nextMarker;
    nodes.push(text.slice(cursor, end));
    cursor = end;
  }

  return nodes;
}

function getEmphasisMarker(text: string, index: number): "*" | "_" | null {
  const marker = text[index];
  if (marker !== "*" && marker !== "_") {
    return null;
  }
  if (text[index + 1] === marker || /\s/.test(text[index + 1] ?? "")) {
    return null;
  }
  return marker;
}

function findNextInlineMarker(text: string, fromIndex: number) {
  const candidates = ["`", "**", "*", "_"]
    .map((marker) => text.indexOf(marker, fromIndex))
    .filter((index) => index !== -1);

  return candidates.length > 0 ? Math.min(...candidates) : -1;
}
