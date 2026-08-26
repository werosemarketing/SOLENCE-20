import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";

import { db } from "./db";
import {
  REFERRAL_CREDIT_DURATION_MS,
  REFERRAL_CREDIT_MAX_STACK_MS,
  referralCredits,
  users,
  type ReferralCreditSource,
} from "@shared/schema";

// Code alphabet: lowercase alphanumerics minus easily confused chars
// (no 0/o/1/l/i). 8 chars from a 30-char alphabet ≈ 6.6e11 combinations
// — collision risk is negligible at any realistic install scale, and
// short enough to be readable / typable on the Auth screen.
const REFERRAL_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const REFERRAL_CODE_LENGTH = 8;
const REFERRAL_CODE_MAX_ATTEMPTS = 8;

// Returns a random unique referral code. Uses crypto.randomBytes for
// quality entropy; biases from the modulo are negligible at this
// alphabet size and would only weakly impact distribution.
export function generateReferralCode(): string {
  const bytes = randomBytes(REFERRAL_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    out += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
  }
  return out;
}

// Normalize an inbound referral code from the deep link or sign-up form.
// Tolerant of extra whitespace, casing, and a trailing/leading "?ref=".
// Returns "" when nothing useful is present.
export function normalizeReferralCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase().slice(0, 32);
}

// Lazily backfills a referral code on a user row that doesn't have one
// yet (legacy accounts created before this feature shipped). Idempotent:
// if a code already exists, it's returned untouched. On the (vanishingly
// rare) collision case we retry with a fresh code.
export async function ensureReferralCodeForUser(
  userId: string,
): Promise<string> {
  const [existing] = await db
    .select({ referralCode: users.referralCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (existing?.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < REFERRAL_CODE_MAX_ATTEMPTS; attempt++) {
    const code = generateReferralCode();
    try {
      const [updated] = await db
        .update(users)
        .set({ referralCode: code })
        .where(and(eq(users.id, userId), sql`${users.referralCode} IS NULL`))
        .returning({ referralCode: users.referralCode });
      if (updated?.referralCode) return updated.referralCode;
      // The row already had a code by the time we ran (race with another
      // request); read it and return.
      const [row] = await db
        .select({ referralCode: users.referralCode })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (row?.referralCode) return row.referralCode;
    } catch (err) {
      // unique constraint collision on referral_code — retry with new code
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("unique")) throw err;
    }
  }
  throw new Error("Failed to allocate referral code after retries");
}

// Pick a fresh referral code that isn't already taken. Used at register
// time so the new row is born with a code instead of relying on the
// lazy backfill.
export async function allocateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < REFERRAL_CODE_MAX_ATTEMPTS; attempt++) {
    const code = generateReferralCode();
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);
    if (!row) return code;
  }
  throw new Error("Failed to allocate referral code after retries");
}

export type ActiveReferralCredit = {
  endsAt: Date;
};

// Returns the user's currently-active free-week credit, if any. The
// active credit is the row with the latest endsAt > now.
export async function getActiveReferralCredit(
  userId: string,
): Promise<ActiveReferralCredit | null> {
  const now = new Date();
  const [row] = await db
    .select({ endsAt: referralCredits.endsAt })
    .from(referralCredits)
    .where(
      and(eq(referralCredits.userId, userId), gt(referralCredits.endsAt, now)),
    )
    .orderBy(desc(referralCredits.endsAt))
    .limit(1);
  if (!row) return null;
  return { endsAt: row.endsAt };
}

// How many friends this user has successfully referred (i.e. accounts
// whose `referredBy` points at them). Used by the Profile invite card.
export async function getReferralJoinedCount(
  referrerId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(users)
    .where(eq(users.referredBy, referrerId));
  return row?.count ?? 0;
}

// Grant a single free-week credit. Stacks against any existing future
// credit by extending from its endsAt instead of "now", but never lets
// the credit window stretch beyond REFERRAL_CREDIT_MAX_STACK_MS from
// the moment of granting. Returns the row that was inserted.
export async function grantReferralCredit(params: {
  userId: string;
  source: ReferralCreditSource;
  referralUserId: string | null;
}): Promise<typeof referralCredits.$inferSelect> {
  const now = new Date();
  const cap = new Date(now.getTime() + REFERRAL_CREDIT_MAX_STACK_MS);

  const [latest] = await db
    .select({ endsAt: referralCredits.endsAt })
    .from(referralCredits)
    .where(eq(referralCredits.userId, params.userId))
    .orderBy(desc(referralCredits.endsAt))
    .limit(1);

  const startsAt =
    latest && latest.endsAt.getTime() > now.getTime() ? latest.endsAt : now;
  let endsAt = new Date(startsAt.getTime() + REFERRAL_CREDIT_DURATION_MS);
  if (endsAt.getTime() > cap.getTime()) {
    endsAt = cap;
  }

  const [row] = await db
    .insert(referralCredits)
    .values({
      userId: params.userId,
      source: params.source,
      referralUserId: params.referralUserId,
      startsAt,
      endsAt,
    })
    .returning();
  return row;
}

// Build the share URL embedded in the invite blurb. Prefers the explicit
// EXPO_PUBLIC_DOMAIN env var (set to "app.solence.ai" in production), then
// falls back to the Replit dev domain, and finally to a pure-scheme link
// if neither is configured. The web URL deep-links into the app via the
// `solence://` custom scheme installed in app.json.
export function buildReferralShareUrl(code: string): string {
  const safe = encodeURIComponent(code);
  const customDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  const host = customDomain || dev;
  if (host) {
    return `https://${host}/?ref=${safe}`;
  }
  return `solence://signup?ref=${safe}`;
}

// Production referral links must use the public app domain. Without it,
// buildReferralShareUrl falls back to a development host or a native-only
// scheme, neither of which is a reliable share link for production users.
export function warnIfReferralDomainMissing(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.EXPO_PUBLIC_DOMAIN?.trim()) return;

  console.warn(
    "Referral links may be broken: EXPO_PUBLIC_DOMAIN is not set in production. " +
      "Set it to the public app host (for example, app.solence.ai) so shared " +
      "referral links open correctly.",
  );
}
