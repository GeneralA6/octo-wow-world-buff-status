import type { Threat } from "./threat-watch.js";

/**
 * What a listener says out loud as it leaves for a threat: a parting shot at whoever sent it, heard
 * by everyone standing close by, the warlock included. The joke is that it saw them coming — cheeky,
 * never abusive, one short /say. Named when the bot already knows who it is; the line reads right
 * without a name too.
 *
 * Plain ASCII only: the game's chat font has no em dash or curly quotes.
 */

type Line = (name: string | null) => string;

const LINES: Readonly<Record<Threat["kind"], readonly Line[]>> = {
  "inferno-cast": [
    (name) => `Nice try${name ? `, ${name}` : ""}. Your Infernal can have the spot - back in 5.`,
    (name) => `Saw that Inferno coming a mile off${name ? `, ${name}` : ""}. The Wall of Shame says hi.`,
    (name) => `Missed me${name ? `, ${name}` : ""}! Enjoy guarding an empty spot.`,
    (name) => `${name ? `${name}, an` : "An"} Inferno? Again? I'll be back when you run out of shards.`,
  ],
  infernal: [
    (name) => `Cute pet${name ? `, ${name}` : ""}. Not today - brb.`,
    () => `An Infernal? How original. See you in 5.`,
    (name) => `${name ? `${name}, your` : "Your"} Infernal can stand here all it likes. I'll wait.`,
  ],
  "shunned-player": [
    (name) => `Oh look, ${name ?? "someone"} from the Wall of Shame. I'll come back when you're gone.`,
    (name) => `${name ?? "You"} again? I'll wait. brb`,
    (name) => `Not falling for it twice${name ? `, ${name}` : ""}. See you never.`,
  ],
};

/** A random line for this kind of threat, naming the player when known. `pick` chooses among `count`. */
export function tauntFor(
  kind: Threat["kind"],
  name: string | null,
  pick: (count: number) => number = (count) => Math.floor(Math.random() * count),
): string {
  const lines = LINES[kind];
  const line = lines[Math.min(lines.length - 1, Math.max(0, pick(lines.length)))] ?? lines[0];
  return line ? line(name) : "";
}
