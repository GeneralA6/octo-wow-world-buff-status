/**
 * Best-effort intent detection for free-text whispers, so Bufftracker understands
 * natural phrasing ("sign me up", "when's the buff?", "how do I join?") rather than
 * only exact commands. Used as a fallback after the exact-command parser misses.
 *
 * Order matters: more specific / negating intents are tested first (e.g. "unsubscribe"
 * before "subscribe", since it contains it).
 */
export type Intent = "subscribe" | "unsubscribe" | "status" | "buff" | "guild" | "help";

const PATTERNS: readonly (readonly [Intent, RegExp])[] = [
  ["unsubscribe", /\b(unsub\w*|opt\s?-?out|remove me|leave me alone|no more|unfollow)\b|\bstop\b/],
  ["subscribe", /\b(subscribe|sub me|sign me up|add me|notify me|alert me|ping me|count me in|opt\s?-?in)\b/],
  ["guild", /\b(guild|invite me|how (do i|to) join|joining|recruit\w*|rage\s?quit)\b/],
  ["buff", /\b(buff|rallying cry|world ?buff)\b|when.{0,20}(drop|up)|(drop|up).{0,20}when/],
  ["status", /\b(status|any raid|raid (going|now|up)|anything (happening|going)|what.?s (up|going)|in the lair)\b/],
  ["help", /\b(help|who (are|r) (you|u)|what (are|is) (you|this|it)|what (do|can) you do|commands?)\b|^\s*\?\s*$/],
];

export function parseIntent(text: string): Intent | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  for (const [intent, re] of PATTERNS) if (re.test(t)) return intent;
  return null;
}
