/**
 * Best-effort intent detection for free-text whispers, so Bufftracker understands
 * natural phrasing ("sign me up", "when's the buff?", "what's your discord?") rather
 * than only exact commands. Used as a fallback AFTER the exact-command parser misses,
 * so a bare command word ("subscribe", "horde") never reaches here.
 *
 * Order matters: more specific / negating intents are tested first (e.g. "unsubscribe"
 * before "subscribe", since it contains it; "profile" before "status" since "my status"
 * is about the caller, not the raid). Keep every pattern NARROW — a false match acts on
 * a player, and the worst of them (flipping a side, unsubscribing) makes them miss a buff.
 */
export type Intent =
  | "subscribe"
  | "unsubscribe"
  | "feedback"
  | "discord"
  | "profile"
  | "guild"
  | "buff"
  | "status"
  | "thanks"
  | "help";

const PATTERNS: readonly (readonly [Intent, RegExp])[] = [
  ["unsubscribe", /\b(unsub\w*|opt\s?-?out|remove me|take me off|leave me alone|no more|unfollow|cancel|quit)\b|\bstop\b/],
  [
    "subscribe",
    /\b(subscribe|sub me|sign me up|add me|notify me|alert me|ping me|count me in|opt\s?-?in|keep me posted|let me know|wake me)\b/,
  ],
  [
    "feedback",
    /\b(feedback|suggest\w*|feature request|report a bug|there'?s a bug|you should (add|make|change|have|include|support)|could you (add|make|change|support)|can you (add|support))\b/,
  ],
  ["discord", /\bdiscord\b/],
  [
    "profile",
    /\b(my (settings|profile|subscription|side|faction)|am i (subscribed|signed up|on the list|set up)|what (am i|did i) (signed up for|subscribed to|get))\b/,
  ],
  ["guild", /\b(guild|invite me|how (do i|to) join|joining|recruit\w*|rage\s?quit)\b/],
  ["buff", /\b(buff|rallying cry|world ?buff|the head|onyxia buff)\b|when.{0,20}(drop|up)|(drop|up).{0,20}when/],
  [
    "status",
    /\b(status|any raid|raid (going|now|up|status)|anything (happening|going)|what.?s (up|going)|in the lair|is onyxia (up|going)|anyone in ony\w*)\b/,
  ],
  ["thanks", /\b(thank(s| you)?|thx|ty|cheers|appreciate it|much love|legend|you rock|good bot)\b/],
  [
    "help",
    /\b(help|who (are|r) (you|u)|what (are|is) (you|this|it)|what (do|can) you do|how (do i use|does this work)|commands?)\b|^\s*\?\s*$/,
  ],
];

export function parseIntent(text: string): Intent | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  for (const [intent, re] of PATTERNS) if (re.test(t)) return intent;
  return null;
}
