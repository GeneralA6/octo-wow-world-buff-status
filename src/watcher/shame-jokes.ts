import type { Part } from "./banter-lines.js";

/**
 * What the two listeners say, in /say, about a player on the wall of shame who is standing within
 * earshot — named, so they hear it. The wall holds the players who killed a listener: most with an
 * Infernal, dropped on two mages standing still in their own capital.
 *
 * Teasing, never abuse: the joke is on the killing of two harmless mages, and on the wall itself.
 * The Infernal and soul shard ones are kept for a warlock; the rest fit anyone on the wall.
 * Each line is one /say: plain ASCII, as the game's chat font has no em dash or curly quotes.
 */

export interface ShameJoke {
  /** Whether it only makes sense about a warlock — the Infernal, the soul shards, the demons. */
  readonly warlockOnly: boolean;
  /** Who says what, in order, about `name`. */
  readonly lines: (name: string) => readonly (readonly [Part, string])[];
}

/** The 1.12 warlock class id. */
export const WARLOCK_CLASS_ID = 9;

const FOR_ANYONE: readonly ShameJoke["lines"][] = [
  (n) => [
    ["a", `Don't look now, but ${n} is here.`],
    ["b", "From the wall of shame? Top row?"],
    ["a", "Framed and everything. We even spelled it right."],
  ],
  (n) => [
    ["a", `Look who came to visit. ${n}.`],
    ["b", "Brave soul. It took them a whole minute to beat two mages who were standing still."],
  ],
  (n) => [
    ["a", `Is that ${n}?`],
    ["b", "The very same. Slayer of mages who were busy reading."],
    ["a", "A true hero. Songs will be sung. Short ones."],
  ],
  (n) => [
    ["a", `${n} is standing right over there.`],
    ["b", "Should we run?"],
    ["a", "From someone who needs us to stand still first? We'll be fine."],
  ],
  (n) => [
    ["a", `I hear ${n} wants the Onyxia buff alerts again.`],
    ["b", "And?"],
    ["a", "The wall of shame doesn't get whispers. It gets visitors."],
  ],
  (n) => [
    ["a", `Wave to ${n}, everyone.`],
    ["b", "Careful, they might think it's a duel request."],
    ["a", "No danger. They only fight people who don't fight back."],
  ],
  (n) => [
    ["a", `${n} is here again.`],
    ["b", "Do you think they miss us?"],
    ["a", "They must. They keep coming back to the scene of the crime."],
  ],
  (n) => [
    ["a", `Did you know ${n} has a whole wall to themselves in Discord?`],
    ["b", "A whole wall! What an honor."],
    ["a", "Pinned, too. Not everyone gets pinned."],
  ],
  (n) => [
    ["a", `Psst. ${n} is right behind you.`],
    ["b", "I know. I can feel the shame from here."],
  ],
  (n) => [
    ["a", `What do you get when you cross ${n} with a mage who's standing still?`],
    ["b", "A spot on the wall of shame."],
  ],
  (n) => [
    ["a", `${n}, if you're after the Onyxia buff times, we're not telling.`],
    ["b", "The wall of shame hears the news the old way."],
    ["a", "After everyone else."],
  ],
  (n) => [
    ["a", `Someone tell ${n} the training dummies are around the corner.`],
    ["b", "Why bother? They already found two that stand still and talk."],
  ],
  (n) => [
    ["a", `${n} is here. Quick, act natural.`],
    ["b", "I am always natural. I'm a mage."],
    ["a", "Then stand still. It's what they like best."],
  ],
  (n) => [
    ["a", `I have a question for ${n}.`],
    ["b", "Go on."],
    ["a", "Was it worth it? A whole wall, for two mages in a city?"],
    ["b", "Some people collect mounts. Some collect shame."],
  ],
  (n) => [
    ["a", `Should we say hello to ${n}?`],
    ["b", "Better not. The last hello ended at the graveyard."],
    ["a", "Fair. A polite nod, then."],
  ],
  (n) => [
    ["a", `My mother always said to be kind to people like ${n}.`],
    ["b", "Did she know them?"],
    ["a", "No. She just said be kind to people with nothing better to do."],
  ],
  (n) => [
    ["a", `They say ${n} is the most feared player in the city.`],
    ["b", "Feared by whom?"],
    ["a", "Two mages. And only while we're not looking."],
  ],
  (n) => [
    ["a", `Look, ${n} came back to where it happened.`],
    ["b", "Like a murloc to its pond."],
    ["a", "Mrglglgl."],
  ],
  (n) => [
    ["a", `What's ${n} doing here?`],
    ["b", "Checking they're still on the wall."],
    ["a", "Still there. Right at the top. Lovely view."],
  ],
  (n) => [
    ["a", `I'd challenge ${n} to a duel.`],
    ["b", "Why don't you?"],
    ["a", "They only accept when you're looking the other way."],
  ],
];

const FOR_WARLOCKS: readonly ShameJoke["lines"][] = [
  (n) => [
    ["a", `${n} is here. Is that a soul shard in their bag?`],
    ["b", "More like thirty. One for every mage who was standing still."],
  ],
  (n) => [
    ["a", `Careful, ${n} might drop another Infernal on us.`],
    ["b", "Let them. It's cheaper than buying friends."],
  ],
  (n) => [
    ["a", `How many Infernals does it take ${n} to beat two mages?`],
    ["b", "Just one. But the mages have to be reading."],
  ],
  (n) => [
    ["a", `I think ${n}'s Infernal misses us.`],
    ["b", "The rock? It only knows one trick."],
    ["a", "Fall from the sky and set things on fire. Like its owner's reputation."],
  ],
  (n) => [
    ["a", `${n}, an Infernal doesn't count as a friend.`],
    ["b", "Even if it follows you everywhere."],
  ],
  (n) => [
    ["a", `Why does ${n} love Infernals so much?`],
    ["b", "They're the only thing that comes when they call."],
  ],
  (n) => [
    ["a", `${n} is here. Do you smell sulfur?`],
    ["b", "That's either their Infernal or their personality."],
  ],
  (n) => [
    ["a", `I counted the spells ${n} needed to beat two mages who weren't fighting back.`],
    ["b", "How many?"],
    ["a", "One. A big rock from the sky. Very brave rock."],
  ],
  (n) => [
    ["a", `Should we tell ${n} that Infernals are for raids?`],
    ["b", "Let them keep it. It's the only thing that will stand next to them."],
  ],
  (n) => [
    ["a", "Warlocks summon demons for power."],
    ["b", `What does ${n} summon them for?`],
    ["a", "Company."],
  ],
];

export const SHAME_JOKES: readonly ShameJoke[] = [
  ...FOR_ANYONE.map((lines) => ({ warlockOnly: false, lines })),
  ...FOR_WARLOCKS.map((lines) => ({ warlockOnly: true, lines })),
];

/** Which of `SHAME_JOKES` fit a player of `classId`, by index. */
export function shameJokesFor(classId: number): readonly number[] {
  return SHAME_JOKES.flatMap((joke, index) => (!joke.warlockOnly || classId === WARLOCK_CLASS_ID ? [index] : []));
}
