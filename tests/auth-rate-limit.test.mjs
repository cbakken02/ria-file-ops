import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRateLimitKey,
  checkRateLimit,
  getClientIpAddress,
  getClientIpAddressFromHeaders,
} from "../lib/rate-limit.ts";
import {
  authRateLimitResponse,
  checkStorageOAuthCallbackRateLimit,
  checkStorageOAuthStartRateLimit,
  checkNextAuthRateLimit,
} from "../lib/auth-rate-limit.ts";

test("rate limiter allows requests until the fixed window limit is reached", () => {
  const store = new Map();
  const rule = {
    keyPrefix: "test:login",
    limit: 2,
    windowMs: 60_000,
  };

  const first = checkRateLimit({
    keyParts: ["ip", "203.0.113.10"],
    now: 1_000,
    rule,
    store,
  });
  const second = checkRateLimit({
    keyParts: ["ip", "203.0.113.10"],
    now: 2_000,
    rule,
    store,
  });
  const third = checkRateLimit({
    keyParts: ["ip", "203.0.113.10"],
    now: 3_000,
    rule,
    store,
  });

  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterSeconds, 58);
});

test("rate limiter resets after the fixed window expires", () => {
  const store = new Map();
  const rule = {
    keyPrefix: "test:reset",
    limit: 1,
    windowMs: 1_000,
  };

  assert.equal(
    checkRateLimit({
      keyParts: ["ip", "203.0.113.20"],
      now: 1_000,
      rule,
      store,
    }).allowed,
    true,
  );
  assert.equal(
    checkRateLimit({
      keyParts: ["ip", "203.0.113.20"],
      now: 1_500,
      rule,
      store,
    }).allowed,
    false,
  );
  assert.equal(
    checkRateLimit({
      keyParts: ["ip", "203.0.113.20"],
      now: 2_001,
      rule,
      store,
    }).allowed,
    true,
  );
});

test("client IP extraction prefers the first forwarded IP", () => {
  const request = new Request("https://example.test/api/auth/signin/google", {
    headers: {
      "x-forwarded-for": "203.0.113.30, 198.51.100.2",
      "x-real-ip": "198.51.100.3",
    },
  });

  assert.equal(getClientIpAddress(request), "203.0.113.30");
});

test("client IP extraction works from server action header readers", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.31",
    "x-real-ip": "198.51.100.31",
  });

  assert.equal(getClientIpAddressFromHeaders(headers), "198.51.100.31");
});

test("rate limit keys hash identity material instead of storing it raw", () => {
  const key = buildRateLimitKey(["auth", "user@example.com"]);

  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key.includes("user@example.com"), false);
});

test("NextAuth limiter skips session metadata but limits repeated sign-in starts", () => {
  const metadataRequest = new Request("https://example.test/api/auth/session", {
    headers: { "x-forwarded-for": "203.0.113.40" },
  });
  assert.equal(checkNextAuthRateLimit(metadataRequest, ["session"]), null);

  const signinRequest = new Request("https://example.test/api/auth/signin/google", {
    headers: { "x-forwarded-for": "203.0.113.41" },
  });

  for (let index = 0; index < 10; index += 1) {
    assert.equal(
      checkNextAuthRateLimit(signinRequest, ["signin", "google"])?.allowed,
      true,
    );
  }

  assert.equal(
    checkNextAuthRateLimit(signinRequest, ["signin", "google"])?.allowed,
    false,
  );
});

test("storage OAuth limiter applies per-user start limits without exposing identity", () => {
  const request = new Request("https://example.test/api/storage/google/start", {
    headers: { "x-forwarded-for": "203.0.113.50" },
  });

  for (let index = 0; index < 10; index += 1) {
    assert.equal(
      checkStorageOAuthStartRateLimit(request, "owner@example.test"),
      null,
    );
  }

  const limited = checkStorageOAuthStartRateLimit(
    request,
    "owner@example.test",
  );
  assert.equal(limited?.allowed, false);
  assert.equal(limited?.remaining, 0);
});

test("storage OAuth callback limiter permits callback bursts within threshold", () => {
  const request = new Request("https://example.test/api/storage/google/callback", {
    headers: { "x-forwarded-for": "203.0.113.60" },
  });

  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      checkStorageOAuthCallbackRateLimit(request, "callback-owner@example.test"),
      null,
    );
  }

  const limited = checkStorageOAuthCallbackRateLimit(
    request,
    "callback-owner@example.test",
  );
  assert.equal(limited?.allowed, false);
});

test("authRateLimitResponse returns safe throttling headers", async () => {
  const response = authRateLimitResponse({
    allowed: false,
    limit: 10,
    remaining: 0,
    resetAt: Date.now() + 30_000,
    retryAfterSeconds: 30,
  });

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(response.headers.get("X-RateLimit-Limit"), "10");
  assert.equal(
    await response.text(),
    "Too many authentication attempts. Try again later.",
  );
});
