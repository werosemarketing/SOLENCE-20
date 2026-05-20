import {
  test,
  before,
  after,
  beforeEach,
  describe,
  mock,
} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Module mocks — these MUST be installed before importing ../routes so that
// the route module captures our mocked exports instead of the real ones.
// Tests run hermetically: no Apple JWKS network calls and no Postgres traffic.
// Requires `--experimental-test-module-mocks` (passed via the test script).
// ---------------------------------------------------------------------------

type AnyFn = (...args: any[]) => any;

const jwtVerifyMock = mock.fn<AnyFn>(async () => ({ payload: {} }));
const decodeJwtMock = mock.fn<AnyFn>(() => ({}));
const createRemoteJWKSetMock = mock.fn<AnyFn>(() => ({}));

interface InsertExpectation {
  rows: FakeUserRow[];
  capture?: (values: Record<string, unknown>) => void;
}
interface UpdateExpectation {
  rows: FakeUserRow[];
  capture?: (set: Record<string, unknown>) => void;
}

const selectQueue: FakeUserRow[][] = [];
const insertQueue: InsertExpectation[] = [];
const updateQueue: UpdateExpectation[] = [];

const selectMock = mock.fn<AnyFn>(() => {
  const rows = selectQueue.shift() ?? [];
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
});
const insertMock = mock.fn<AnyFn>(() => {
  const next = insertQueue.shift() ?? { rows: [] };
  return {
    values: (values: Record<string, unknown>) => {
      next.capture?.(values);
      return { returning: () => Promise.resolve(next.rows) };
    },
  };
});
const updateMock = mock.fn<AnyFn>(() => {
  const next = updateQueue.shift() ?? { rows: [] };
  return {
    set: (set: Record<string, unknown>) => {
      next.capture?.(set);
      return {
        where: () => ({ returning: () => Promise.resolve(next.rows) }),
      };
    },
  };
});
const deleteMock = mock.fn<AnyFn>(() => ({ where: () => Promise.resolve() }));

const dbMock = {
  select: selectMock,
  insert: insertMock,
  update: updateMock,
  delete: deleteMock,
};

mock.module("jose", {
  namedExports: {
    createRemoteJWKSet: createRemoteJWKSetMock,
    decodeJwt: decodeJwtMock,
    jwtVerify: jwtVerifyMock,
  },
});

mock.module("../db", {
  namedExports: { db: dbMock },
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface FakeUserRow {
  id: string;
  email: string;
  password: string | null;
  appleUserId: string | null;
  displayName: string | null;
  intents: string[] | null;
  tone: string | null;
  voice: string | null;
  language: string | null;
  reminderEnabled: boolean | null;
  reminderTime: string | null;
  weeklySummaryEnabled: boolean | null;
  weeklySummaryDay: number | null;
  weeklySummaryTime: string | null;
  onboardingCompletedAt: Date | null;
}

function makeRow(overrides: Partial<FakeUserRow> = {}): FakeUserRow {
  return {
    id: overrides.id ?? randomUUID(),
    email: overrides.email ?? "user@example.com",
    password: overrides.password ?? null,
    appleUserId: overrides.appleUserId ?? null,
    displayName: null,
    intents: [],
    tone: null,
    voice: null,
    language: null,
    reminderEnabled: false,
    reminderTime: "20:00",
    weeklySummaryEnabled: false,
    weeklySummaryDay: 0,
    weeklySummaryTime: "19:00",
    onboardingCompletedAt: null,
    ...overrides,
  };
}

function queueSelect(rows: FakeUserRow[]): void {
  selectQueue.push(rows);
}
function queueInsert(rows: FakeUserRow[], capture?: InsertExpectation["capture"]): void {
  insertQueue.push({ rows, capture });
}
function queueUpdate(rows: FakeUserRow[], capture?: UpdateExpectation["capture"]): void {
  updateQueue.push({ rows, capture });
}

let server: Server;
let baseUrl: string;

before(async () => {
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = "test-session-secret-apple-auth";
  }

  const { registerRoutes } = await import("../routes");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  await registerRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  // registerRoutes triggers a one-shot seedTestAccount() that hits our
  // mocked db. Drain any queue mutations / call history it produced so the
  // first real test starts from a clean slate.
  selectQueue.length = 0;
  insertQueue.length = 0;
  updateQueue.length = 0;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  mock.reset();
});

beforeEach(() => {
  selectQueue.length = 0;
  insertQueue.length = 0;
  updateQueue.length = 0;
  jwtVerifyMock.mock.resetCalls();
  decodeJwtMock.mock.resetCalls();
  selectMock.mock.resetCalls();
  insertMock.mock.resetCalls();
  updateMock.mock.resetCalls();
  deleteMock.mock.resetCalls();
  // jwtVerify gets a per-test impl, but default to a benign success so a
  // test that forgets to set one fails loudly on its own assertions
  // instead of throwing inside the route.
  jwtVerifyMock.mock.mockImplementation(async () => ({ payload: {} }));
  decodeJwtMock.mock.mockImplementation(() => ({}));
});

interface AppleAuthResponse {
  token: string;
  user: { id: string; email: string };
  preferences: unknown;
  linked: boolean;
}

async function postApple(identityToken: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/apple`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      identityToken === undefined ? {} : { identityToken },
    ),
  });
}

function expectVerify(payload: Record<string, unknown>): void {
  jwtVerifyMock.mock.mockImplementation(async () => ({ payload }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/auth/apple", () => {
  test("signs in an already-linked Apple sub without writing to the DB", async () => {
    const appleSub = "apple-sub-existing";
    const existing = makeRow({
      email: "linked@example.com",
      appleUserId: appleSub,
    });

    expectVerify({ sub: appleSub, email: existing.email });
    queueSelect([existing]); // by Apple sub → hit

    const res = await postApple("token-existing");
    assert.equal(res.status, 200);
    const body = (await res.json()) as AppleAuthResponse;
    assert.equal(body.user.id, existing.id);
    assert.equal(body.user.email, existing.email);
    assert.equal(body.linked, false);
    assert.ok(body.token, "expected session JWT in response");

    // Session JWT must verify against our own server secret and identify
    // the same user we matched on Apple sub.
    const decoded = jwt.verify(
      body.token,
      process.env.SESSION_SECRET as string,
    ) as { userId: string };
    assert.equal(decoded.userId, existing.id);

    // Already-linked branch must short-circuit: no email lookup, update,
    // or insert should have happened.
    assert.equal(jwtVerifyMock.mock.callCount(), 1);
    assert.equal(selectMock.mock.callCount(), 1);
    assert.equal(updateMock.mock.callCount(), 0);
    assert.equal(insertMock.mock.callCount(), 0);
  });

  test("links Apple sub to an existing email/password account on first use", async () => {
    const appleSub = "apple-sub-link";
    const existingEmail = "user@example.com";
    const existingUser = makeRow({
      email: existingEmail,
      password: "hashed",
      appleUserId: null,
    });
    const linkedUser = { ...existingUser, appleUserId: appleSub };

    expectVerify({ sub: appleSub, email: existingEmail });
    queueSelect([]); // by Apple sub → miss
    queueSelect([existingUser]); // by email → hit
    let capturedUpdate: Record<string, unknown> | undefined;
    queueUpdate([linkedUser], (s) => {
      capturedUpdate = s;
    });

    const res = await postApple("token-link");
    assert.equal(res.status, 200);
    const body = (await res.json()) as AppleAuthResponse;
    assert.equal(body.user.id, existingUser.id);
    assert.equal(body.user.email, existingEmail);
    assert.equal(body.linked, true);

    assert.equal(selectMock.mock.callCount(), 2);
    assert.equal(updateMock.mock.callCount(), 1);
    assert.equal(insertMock.mock.callCount(), 0);
    assert.deepEqual(capturedUpdate, { appleUserId: appleSub });
  });

  test("creates a new account when no prior user exists, using the Apple email", async () => {
    const appleSub = "apple-sub-new";
    const email = "fresh@example.com";
    const created = makeRow({
      email,
      password: null,
      appleUserId: appleSub,
    });

    expectVerify({ sub: appleSub, email });
    queueSelect([]); // by Apple sub → miss
    queueSelect([]); // by email → miss
    let capturedInsert: Record<string, unknown> | undefined;
    queueInsert([created], (v) => {
      capturedInsert = v;
    });

    const res = await postApple("token-new");
    assert.equal(res.status, 200);
    const body = (await res.json()) as AppleAuthResponse;
    assert.equal(body.user.id, created.id);
    assert.equal(body.user.email, email);
    assert.equal(body.linked, false);

    assert.equal(selectMock.mock.callCount(), 2);
    assert.equal(updateMock.mock.callCount(), 0);
    assert.equal(insertMock.mock.callCount(), 1);

    // The route must write the Apple sub and the Apple-provided email,
    // with no password (so the user can't sign in with a stale password).
    assert.equal(capturedInsert?.email, email);
    assert.equal(capturedInsert?.password, null);
    assert.equal(capturedInsert?.appleUserId, appleSub);
  });

  test("creates a new account with a private-relay placeholder when the token has no email", async () => {
    const appleSub = "apple-sub-noemail";
    const placeholderEmail = `${appleSub}@privaterelay.appleid.com`;
    const created = makeRow({
      email: placeholderEmail,
      password: null,
      appleUserId: appleSub,
    });

    expectVerify({ sub: appleSub }); // no email claim
    queueSelect([]); // by Apple sub → miss
    // Note: the route skips the email lookup when the token has no email,
    // so the next mocked call is the insert.
    let capturedInsert: Record<string, unknown> | undefined;
    queueInsert([created], (v) => {
      capturedInsert = v;
    });

    const res = await postApple("token-no-email");
    assert.equal(res.status, 200);
    const body = (await res.json()) as AppleAuthResponse;
    assert.equal(body.user.email, placeholderEmail);
    assert.equal(body.linked, false);

    assert.equal(selectMock.mock.callCount(), 1);
    assert.equal(insertMock.mock.callCount(), 1);
    assert.equal(updateMock.mock.callCount(), 0);
    assert.equal(capturedInsert?.email, placeholderEmail);
    assert.equal(capturedInsert?.appleUserId, appleSub);
  });

  test("returns 401 when jwtVerify rejects with an audience mismatch", async () => {
    const audError = Object.assign(
      new Error('unexpected "aud" claim value'),
      { code: "ERR_JWT_CLAIM_VALIDATION_FAILED", claim: "aud" },
    );
    jwtVerifyMock.mock.mockImplementation(async () => {
      throw audError;
    });
    decodeJwtMock.mock.mockImplementation(() => ({
      aud: "com.someoneelse.app",
      iss: "https://appleid.apple.com",
      sub: "apple-sub-badaud",
    }));

    const res = await postApple("token-badaud");
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: string };
    assert.match(String(body.error), /verify Apple identity token/i);

    // Verification failure must short-circuit before any DB calls.
    assert.equal(selectMock.mock.callCount(), 0);
    assert.equal(insertMock.mock.callCount(), 0);
    assert.equal(updateMock.mock.callCount(), 0);
    // The route attempts to decode the token for diagnostic logging.
    assert.equal(decodeJwtMock.mock.callCount(), 1);
  });

  test("returns 401 when jwtVerify rejects with a signature error", async () => {
    jwtVerifyMock.mock.mockImplementation(async () => {
      throw new Error("signature verification failed");
    });

    const res = await postApple("token-bad-sig");
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: string };
    assert.match(String(body.error), /verify Apple identity token/i);
    assert.equal(selectMock.mock.callCount(), 0);
  });

  test("returns 401 when the verified token is missing a subject", async () => {
    expectVerify({ email: "no-sub@example.com" });

    const res = await postApple("token-no-sub");
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: string };
    assert.match(String(body.error), /subject/i);
    assert.equal(selectMock.mock.callCount(), 0);
  });

  test("returns 400 when no identityToken is provided", async () => {
    const res = await postApple(undefined);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(String(body.error), /identity token/i);
    assert.equal(jwtVerifyMock.mock.callCount(), 0);
    assert.equal(selectMock.mock.callCount(), 0);
  });

  test("returns 400 when identityToken is not a string", async () => {
    const res = await fetch(`${baseUrl}/api/auth/apple`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityToken: 12345 }),
    });
    assert.equal(res.status, 400);
    assert.equal(jwtVerifyMock.mock.callCount(), 0);
  });
});
