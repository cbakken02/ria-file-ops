import { timingSafeEqual } from "node:crypto";
import {
  getDataIntelligenceV2Config,
} from "@/lib/data-intelligence-v2/config";
import {
  runPreviewV2SmokeQa,
} from "@/lib/data-intelligence-v2/preview-qa-service";

export const dynamic = "force-dynamic";

const PREVIEW_QA_NO_CACHE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: Request) {
  try {
    const config = getDataIntelligenceV2Config(process.env);

    if (process.env.VERCEL_ENV !== "preview" || !config.previewQaEnabled) {
      return safeJson({ error: "Not found." }, 404);
    }

    const expectedSecret = process.env.DATA_INTELLIGENCE_V2_PREVIEW_QA_SECRET;
    const suppliedSecret = request.headers.get(
      "x-data-intelligence-v2-qa-secret",
    );
    if (!isValidQaSecret(suppliedSecret, expectedSecret)) {
      return safeJson({ error: "Unauthorized." }, 401);
    }

    const body = await readOptionalJson(request);
    if (body === "invalid") {
      return safeJson({ error: "Invalid JSON body." }, 400);
    }

    const useRealOpenAi =
      isRecord(body) && body.useRealOpenAi === true;
    const result = await runPreviewV2SmokeQa({ useRealOpenAi });

    return safeJson(result, result.status === "passed" ? 200 : 503);
  } catch {
    return safeJson({ error: "Preview QA request failed." }, 500);
  }
}

function safeJson(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: PREVIEW_QA_NO_CACHE_HEADERS,
  });
}

async function readOptionalJson(request: Request) {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return "invalid" as const;
  }
}

function isValidQaSecret(
  suppliedSecret: string | null,
  expectedSecret: string | undefined,
) {
  if (!suppliedSecret?.trim() || !expectedSecret?.trim()) {
    return false;
  }

  const supplied = Buffer.from(suppliedSecret);
  const expected = Buffer.from(expectedSecret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
