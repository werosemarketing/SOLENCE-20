import i18n from "@/lib/i18n";

// Conversations created before the auto-titling feature shipped were all
// stored as "Solence Session". When we encounter that legacy default, fall
// back to a date-based label so each row in the Profile list is at least
// distinguishable at a glance. The literal sentinel stays in English
// because that's what's persisted server-side; the user-facing fallback
// labels all flow through i18n.
export const LEGACY_DEFAULT_CONVERSATION_TITLE = "Solence Session";

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function localeForLanguage(lang?: string): string {
  if (lang === "es") return "es";
  return "en";
}

function formatSessionDate(date: Date, lang?: string): string {
  const t = i18n.t.bind(i18n);
  const locale = localeForLanguage(lang);
  const now = new Date();
  if (isSameDay(date, now)) {
    return t("conversationTitle.todays", { lng: lang });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return t("conversationTitle.yesterdays", { lng: lang });
  }
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  if (date.getTime() >= sevenDaysAgo.getTime()) {
    const weekday = date.toLocaleDateString(locale, { weekday: "long" });
    return t("conversationTitle.weekday", { weekday, lng: lang });
  }
  const formatted = date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
  return t("conversationTitle.onDate", { date: formatted, lng: lang });
}

export function displayConversationTitle(
  title: string | null | undefined,
  createdAt: string | Date | null | undefined,
  language?: string,
): string {
  const trimmed = (title ?? "").trim();
  if (trimmed.length > 0 && trimmed !== LEGACY_DEFAULT_CONVERSATION_TITLE) {
    return trimmed;
  }
  if (createdAt) {
    const date =
      typeof createdAt === "string" ? new Date(createdAt) : createdAt;
    if (!Number.isNaN(date.getTime())) {
      return formatSessionDate(date, language);
    }
  }
  return i18n.t("conversationTitle.legacyDefault", { lng: language });
}
