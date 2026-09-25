import type { Conversation } from "./banter-lines.js";

/**
 * What the listeners say once one of them is brought back from the dead, a moment after it has
 * thanked its healer: its partner, still standing, welcomes it back (part "a"), and it answers ("b")
 * — or, with no partner there to hear it, it jokes on its own.
 *
 * Death as a mage in 1.12 knows it: the Spirit Healer, the corpse run, the repair bill, resurrection
 * sickness, the warlock's rock that did it. Each line is one /say: plain ASCII, as the game's chat
 * font has no em dash or curly quotes.
 */

export const COMEBACKS: readonly Conversation[] = [
  {
    kind: "joke",
    lines: [
      ["a", "Welcome back. How was the Spirit Healer?"],
      ["b", "Chatty. Kept offering to take a quarter of my durability."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Look who's alive again."],
      ["b", "Don't get used to it. There are still warlocks in this city."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "You were dead for a while there."],
      ["b", "I was resting my eyes. Very, very deeply."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Did you see a bright light?"],
      ["b", "I saw a flaming rock. Then a bright light. Then a very bored angel."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Welcome back to the living."],
      ["b", "Thanks. The dead had better conversation, though."],
      ["a", "Rude."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Your robe is scorched."],
      ["b", "My pride is worse."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "I kept your spot warm for you."],
      ["b", "The Infernal kept it warmer."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "I told everyone you were just taking a nap."],
      ["b", "A nap, on fire, in the middle of the city. Very believable."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Next time, try Blink."],
      ["b", "I did. Turns out you can't Blink out of being dead."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Rule one of standing guard: don't die."],
      ["b", "Rule two: stand next to a priest in case rule one breaks."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Did you at least take the Infernal with you?"],
      ["b", "I took its attention. For about four seconds."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What was it like, being a ghost?"],
      ["b", "Fast. Ghosts run like the wind."],
      ["a", "Pity they can't cast a thing."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "You owe that healer a lot of water."],
      ["b", "A lifetime supply. Two lifetimes, at this rate."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Back already? I just finished your eulogy."],
      ["b", "Keep it handy. The way this city goes, I'll need it again."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Resurrection sickness looks good on you."],
      ["b", "Pale, weak and cranky. So, my usual self."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Let me guess. A warlock?"],
      ["b", "A warlock. A big rock. Very rude."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "You missed nothing while you were gone."],
      ["b", "Good. I'd hate to have died for something exciting."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How does it feel to be back?"],
      ["b", "Like a mage who lost a fight with a boulder."],
      ["a", "So, normal."],
    ],
  },
];

/** What the one brought back says with no partner there to hear it. */
export const SOLO_COMEBACKS: readonly string[] = [
  "Note to self: dying is terrible for my reading schedule.",
  "Back from the dead. The repair bill is the scary part.",
  "I have seen the Spirit Healer's face. I don't recommend it.",
  "Rezzed, rested and slightly singed. Now, where was I?",
  "Being dead was very quiet. Nobody even asked me for water.",
  "Resurrection sickness. Ten minutes of feeling like a level one gnome.",
  "Somewhere, a warlock is very disappointed right now.",
  "I got better.",
  "Let the record show I died with my robes on and my dignity mostly intact.",
  "Death is just a very long cast time.",
  "Now, where did I put my Frost Armor? Clearly not on me.",
  "Standing again. Standing is what I do best, after all.",
];
