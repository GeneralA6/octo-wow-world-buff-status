/**
 * What a character says out loud after a player resurrects it: a thank-you by name, heard by
 * everyone standing close by. The listeners are mages, so it is a mage's thanks — conjured water, a
 * Portal owed. One short /say, plain ASCII (the game's chat font has no em dash or curly quotes), and
 * it reads right when the name never came back.
 */

type Line = (name: string | null) => string;

const LINES: readonly Line[] = [
  (name) => `Thank you${name ? `, ${name}` : ""}! Have some conjured water on me.`,
  (name) => `${name ? `${name}, you're` : "You're"} a hero. Arcane Intellect for you, any time.`,
  (name) => `Back on my feet${name ? ` thanks to ${name}` : ""}. I owe you a Portal.`,
  (name) => `Thanks for the rez${name ? `, ${name}` : ""}! Frost Armor on, back on watch.`,
];

/** A random thank-you, naming the player when known. `pick` chooses among `count`. */
export function thanksFor(
  name: string | null,
  pick: (count: number) => number = (count) => Math.floor(Math.random() * count),
): string {
  const line = LINES[Math.min(LINES.length - 1, Math.max(0, pick(LINES.length)))] ?? LINES[0];
  return line ? line(name) : "";
}
