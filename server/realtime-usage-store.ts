import { desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { liveVoiceSessions } from "../shared/schema";
import { LIVE_VOICE_MAX_SECONDS } from "../shared/realtime";
import { LIVE_PRICING_VERSION, type LiveUsageStore } from "./realtime-usage";

const durationSql = sql<number>`case when ${liveVoiceSessions.connectedAt} is null then 0 else
  least(${LIVE_VOICE_MAX_SECONDS}, greatest(0, extract(epoch from
  (coalesce(${liveVoiceSessions.endedAt}, now()) - ${liveVoiceSessions.connectedAt})))) end`;
const incompleteSql = sql<boolean>`(${liveVoiceSessions.status} in ('starting', 'active', 'tracking_error')
  or coalesce((${liveVoiceSessions.usage}->>'unpricedResponses')::int, 0) > 0)`;

export const liveUsageStore: LiveUsageStore = {
  async save(record) {
    const values = { ...record, estimatedUsd: record.usage.estimatedUsd, pricingVersion: LIVE_PRICING_VERSION };
    await db.insert(liveVoiceSessions).values(values).onConflictDoUpdate({
      target: liveVoiceSessions.id, set: values,
      // A delayed startup write must never reopen a call already finalized
      // by a disconnect on another async path.
      setWhere: record.endedAt ? undefined : isNull(liveVoiceSessions.endedAt),
    });
  },
  async summary(userId) {
    const [totals] = await db.select({
      calls: sql<number>`count(*)::int`,
      durationSeconds: sql<number>`coalesce(sum(${durationSql}), 0)::float8`,
      estimatedUsd: sql<number>`coalesce(sum(${liveVoiceSessions.estimatedUsd}), 0)::float8`,
      responses: sql<number>`coalesce(sum((${liveVoiceSessions.usage}->>'responses')::int),0)::int`,
      incompleteCalls: sql<number>`count(*) filter (where ${incompleteSql})::int`,
      inputTokens: sql<number>`coalesce(sum((${liveVoiceSessions.usage}->>'reportedInputTokens')::bigint),0)::float8`,
      outputTokens: sql<number>`coalesce(sum((${liveVoiceSessions.usage}->>'reportedOutputTokens')::bigint),0)::float8`,
      cachedInputTokens: sql<number>`coalesce(sum((${liveVoiceSessions.usage}->>'cachedText')::bigint + (${liveVoiceSessions.usage}->>'cachedAudio')::bigint),0)::float8`,
    }).from(liveVoiceSessions).where(eq(liveVoiceSessions.userId, userId));
    const latest = await db.select({
      id: liveVoiceSessions.id, startedAt: liveVoiceSessions.startedAt,
      durationSeconds: durationSql, status: liveVoiceSessions.status,
      responses: sql<number>`(${liveVoiceSessions.usage}->>'responses')::int`,
      estimatedUsd: liveVoiceSessions.estimatedUsd, incomplete: incompleteSql,
      usage: liveVoiceSessions.usage,
    }).from(liveVoiceSessions).where(eq(liveVoiceSessions.userId, userId))
      .orderBy(desc(liveVoiceSessions.startedAt)).limit(5);
    return { ...totals, latest: latest.map(row => ({
      ...row, startedAt: row.startedAt.toISOString(), durationSeconds: Number(row.durationSeconds),
    })) };
  },
};
