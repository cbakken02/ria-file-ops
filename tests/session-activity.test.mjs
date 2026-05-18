import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_ACTIVITY_UPDATE_THROTTLE_MS,
  SESSION_IDLE_TIMEOUT_MS,
  enforceSessionActivity,
  hashSessionIdentifier,
  invalidateSessionActivityForSession,
  SessionActivityError,
} from "../lib/auth/session-activity.ts";
import { buildWorkspaceIdFromOwnerKey } from "../lib/auth/principal.ts";

const NOW = new Date("2026-05-18T12:00:00.000Z");
const SESSION_HASH = hashSessionIdentifier("session-activity-test");
const OWNER_EMAIL = "owner@example.com";

function makePrincipal() {
  return {
    email: OWNER_EMAIL,
    legacyOwnerEmail: OWNER_EMAIL,
    normalizedEmail: OWNER_EMAIL,
    ownerKey: OWNER_EMAIL,
    role: "owner",
    userId: "google-user-1",
    workspaceId: buildWorkspaceIdFromOwnerKey(OWNER_EMAIL),
  };
}

function makeSession(createdAt = new Date(NOW.getTime() - 10_000)) {
  return {
    appSessionCreatedAt: createdAt.toISOString(),
    appSessionIdHash: SESSION_HASH,
    user: {
      email: OWNER_EMAIL,
      id: "google-user-1",
    },
  };
}

function makeRecord(overrides = {}) {
  return {
    createdAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
    invalidatedAt: null,
    lastActivityAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
    ownerEmail: OWNER_EMAIL,
    sessionIdHash: SESSION_HASH,
    updatedAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
    userId: "google-user-1",
    workspaceId: buildWorkspaceIdFromOwnerKey(OWNER_EMAIL),
    ...overrides,
  };
}

function makeMemoryStore(records = []) {
  const bySessionId = new Map(
    records.map((record) => [record.sessionIdHash, { ...record }]),
  );
  const calls = {
    invalidate: 0,
    upsert: 0,
  };

  return {
    calls,
    records: bySessionId,
    store: {
      get(sessionIdHash) {
        const record = bySessionId.get(sessionIdHash);
        return record ? { ...record } : null;
      },
      invalidate(input) {
        calls.invalidate += 1;
        const existing = bySessionId.get(input.sessionIdHash);
        const next = {
          createdAt: existing?.createdAt ?? input.invalidatedAt,
          invalidatedAt: input.invalidatedAt,
          lastActivityAt: existing?.lastActivityAt ?? input.invalidatedAt,
          ownerEmail: input.ownerEmail,
          sessionIdHash: input.sessionIdHash,
          updatedAt: input.invalidatedAt,
          userId: input.userId,
          workspaceId: input.workspaceId,
        };
        bySessionId.set(input.sessionIdHash, next);
        return { ...next };
      },
      upsert(input) {
        calls.upsert += 1;
        const existing = bySessionId.get(input.sessionIdHash);
        const next = {
          createdAt: existing?.createdAt ?? input.createdAt,
          invalidatedAt: existing?.invalidatedAt ?? null,
          lastActivityAt: input.lastActivityAt,
          ownerEmail: input.ownerEmail,
          sessionIdHash: input.sessionIdHash,
          updatedAt: input.updatedAt,
          userId: input.userId,
          workspaceId: input.workspaceId,
        };
        bySessionId.set(input.sessionIdHash, next);
        return { ...next };
      },
    },
  };
}

test("new valid session passes and creates activity record", async () => {
  const memory = makeMemoryStore();
  const result = await enforceSessionActivity(makeSession(), makePrincipal(), {
    now: NOW,
    store: memory.store,
  });

  assert.equal(result.touched, true);
  assert.equal(memory.calls.upsert, 1);
  assert.equal(
    memory.records.get(SESSION_HASH)?.lastActivityAt,
    NOW.toISOString(),
  );
});

test("activity older than the idle timeout fails closed", async () => {
  const memory = makeMemoryStore([
    makeRecord({
      lastActivityAt: new Date(
        NOW.getTime() - SESSION_IDLE_TIMEOUT_MS - 1,
      ).toISOString(),
    }),
  ]);

  await assert.rejects(
    enforceSessionActivity(makeSession(), makePrincipal(), {
      now: NOW,
      store: memory.store,
    }),
    (error) =>
      error instanceof SessionActivityError &&
      error.reason === "idle_timeout",
  );
});

test("recent activity under the idle timeout passes", async () => {
  const memory = makeMemoryStore([
    makeRecord({
      lastActivityAt: new Date(
        NOW.getTime() - 30 * 60 * 1000,
      ).toISOString(),
    }),
  ]);

  const result = await enforceSessionActivity(makeSession(), makePrincipal(), {
    now: NOW,
    store: memory.store,
  });

  assert.equal(result.record.sessionIdHash, SESSION_HASH);
});

test("absolute timeout fails even when the session was recently active", async () => {
  const memory = makeMemoryStore([
    makeRecord({
      lastActivityAt: new Date(NOW.getTime() - 1_000).toISOString(),
    }),
  ]);

  await assert.rejects(
    enforceSessionActivity(
      makeSession(new Date(NOW.getTime() - SESSION_ABSOLUTE_TIMEOUT_MS - 1)),
      makePrincipal(),
      {
        now: NOW,
        store: memory.store,
      },
    ),
    (error) =>
      error instanceof SessionActivityError &&
      error.reason === "absolute_timeout",
  );
});

test("activity updates are throttled", async () => {
  const withinThrottle = makeMemoryStore([
    makeRecord({
      lastActivityAt: new Date(
        NOW.getTime() - SESSION_ACTIVITY_UPDATE_THROTTLE_MS + 1_000,
      ).toISOString(),
    }),
  ]);

  const first = await enforceSessionActivity(makeSession(), makePrincipal(), {
    now: NOW,
    store: withinThrottle.store,
  });

  assert.equal(first.touched, false);
  assert.equal(withinThrottle.calls.upsert, 0);

  const outsideThrottle = makeMemoryStore([
    makeRecord({
      lastActivityAt: new Date(
        NOW.getTime() - SESSION_ACTIVITY_UPDATE_THROTTLE_MS - 1,
      ).toISOString(),
    }),
  ]);

  const second = await enforceSessionActivity(makeSession(), makePrincipal(), {
    now: NOW,
    store: outsideThrottle.store,
  });

  assert.equal(second.touched, true);
  assert.equal(outsideThrottle.calls.upsert, 1);
});

test("read-only activity checks do not extend the idle timer", async () => {
  const lastActivityAt = new Date(
    NOW.getTime() - SESSION_ACTIVITY_UPDATE_THROTTLE_MS - 1,
  ).toISOString();
  const memory = makeMemoryStore([
    makeRecord({
      lastActivityAt,
    }),
  ]);

  const result = await enforceSessionActivity(makeSession(), makePrincipal(), {
    now: NOW,
    store: memory.store,
    touch: false,
  });

  assert.equal(result.touched, false);
  assert.equal(memory.calls.upsert, 0);
  assert.equal(result.record.lastActivityAt, lastActivityAt);
  assert.equal(memory.records.get(SESSION_HASH)?.lastActivityAt, lastActivityAt);
});

test("read-only activity checks without an existing record use session age", async () => {
  const memory = makeMemoryStore();

  const recent = await enforceSessionActivity(
    makeSession(new Date(NOW.getTime() - 10 * 60 * 1000)),
    makePrincipal(),
    {
      now: NOW,
      store: memory.store,
      touch: false,
    },
  );

  assert.equal(recent.touched, false);
  assert.equal(memory.calls.upsert, 0);
  assert.equal(
    recent.record.lastActivityAt,
    new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
  );

  await assert.rejects(
    enforceSessionActivity(
      makeSession(new Date(NOW.getTime() - SESSION_IDLE_TIMEOUT_MS - 1)),
      makePrincipal(),
      {
        now: NOW,
        store: memory.store,
        touch: false,
      },
    ),
    (error) =>
      error instanceof SessionActivityError &&
      error.reason === "idle_timeout",
  );
});

test("invalidated sessions fail closed", async () => {
  const memory = makeMemoryStore([
    makeRecord({
      invalidatedAt: new Date(NOW.getTime() - 1_000).toISOString(),
      lastActivityAt: new Date(NOW.getTime() - 1_000).toISOString(),
    }),
  ]);

  await assert.rejects(
    enforceSessionActivity(makeSession(), makePrincipal(), {
      now: NOW,
      store: memory.store,
    }),
    (error) =>
      error instanceof SessionActivityError && error.reason === "invalidated",
  );
});

test("logout invalidation makes an otherwise active session fail", async () => {
  const memory = makeMemoryStore([makeRecord()]);

  await invalidateSessionActivityForSession(makeSession(), makePrincipal(), {
    now: NOW,
    store: memory.store,
  });

  assert.equal(memory.calls.invalidate, 1);
  await assert.rejects(
    enforceSessionActivity(makeSession(), makePrincipal(), {
      now: new Date(NOW.getTime() + 1_000),
      store: memory.store,
    }),
    (error) =>
      error instanceof SessionActivityError && error.reason === "invalidated",
  );
});
