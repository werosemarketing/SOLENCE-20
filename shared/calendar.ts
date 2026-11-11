/** Calendar keys are dates, not instants: never parse them as midnight UTC. */
export function calendarDateKey(date: Date, timeZone?: string): string {
  if (!timeZone) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function recentCalendarKeys(
  days: number,
  now: Date,
  timeZone?: string,
): string[] {
  const anchor = new Date(`${calendarDateKey(now, timeZone)}T12:00:00Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

export function localDateForKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function moodCalendarBuckets<T extends { createdAt: string }>(
  entries: T[],
  now: Date,
) {
  const today = calendarDateKey(now);
  return recentCalendarKeys(7, now).map((key) => {
    let entry: T | null = null;
    for (const candidate of entries) {
      const date = new Date(candidate.createdAt);
      if (!Number.isFinite(date.getTime()) || calendarDateKey(date) !== key) {
        continue;
      }
      if (!entry || date.getTime() > new Date(entry.createdAt).getTime()) {
        entry = candidate;
      }
    }
    return { key, date: localDateForKey(key), isToday: key === today, entry };
  });
}
