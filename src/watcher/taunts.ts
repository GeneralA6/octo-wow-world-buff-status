import type { Threat } from "./threat-watch.js";

/**
 * What a listener says out loud as it leaves for a threat: a parting shot at whoever sent it, heard
 * by everyone standing close by, the warlock included. The listeners are mages, so it is a mage's
 * exit — Blink, Ice Block, conjured water for the Infernal — and the joke is that it saw them
 * coming. Cheeky, never abusive, one short /say. Named when the bot already knows who it is; the
 * line reads right without a name too.
 *
 * Plain ASCII only: the game's chat font has no em dash or curly quotes. And never how long it will
 * be gone: that would only tell the warlock when to come back.
 */

type Line = (name: string | null) => string;

/** ", Zezerver" — or nothing, when the name is not known. */
const to = (name: string | null): string => (name ? `, ${name}` : "");

const LINES: Readonly<Record<Threat["kind"], readonly Line[]>> = {
  "inferno-cast": [
    (name) => `Bold of you to bring fire to a Frost mage${to(name)}. Blink!`,
    (name) => `${name ? `${name}, I'd` : "I'd"} Polymorph your Infernal, but the sheep deserve better.`,
    (name) => `Hold on${to(name)}, let me conjure some water to put your Infernal out.`,
    (name) => `An Inferno${to(name)}? Ice Block, Invisibility, gone. Mages always have an exit.`,
    (name) => `That meteor has my name on it${to(name)}? Return to sender. Blink!`,
    (name) => `Incoming meteor${to(name)}! Good thing mages come with a built-in Blink button.`,
    (name) => `You spent a soul shard on me${to(name)}? I'm flattered. Also leaving.`,
    (name) => `Nice aim${to(name)}. Shame I read the cast bar.`,
    (name) => `${name ? `${name}, the` : "The"} Kirin Tor warned us about warlocks like you.`,
    (name) => `An Infernal, just for me${to(name)}? You shouldn't have. Really. Please don't.`,
    (name) => `Big rock from the sky incoming? I'll take the Portal, thanks${to(name)}.`,
    (name) => `If you wanted my spot${to(name)}, you could have just asked.`,
    (name) => `Summoning demons in the capital${to(name)}? The guards are going to hear about this.`,
    (name) => `Cast bar says Inferno${to(name)}. My spell book says Blink. Guess who wins.`,
  ],
  infernal: [
    (name) => `Is that an Infernal${to(name)}? I've Polymorphed scarier things.`,
    () => `A walking bonfire? Frost Nova it yourself, I'm out.`,
    (name) => `${name ? `${name}, your` : "Your"} Infernal looks thirsty. Conjured water, on the house.`,
    (name) => `Your pet is on fire${to(name)}. Should I call someone?`,
    (name) => `A big angry rock with a tan. How original${to(name)}.`,
    (name) => `That Infernal smells like burnt soul shards${to(name)}. I'm out.`,
    () => `Sheep it? Frost Nova it? Nah, Blink it is.`,
    (name) => `Is it just me${to(name)}, or did it get really warm in here?`,
    () => `Note to self: Frost Armor does nothing against a flaming boulder. Leaving.`,
    (name) => `Keep your rock on a leash${to(name)}. The guards are watching.`,
    () => `Infernals are like bad pickup groups - loud, hot, and they never leave. I will.`,
    (name) => `I'd stay and fight${to(name)}, but I only packed Frostbolt.`,
    () => `Burning rock at the gates again? I'll be somewhere with less fire.`,
  ],
  "shunned-player": [
    (name) => `Oh look, ${name ?? "someone"} from the Wall of Shame. Invisibility, please.`,
    (name) => `${name ?? "You"} again? Portal to anywhere but here.`,
    (name) => `Not falling for it twice${to(name)}. Blinking somewhere safer.`,
    (name) => `${name ?? "You"}, back again? The Wall of Shame has your good side.`,
    (name) => `Oh, it's ${name ?? "you"}. Everyone, hide the soul shards.`,
    (name) => `Careful everyone, ${name ?? "a wanted warlock"} is in the square.`,
    (name) => `${name ?? "You"} again? I've seen more subtle Infernals.`,
    (name) => `The Wall of Shame called${to(name)}. It misses you.`,
    (name) => `Look who it is${to(name)}. I'll be over here. Far away. Invisibly.`,
    (name) => `Not today${to(name)}. My mother told me not to talk to warlocks.`,
    (name) => `${name ?? "Someone"} is here. Everyone mind your backs and your bags.`,
    (name) => `Hello${to(name)}. Your autograph is already on the Wall of Shame.`,
    (name) => `${name ?? "You"} again? Even my Polymorph is tired of you.`,
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

/** How many lines there are for this kind of threat. */
export function tauntCount(kind: Threat["kind"]): number {
  return LINES[kind].length;
}
