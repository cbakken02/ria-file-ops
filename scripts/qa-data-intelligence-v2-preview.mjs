#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 30000;
const SAFE_QA_MESSAGE = "Preview QA smoke check. Do not use client data.";
const DEFAULT_QA_SECRET_ENV_NAME = "DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET";
const DEFAULT_QA_ENDPOINT_PATH = "/api/data-intelligence/v2/qa/preview-smoke";

const VERCEL_BYPASS_ENV_NAMES = [
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_PROTECTION_BYPASS_SECRET",
  "VERCEL_BYPASS_TOKEN",
];

const APP_AUTH_ENV_NAMES = [
  "PLAYWRIGHT_AUTH_STORAGE",
  "E2E_AUTH_STORAGE",
  "TEST_USER_EMAIL",
  "TEST_USER_PASSWORD",
  "NEXTAUTH_TEST_SESSION_TOKEN",
];

export async function runPreviewQa(options = {}) {
  const url = normalizePreviewUrl(options.url);
  const withVercelBypass = options.withVercelBypass === true;
  const requireAppAuth = options.requireAppAuth === true;
  const skipChatIfUnauthenticated = options.skipChatIfUnauthenticated !== false;
  const runPreviewQaEndpoint = options.runPreviewQaEndpoint === true;
  const qaSecretEnvName = options.qaSecretEnvName ?? DEFAULT_QA_SECRET_ENV_NAME;
  const qaEndpointPath = options.qaEndpoint ?? DEFAULT_QA_ENDPOINT_PATH;
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const env = options.env ?? process.env;
  const blockers = [];
  const failures = [];
  const warnings = [];

  const capabilities = detectAutomationCapabilities({ env });
  const bypassSecret = withVercelBypass
    ? readFirstPresentEnv(env, VERCEL_BYPASS_ENV_NAMES)
    : null;
  const qaSecret = runPreviewQaEndpoint ? readFirstPresentEnv(env, [qaSecretEnvName]) : null;

  if (withVercelBypass && !bypassSecret) {
    blockers.push("missing_vercel_bypass_secret");
  }
  if (runPreviewQaEndpoint && !qaSecret) {
    blockers.push("missing_preview_qa_secret");
  }

  const summary = {
    targetUrl: url,
    branch: options.branch ?? "codex/fix-supabase-migration-history",
    hasVercelBypassSecret: capabilities.hasVercelBypassSecret,
    hasAppAuthAutomation: capabilities.hasAppAuthAutomation,
    hasBrowserE2EHarness: capabilities.hasBrowserE2EHarness,
    hasPreviewSmokeHarness: capabilities.hasPreviewSmokeHarness,
    hasPreviewQaSecret: Boolean(qaSecret),
    requestedVercelBypass: withVercelBypass,
    requestedPreviewQaEndpoint: runPreviewQaEndpoint,
    deploymentProtectionActive: false,
    deploymentProtectionBypassed: false,
    appAuthRequired: false,
    blockedByAppAuth: false,
    manualAuthenticatedQaRequired: false,
    authenticatedChatTestRun: false,
    authenticatedRevealTestRun: false,
    anonymousChatProtected: null,
    anonymousRevealProtected: null,
    dataIntelligenceReachableBeyondDeploymentProtection: false,
    routeChecks: {},
    previewQaEndpoint: {
      attempted: false,
      status: null,
      passed: null,
      blockedByDeploymentProtection: null,
      safeBody: null,
      resultStatus: null,
      summary: null,
    },
    htmlChecks: {
      checked: false,
      safe: null,
      reason: null,
    },
    checks: [],
    blockers,
    failures,
    warnings,
    safety: {
      noDeploy: true,
      noEnvMutation: true,
      noSupabaseMutation: true,
      noSecretsPrinted: true,
      noRawSensitiveValuesPrinted: true,
      noTranscriptsStored: true,
    },
    exitCode: 0,
  };

  if (blockers.length > 0) {
    summary.exitCode = 2;
    return summary;
  }

  const headers = withVercelBypass
    ? {
        "x-vercel-protection-bypass": bypassSecret,
      }
    : {};

  const root = await safeFetch(`${url}/`, {
    headers,
    timeoutMs,
  });
  const dataPage = await safeFetch(`${url}/data-intelligence`, {
    headers,
    timeoutMs,
  });
  summary.checks.push(summarizeHttpCheck("root", root));
  summary.checks.push(summarizeHttpCheck("data_intelligence_page", dataPage));

  const rootProtected = isVercelProtectionResponse(root);
  const dataProtected = isVercelProtectionResponse(dataPage);
  summary.deploymentProtectionActive = rootProtected || dataProtected;

  if (runPreviewQaEndpoint) {
    const qaEndpoint = await safeFetch(`${url}${normalizePath(qaEndpointPath)}`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "x-data-intelligence-v2-qa-secret": qaSecret,
      },
      body: JSON.stringify({ useRealOpenAi: false }),
      timeoutMs,
    });
    summary.checks.push(summarizeHttpCheck("preview_qa_endpoint", qaEndpoint));
    summary.previewQaEndpoint = summarizePreviewQaEndpoint(qaEndpoint);
    if (summary.previewQaEndpoint.blockedByDeploymentProtection) {
      blockers.push("preview_qa_endpoint_blocked_by_deployment_protection");
    } else if (summary.previewQaEndpoint.passed === false) {
      failures.push("preview_qa_endpoint_failed");
    }
  }

  if (!withVercelBypass) {
    if (summary.deploymentProtectionActive) {
      summary.warnings.push("deployment_protection_blocks_deeper_qa_without_bypass");
    } else {
      summary.warnings.push("deployment_protection_not_detected_without_bypass");
    }
    summary.manualAuthenticatedQaRequired = true;
    return finalizeSummary(summary);
  }

  summary.deploymentProtectionBypassed = !rootProtected && !dataProtected;
  if (!summary.deploymentProtectionBypassed) {
    blockers.push("deployment_protection_not_bypassed");
    summary.manualAuthenticatedQaRequired = true;
    return finalizeSummary(summary);
  }

  summary.appAuthRequired = isAppAuthRequired(dataPage);
  summary.blockedByAppAuth = summary.appAuthRequired;
  summary.dataIntelligenceReachableBeyondDeploymentProtection = !dataProtected;

  if (dataPage.status === 200 && isHtmlResponse(dataPage)) {
    summary.htmlChecks.checked = true;
    const unsafe = containsUnsafePreviewOutput(dataPage.body);
    summary.htmlChecks.safe = !unsafe;
    summary.htmlChecks.reason = unsafe ? "unsafe_pattern_detected" : "no_unsafe_patterns_detected";
    if (unsafe) {
      failures.push("data_intelligence_html_contains_unsafe_pattern");
    }
  } else {
    summary.htmlChecks.checked = false;
    summary.htmlChecks.safe = null;
    summary.htmlChecks.reason = summary.appAuthRequired
      ? "blocked_by_app_auth"
      : `status_${dataPage.status}`;
  }

  const chat = await safeFetch(`${url}/api/data-intelligence/v2/chat`, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: SAFE_QA_MESSAGE,
      conversationState: {},
    }),
    timeoutMs,
  });
  summary.checks.push(summarizeHttpCheck("chat_api_anonymous_post", chat));
  summary.routeChecks.chat = classifyAnonymousApiResponse(chat, {
    routeName: "chat",
  });
  summary.anonymousChatProtected = summary.routeChecks.chat.anonymousProtected;
  if (summary.routeChecks.chat.failure) {
    failures.push(summary.routeChecks.chat.failure);
  }

  const reveal = await safeFetch(`${url}/api/data-intelligence/v2/reveal`, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      revealCardId: "preview_qa_fake_reveal_card_id",
      purpose: "Preview QA route protection check",
    }),
    timeoutMs,
  });
  summary.checks.push(summarizeHttpCheck("reveal_api_anonymous_post", reveal));
  summary.routeChecks.reveal = classifyAnonymousApiResponse(reveal, {
    routeName: "reveal",
    allowNotFoundAsSafeRejection: true,
  });
  summary.anonymousRevealProtected = summary.routeChecks.reveal.anonymousProtected;
  if (summary.routeChecks.reveal.failure) {
    failures.push(summary.routeChecks.reveal.failure);
  }

  if (summary.appAuthRequired && skipChatIfUnauthenticated) {
    summary.manualAuthenticatedQaRequired = true;
  }
  if (requireAppAuth && !capabilities.hasAppAuthAutomation) {
    blockers.push("missing_app_auth_automation");
  }

  return finalizeSummary(summary);
}

export function detectAutomationCapabilities({ env = process.env } = {}) {
  return {
    hasVercelBypassSecret: Boolean(readFirstPresentEnv(env, VERCEL_BYPASS_ENV_NAMES)),
    hasAppAuthAutomation: detectAppAuthAutomation(env),
    hasBrowserE2EHarness: detectBrowserE2EHarness(),
    hasPreviewSmokeHarness: existsSync(path.resolve("scripts/qa-data-intelligence-v2-preview.mjs")),
  };
}

export function classifyAnonymousApiResponse(response, options = {}) {
  const status = response.status;
  const routeName = options.routeName ?? "api";
  const routeExistsLikely = status !== 404 || options.allowNotFoundAsSafeRejection === true;
  const anonymousAccepted = status >= 200 && status < 300;
  const authBlocked = status === 401 || status === 403;
  const safeRejection =
    authBlocked ||
    status === 400 ||
    status === 405 ||
    (status === 404 && options.allowNotFoundAsSafeRejection === true);

  return {
    status,
    routeExistsLikely,
    appAuthRequired: authBlocked,
    anonymousProtected: !anonymousAccepted && safeRejection,
    anonymousAccepted,
    failure: anonymousAccepted
      ? `anonymous_${routeName}_accepted`
      : routeExistsLikely
        ? null
        : `${routeName}_route_missing`,
  };
}

export function isVercelProtectionResponse(response) {
  if (!response) {
    return false;
  }
  return (
    response.status === 401 &&
    /Vercel Authentication|Deployment Protection|Authentication Required/i.test(
      response.body ?? "",
    )
  );
}

export function isAppAuthRequired(response) {
  if (!response || isVercelProtectionResponse(response)) {
    return false;
  }
  if (response.status === 401 || response.status === 403) {
    return true;
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    return /login|signin|api\/auth/i.test(response.location ?? "");
  }
  if (response.status === 200 && isHtmlResponse(response)) {
    return /sign in|log in|login|nextauth/i.test(response.body ?? "");
  }
  return false;
}

export function containsUnsafePreviewOutput(source) {
  const text = String(source ?? "");
  return (
    /\b\d{3}-\d{2}-\d{4}\b/.test(text) ||
    /\b\d{13,19}\b/.test(text) ||
    /\bsk-[A-Za-z0-9_-]{12,}\b/.test(text) ||
    /postgres(?:ql)?:\/\/[^"\s]+/i.test(text) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)
  );
}

export function redactSensitiveText(value) {
  return String(value ?? "")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted-secret]")
    .replace(/postgres(?:ql)?:\/\/[^"\s]+/gi, "[redacted-db-url]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted-token]")
    .replace(/x-vercel-protection-bypass[^\n]*/gi, "x-vercel-protection-bypass: [redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted-token]");
}

async function safeFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: options.body,
      redirect: "manual",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const location = response.headers.get("location") ?? "";
    const body = await readBoundedBody(response, 200000);
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      location: sanitizeLocation(location),
      body,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      location: "",
      body: "",
      error: redactSensitiveText(error?.message ?? "request_failed"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(response, maxChars) {
  const text = await response.text();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function summarizeHttpCheck(name, response) {
  return {
    name,
    status: response.status,
    contentType: response.contentType,
    bodyBytes: Buffer.byteLength(response.body ?? ""),
    hasVercelProtection: isVercelProtectionResponse(response),
    appAuthRequired: isAppAuthRequired(response),
    safeBody: !containsUnsafePreviewOutput(response.body),
    error: response.error ? redactSensitiveText(response.error) : null,
  };
}

function summarizePreviewQaEndpoint(response) {
  const blockedByDeploymentProtection = isVercelProtectionResponse(response);
  const safeBody = !containsUnsafePreviewOutput(response.body);
  let resultStatus = null;
  let responseSummary = null;
  let passed = null;

  if (!blockedByDeploymentProtection && safeBody && response.body) {
    try {
      const parsed = JSON.parse(response.body);
      resultStatus = typeof parsed.status === "string" ? parsed.status : null;
      if (parsed.summary && typeof parsed.summary === "object") {
        responseSummary = {
          v2ChatTurnRan: parsed.summary.v2ChatTurnRan === true,
          secureRevealCardCreated: parsed.summary.secureRevealCardCreated === true,
          revealSucceededWithoutReturningValue:
            parsed.summary.revealSucceededWithoutReturningValue === true,
          auditEventsAttempted: parsed.summary.auditEventsAttempted === true,
          noRawSensitiveValuesReturned:
            parsed.summary.noRawSensitiveValuesReturned === true,
          usedFakeDataOnly: parsed.summary.usedFakeDataOnly === true,
        };
      }
      passed =
        response.status === 200 &&
        resultStatus === "passed" &&
        responseSummary?.noRawSensitiveValuesReturned === true;
    } catch {
      passed = false;
    }
  } else if (blockedByDeploymentProtection) {
    passed = null;
  } else {
    passed = false;
  }

  return {
    attempted: true,
    status: response.status,
    passed,
    blockedByDeploymentProtection,
    safeBody,
    resultStatus,
    summary: responseSummary,
  };
}

function finalizeSummary(summary) {
  if (summary.failures.length > 0) {
    summary.exitCode = 1;
  } else if (summary.blockers.length > 0) {
    summary.exitCode = 2;
  } else {
    summary.exitCode = 0;
  }
  return summary;
}

function isHtmlResponse(response) {
  return /text\/html/i.test(response.contentType ?? "");
}

function normalizePreviewUrl(url) {
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("A --url value is required.");
  }
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizePath(value) {
  const pathValue = typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_QA_ENDPOINT_PATH;
  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

function sanitizeLocation(location) {
  if (!location) {
    return "";
  }
  try {
    const parsed = new URL(location, "https://preview.local");
    return parsed.pathname;
  } catch {
    return "";
  }
}

function readFirstPresentEnv(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function detectAppAuthAutomation(env) {
  if (readFirstPresentEnv(env, APP_AUTH_ENV_NAMES)) {
    return true;
  }
  for (const name of ["PLAYWRIGHT_AUTH_STORAGE", "E2E_AUTH_STORAGE"]) {
    const value = env[name];
    if (typeof value === "string" && existsSync(path.resolve(value))) {
      return true;
    }
  }
  return false;
}

function detectBrowserE2EHarness() {
  const candidates = [
    "playwright.config.ts",
    "playwright.config.js",
    "e2e",
    "tests/e2e",
  ];
  if (candidates.some((candidate) => existsSync(path.resolve(candidate)))) {
    return true;
  }
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@playwright/test/package.json", {
      paths: [process.cwd()],
    });
    return Boolean(pkgPath);
  } catch {
    return false;
  }
}

function parseBooleanOption(value, defaultValue) {
  if (value == null) {
    return defaultValue;
  }
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return defaultValue;
}

function readOption(argv, name) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    url: readOption(argv, "--url"),
    withVercelBypass: argv.includes("--with-vercel-bypass"),
    qaEndpoint: readOption(argv, "--qa-endpoint"),
    qaSecretEnvName:
      readOption(argv, "--qa-secret-env") ?? DEFAULT_QA_SECRET_ENV_NAME,
    runPreviewQaEndpoint: argv.includes("--run-preview-qa-endpoint"),
    requireAppAuth: parseBooleanOption(readOption(argv, "--require-app-auth"), false),
    skipChatIfUnauthenticated: parseBooleanOption(
      readOption(argv, "--skip-chat-if-unauthenticated"),
      true,
    ),
    timeoutMs: Number(readOption(argv, "--timeout-ms")) || DEFAULT_TIMEOUT_MS,
  };
}

function printHumanSummary(summary) {
  console.log("Data Intelligence V2 Preview QA");
  console.log(`- URL: ${summary.targetUrl}`);
  console.log(`- Vercel bypass requested: ${summary.requestedVercelBypass}`);
  console.log(`- Preview QA endpoint requested: ${summary.requestedPreviewQaEndpoint}`);
  console.log(`- Deployment protection active: ${summary.deploymentProtectionActive}`);
  console.log(`- Deployment protection bypassed: ${summary.deploymentProtectionBypassed}`);
  console.log(`- App auth required: ${summary.appAuthRequired}`);
  console.log(`- Anonymous chat protected: ${summary.anonymousChatProtected}`);
  console.log(`- Anonymous reveal protected: ${summary.anonymousRevealProtected}`);
  console.log(`- Manual authenticated QA required: ${summary.manualAuthenticatedQaRequired}`);
  console.log(`- Preview QA endpoint passed: ${summary.previewQaEndpoint.passed}`);
  console.log(`- Failures: ${summary.failures.length}`);
  console.log(`- Blockers: ${summary.blockers.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const summary = await runPreviewQa(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      printHumanSummary(summary);
    }
    process.exit(summary.exitCode);
  } catch (error) {
    const message = redactSensitiveText(error?.message ?? "preview_qa_failed");
    const summary = {
      status: "error",
      message,
      safety: {
        noDeploy: true,
        noEnvMutation: true,
        noSupabaseMutation: true,
        noSecretsPrinted: true,
      },
      exitCode: 2,
    };
    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      console.error(message);
    }
    process.exit(2);
  }
}
