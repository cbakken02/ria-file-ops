import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getDataIntelligenceV2Config,
} from "../../lib/data-intelligence-v2/config.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../..");

const FILES = {
  page: path.join(REPO_ROOT, "app/data-intelligence/page.tsx"),
  copilot: path.join(
    REPO_ROOT,
    "components/data-intelligence-v2/copilot-chat.tsx",
  ),
  assistantView: path.join(
    REPO_ROOT,
    "components/data-intelligence-v2/assistant-response-view.tsx",
  ),
  revealCard: path.join(
    REPO_ROOT,
    "components/data-intelligence-v2/secure-reveal-card.tsx",
  ),
  sourceChip: path.join(
    REPO_ROOT,
    "components/data-intelligence-v2/source-chip.tsx",
  ),
  safeMarkdown: path.join(
    REPO_ROOT,
    "components/data-intelligence-v2/safe-markdown-text.tsx",
  ),
  draftNote: path.join(
    REPO_ROOT,
    "components/data-intelligence-v2/draft-note-card.tsx",
  ),
};

test("page keeps V1 default and gates V2 rendering behind all V2 flags", async () => {
  const source = await readFile(FILES.page, "utf8");

  assert.match(source, /getDataIntelligenceV2Config/);
  assert.match(source, /DataIntelligenceChat/);
  assert.match(source, /DataIntelligenceV2CopilotChat/);
  assert.match(source, /v2Config\.enabled && v2Config\.chatApiEnabled && v2Config\.uiEnabled/);
  assert.match(source, /useV2 \? <DataIntelligenceV2CopilotChat \/> : <DataIntelligenceChat \/>/);
});

test("V2 copilot posts only to the V2 chat endpoint and avoids client persistence", async () => {
  const source = await readFile(FILES.copilot, "utf8");

  assert.match(source, /"use client"/);
  assert.match(source, /\/api\/data-intelligence\/v2\/chat/);
  assert.match(source, /buildV2ChatApiRequestBody/);
  assert.equal(source.includes("/api/query-assistant"), false);
  assert.equal(/openai/i.test(source), false);
  assert.equal(/localStorage|sessionStorage/.test(source), false);
});

test("secure reveal card uses only the reveal endpoint and keeps values local", async () => {
  const source = await readFile(FILES.revealCard, "utf8");

  assert.match(source, /\/api\/data-intelligence\/v2\/reveal/);
  assert.equal(source.includes("/api/data-intelligence/v2/chat"), false);
  assert.equal(/localStorage|sessionStorage/.test(source), false);
  assert.match(source, /setRevealedValue\(null\)/);
  assert.equal(/clipboard|writeText|copy/i.test(source), false);
  assert.equal(/console\./.test(source), false);
});

test("new V2 UI components do not use dangerous HTML rendering", async () => {
  const sources = await Promise.all(
    Object.values(FILES).map((file) => readFile(file, "utf8")),
  );

  for (const source of sources) {
    assert.equal(source.includes("dangerouslySetInnerHTML"), false);
    assert.equal(source.includes("innerHTML"), false);
    assert.equal(source.includes("DOMParser"), false);
  }
});

test("V2 assistant markdown uses the safe markdown renderer", async () => {
  const [assistantSource, draftNoteSource, markdownSource] = await Promise.all([
    readFile(FILES.assistantView, "utf8"),
    readFile(FILES.draftNote, "utf8"),
    readFile(FILES.safeMarkdown, "utf8"),
  ]);

  assert.match(assistantSource, /SafeMarkdownText/);
  assert.match(assistantSource, /text=\{response\.answerMarkdown\}/);
  assert.doesNotMatch(assistantSource, /\{response\.answerMarkdown\}\s*<\/p>/);

  assert.match(draftNoteSource, /SafeMarkdownText/);
  assert.match(draftNoteSource, /text=\{draftNote\.bodyMarkdown\}/);
  assert.doesNotMatch(draftNoteSource, /\{draftNote\.bodyMarkdown\}\s*<\/p>/);

  assert.match(markdownSource, /export function SafeMarkdownText/);
  assert.match(markdownSource, /<strong/);
  assert.match(markdownSource, /<em/);
  assert.match(markdownSource, /<code/);
  assert.match(markdownSource, /<h2/);
  assert.match(markdownSource, /<h3/);
  assert.match(markdownSource, /<h4/);
  assert.match(markdownSource, /<ul/);
  assert.match(markdownSource, /<ol/);
  assert.equal(markdownSource.includes("<a "), false);
  assert.equal(markdownSource.includes("href="), false);
});

test("safe markdown renderer supports line-start headings", async () => {
  const source = await readFile(FILES.safeMarkdown, "utf8");

  assert.match(source, /type: "heading"/);
  assert.match(source, /level: 1 \| 2 \| 3/);
  assert.equal(
    source.includes("lines[index].match(/^(#{1,3})\\s+(.+)$/)"),
    true,
  );
  assert.match(source, /block\.level === 1/);
  assert.match(source, /block\.level === 2/);
  assert.match(source, /<h2/);
  assert.match(source, /<h3/);
  assert.match(source, /<h4/);
  assert.match(source, /renderInlineMarkdown\(\s*block\.text/);
});

test("safe markdown renderer keeps raw HTML on the text-node path", async () => {
  const source = await readFile(FILES.safeMarkdown, "utf8");

  assert.equal(source.includes("dangerouslySetInnerHTML"), false);
  assert.equal(source.includes("createElement"), false);
  assert.equal(source.includes("DOMParser"), false);
  assert.equal(source.includes("<script"), false);
  assert.match(source, /nodes\.push\(text\.slice\(cursor, end\)\)/);
});

test("V2 UI config flag is exact-match opt-in only", () => {
  assert.equal(getDataIntelligenceV2Config({}).uiEnabled, false);
  assert.equal(
    getDataIntelligenceV2Config({
      DATA_INTELLIGENCE_V2_UI_ENABLED: "true",
    }).uiEnabled,
    true,
  );

  for (const value of ["TRUE", "1", "yes", "false"]) {
    assert.equal(
      getDataIntelligenceV2Config({
        DATA_INTELLIGENCE_V2_UI_ENABLED: value,
      }).uiEnabled,
      false,
    );
  }
});
