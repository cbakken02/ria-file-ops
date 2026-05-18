import crypto from "node:crypto";

export type RateLimitRule = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitStore = Map<string, RateLimitBucket>;

const defaultRateLimitStore: RateLimitStore = new Map();

export function getClientIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const forwardedIp = forwardedFor
    ?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  if (forwardedIp) {
    return forwardedIp;
  }

  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

export function checkRateLimit(input: {
  keyParts: string[];
  now?: number;
  rule: RateLimitRule;
  store?: RateLimitStore;
}): RateLimitResult {
  const now = input.now ?? Date.now();
  const store = input.store ?? defaultRateLimitStore;
  const key = buildRateLimitKey([input.rule.keyPrefix, ...input.keyParts]);
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + input.rule.windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      limit: input.rule.limit,
      remaining: Math.max(0, input.rule.limit - 1),
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  if (existing.count >= input.rule.limit) {
    return {
      allowed: false,
      limit: input.rule.limit,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: secondsUntil(existing.resetAt, now),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit: input.rule.limit,
    remaining: Math.max(0, input.rule.limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: 0,
  };
}

export function rateLimitResponse(
  result: RateLimitResult,
  message = "Too many requests. Try again later.",
) {
  return new Response(message, {
    status: 429,
    headers: buildRateLimitHeaders(result),
  });
}

export function buildRateLimitHeaders(result: RateLimitResult) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Retry-After": String(result.retryAfterSeconds || secondsUntil(result.resetAt)),
    "X-Content-Type-Options": "nosniff",
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  });
  return headers;
}

export function buildRateLimitKey(parts: string[]) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(parts.map((part) => part.trim().toLowerCase())))
    .digest("hex");
}

function secondsUntil(resetAt: number, now = Date.now()) {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}
