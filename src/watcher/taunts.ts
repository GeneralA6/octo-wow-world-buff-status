import type { Threat } from "./threat-watch.js";

/**
 * What a listener says out loud as it leaves for a threat: a parting shot at whoever sent it, heard
 * by everyone standing close by, the warlock included. The listeners are mages, so it is a mage's
 * exit — Blink, Ice Block, conjured water for the Infernal — and the joke is that it saw them
 * coming. Cheeky, never abusive, one short /say. Named when the bot already knows who it is; the line reads right
 * without a name too.
 *
 * Plain ASCII only: the game's chat font has no em dash or curly quotes. And never how long it will
 * be gone: that would only tell the warlock when to come back.
 */

type Line = (name: string | null) => string;

const LINES: Readonly<Record<Threat["kind"], readonly Line[]>> = {
  "inferno-cast": [
    (name) => `Bold of you to bring fire to a Frost mage${name ? `, ${name}` : ""}. Blink!`,
    (name) => `${name ? `${name}, I'd` : "I'd"} Polymorph your Infernal, but the sheep deserve better.`,
    (name) => `Hold on${name ? `, ${name}` : ""}, let me conjure some water to put your Infernal out.`,
    (name) => `An Inferno${name ? `, ${name}` : ""}? Ice Block, Invisibility, gone. Mages always have an exit.`,
  ],
  infernal: [
    (name) => `Is that an Infernal${name ? `, ${name}` : ""}? I've Polymorphed scarier things.`,
    () => `A walking bonfire? Frost Nova it yourself, I'm out.`,
    (name) => `${name ? `${name}, your` : "Your"} Infernal looks thirsty. Conjured water, on the house.`,
  ],
  "shunned-player": [
    (name) => `Oh look, ${name ?? "someone"} from the Wall of Shame. Invisibility, please.`,
    (name) => `${name ?? "You"} again? Portal to anywhere but here.`,
    (name) => `Not falling for it twice${name ? `, ${name}` : ""}. Blinking somewhere safer.`,
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
