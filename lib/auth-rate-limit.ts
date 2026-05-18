import {
  checkRateLimit,
  getClientIpAddress,
  rateLimitResponse,
  type RateLimitResult,
  type RateLimitRule,
} from "@/lib/rate-limit";

const AUTH_SIGNIN_BY_IP: RateLimitRule = {
  keyPrefix: "auth:signin:ip",
  limit: 10,
  windowMs: 5 * 60 * 1000,
};

const AUTH_CALLBACK_BY_IP: RateLimitRule = {
  keyPrefix: "auth:callback:ip",
  limit: 30,
  windowMs: 10 * 60 * 1000,
};

const STORAGE_OAUTH_START_BY_IP: RateLimitRule = {
  keyPrefix: "storage-oauth:start:ip",
  limit: 10,
  windowMs: 5 * 60 * 1000,
};

const STORAGE_OAUTH_START_BY_USER: RateLimitRule = {
  keyPrefix: "storage-oauth:start:user",
  limit: 10,
  windowMs: 5 * 60 * 1000,
};

const STORAGE_OAUTH_CALLBACK_BY_IP: RateLimitRule = {
  keyPrefix: "storage-oauth:callback:ip",
  limit: 30,
  windowMs: 10 * 60 * 1000,
};

const STORAGE_OAUTH_CALLBACK_BY_USER: RateLimitRule = {
  keyPrefix: "storage-oauth:callback:user",
  limit: 20,
  windowMs: 10 * 60 * 1000,
};

export function checkNextAuthRateLimit(request: Request, segments: string[]) {
  const action = segments[0] ?? "";
  const provider = segments[1] ?? "";

  if (action === "signin") {
    return checkRateLimit({
      keyParts: [getClientIpAddress(request), provider || "generic"],
      rule: AUTH_SIGNIN_BY_IP,
    });
  }

  if (action === "callback") {
    return checkRateLimit({
      keyParts: [getClientIpAddress(request), provider || "generic"],
      rule: AUTH_CALLBACK_BY_IP,
    });
  }

  return null;
}

export function checkStorageOAuthStartRateLimit(
  request: Request,
  ownerEmail: string,
) {
  const ipLimit = checkRateLimit({
    keyParts: [getClientIpAddress(request)],
    rule: STORAGE_OAUTH_START_BY_IP,
  });
  if (!ipLimit.allowed) {
    return ipLimit;
  }

  const userLimit = checkRateLimit({
    keyParts: [ownerEmail],
    rule: STORAGE_OAUTH_START_BY_USER,
  });
  return userLimit.allowed ? null : userLimit;
}

export function checkStorageOAuthCallbackRateLimit(
  request: Request,
  ownerEmail: string,
) {
  const ipLimit = checkRateLimit({
    keyParts: [getClientIpAddress(request)],
    rule: STORAGE_OAUTH_CALLBACK_BY_IP,
  });
  if (!ipLimit.allowed) {
    return ipLimit;
  }

  const userLimit = checkRateLimit({
    keyParts: [ownerEmail],
    rule: STORAGE_OAUTH_CALLBACK_BY_USER,
  });
  return userLimit.allowed ? null : userLimit;
}

export function authRateLimitResponse(result: RateLimitResult) {
  return rateLimitResponse(
    result,
    "Too many authentication attempts. Try again later.",
  );
}
