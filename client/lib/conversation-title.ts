// Conversations created before the auto-titling feature shipped were all
// stored as "Solence Session". When we encounter that legacy default, fall
// back to a date-based label so each row in the Profile list is at least
// distinguishable at a glance.
export const LEGACY_DEFAULT_CONVERSATION_TITLE = "Solence Session";

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatSessionDate(date: Date): string {
  const now = new Date();
  if (isSameDay(date, now)) return "Today's session";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday's session";
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  if (date.getTime() >= sevenDaysAgo.getTime()) {
    const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
    return `${weekday}'s session`;
  }
  const formatted = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Session on ${formatted}`;
}

export function displayConversationTitle(
  title: string | null | undefined,
  createdAt: string | Date | null | undefined,
): string {
  const trimmed = (title ?? "").trim();
  if (trimmed.length > 0 && trimmed !== LEGACY_DEFAULT_CONVERSATION_TITLE) {
    return trimmed;
  }
  if (createdAt) {
    const date =
      typeof createdAt === "string" ? new Date(createdAt) : createdAt;
    if (!Number.isNaN(date.getTime())) {
      return formatSessionDate(date);
    }
  }
  return LEGACY_DEFAULT_CONVERSATION_TITLE;
}
