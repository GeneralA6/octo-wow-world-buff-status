/**
 * What a character says out loud after a player resurrects it: a thank-you by name, heard by
 * everyone standing close by. The listeners are mages, so it is a mage's thanks — conjured water, a
 * Portal owed. One short /say, plain ASCII (the game's chat font has no em dash or curly quotes), and
 * it reads right when the name never came back.
 */

type Line = (name: string | null) => string;

/** ", Healbot" — or nothing, when the name is not known. */
const to = (name: string | null): string => (name ? `, ${name}` : "");

const LINES: readonly Line[] = [
  (name) => `Thank you${to(name)}! Have some conjured water on me.`,
  (name) => `${name ? `${name}, you're` : "You're"} a hero. Arcane Intellect for you, any time.`,
  (name) => `Back on my feet${name ? ` thanks to ${name}` : ""}. I owe you a Portal.`,
  (name) => `Thanks for the rez${to(name)}! Frost Armor on, back on watch.`,
  (name) => `Much obliged${to(name)}! The next Portal is on the house.`,
  (name) => `You're a true hero${to(name)}. I'll tell the Kirin Tor about you.`,
  (name) => `Thank you${to(name)}! I'd conjure you a cake, but mages only do water and bread.`,
  (name) => `Alive again${name ? `, thanks to ${name}` : ""}. Arcane Brilliance for everyone!`,
  (name) => `${name ?? "You"} just saved me a very long corpse run. Thank you!`,
  (name) => `Back from the dead and not even a little bit Scourge. Thanks${to(name)}!`,
  (name) => `The Spirit Healer can keep waiting. Thank you${to(name)}!`,
  (name) => `Thanks for the rez${to(name)}! I promise to stay out of the fire this time.`,
  (name) => `${name ? `${name}, may` : "May"} your mana never run dry. Thank you!`,
  (name) => `Thank you${to(name)}! Free water refills for life.`,
];

/** A random thank-you, naming the player when known. `pick` chooses among `count`. */
export function thanksFor(
  name: string | null,
  pick: (count: number) => number = (count) => Math.floor(Math.random() * count),
): string {
  const line = LINES[Math.min(LINES.length - 1, Math.max(0, pick(LINES.length)))] ?? LINES[0];
  return line ? line(name) : "";
}

/** How many thank-you lines there are. */
export const THANKS_COUNT = LINES.length;
