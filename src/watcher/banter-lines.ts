import type { Faction } from "./buff-store.js";

/**
 * What the two listeners in a capital say to each other while they stand by the head: everyday talk,
 * jokes, and sad stories from the world they live in — told by two mages of their own side.
 *
 * Grounded in the lore of the day (the Horde's camps and Grom's fall, Stormwind's missing king and the
 * dragon at court, the Plaguelands, fallen Dalaran), and kept to what a player around them would know.
 * Each line is one /say: plain ASCII, as the game's chat font has no em dash or curly quotes.
 */

/** The two parts — the listeners take them, whichever way round. */
export type Part = "a" | "b";

export interface Conversation {
  readonly kind: "chat" | "joke" | "story";
  /** Who says what, in order. */
  readonly lines: readonly (readonly [Part, string])[];
}

const HORDE: readonly Conversation[] = [
  {
    kind: "story",
    lines: [
      ["a", "Did you ever hear how Grom Hellscream died?"],
      ["b", "Only that he freed us from the blood curse."],
      ["a", "He drove Gorehowl into Mannoroth in Ashenvale. The demon's death broke the curse he had drunk."],
      ["b", "And the Horde lost its fiercest heart the same day."],
      ["a", "His monument still stands in Demon Fall Canyon. I left a flask of grog there once."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "My grandfather spent his whole life in the internment camps."],
      ["b", "Did he live to see Thrall free them?"],
      ["a", "No. He died behind the fences, the winter before the Horde rose again."],
      ["b", "Then we stand this watch for him too."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How many goblins does it take to light a torch?"],
      ["b", "One. But you pay for the torch, the fire and the insurance."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why don't tauren play hide and seek?"],
      ["b", "Ever tried hiding a whole tauren behind a totem?"],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "That head up there still smells like dragon."],
      ["b", "Better than it smelled when it was still attached."],
      ["a", "Every time a raid brings one back, the whole city gets the Rallying Cry."],
      ["b", "And we hear it first. Best seats in Orgrimmar."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Cairne told me the tauren were being hunted to the last when Thrall found them."],
      ["b", "The centaur were chasing them across the Barrens, weren't they?"],
      ["a", "The orcs stood with them and drove the centaur back. Thunder Bluff stands because of it."],
      ["b", "Honor given, honor returned. The Horde at its best."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "A Forsaken walks into the Crossroads inn."],
      ["b", "Go on."],
      ["a", "The innkeeper asks if he wants a drink. He says no thanks, it goes straight through me."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The Darkspear called the Echo Isles home, once."],
      ["b", "Before Zalazane went mad?"],
      ["a", "His voodoo turned half the tribe into puppets. The rest had to flee to the mainland."],
      ["b", "Vol'jin swears they will take the isles back one day."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "A grunt at the Crossroads asked me if I had seen Mankrik's wife."],
      ["b", "Oh no. Did you have to tell him?"],
      ["a", "She fell in the southern Barrens long ago. He still asks every traveler who passes."],
      ["b", "Some grief never ends. It just waits at the Crossroads."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Another Warsong Gulch just started."],
      ["b", "The night elves still think that forest is theirs."],
      ["a", "The Warsong clan thinks otherwise. So does every axe they carry."],
      ["b", "Grom's clan, Grom's stubbornness."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Do you ever think about Draenor?"],
      ["b", "I was born in the camps. Draenor is just my mother's stories."],
      ["a", "Green fields, she used to say. Before the fel took the land and the bloodlust took us."],
      ["b", "Durotar is red and dry, but no demon owns it. That will do."],
    ],
  },
];

const ALLIANCE: readonly Conversation[] = [
  {
    kind: "story",
    lines: [
      ["a", "Hard to believe that head up there once sat at court."],
      ["b", "Lady Katrana Prestor, whispering in Bolvar's ear."],
      ["a", "Onyxia in a noble's gown, and half the nobles never suspected a thing."],
      ["b", "Makes you wonder who else in the Keep is secretly a dragon."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Any word of the king?"],
      ["b", "Nothing. He sailed for Theramore and never arrived."],
      ["a", "Young Anduin on the throne, and Bolvar ruling in his name."],
      ["b", "Stormwind waits. It always waits."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The stonemasons rebuilt this whole city after the orcs burned it down."],
      ["b", "And the House of Nobles refused to pay them."],
      ["a", "So Edwin VanCleef made them the Defias Brotherhood. Now Westfall burns instead."],
      ["b", "Pay your builders. The lesson Stormwind learned the hard way."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What's the most dangerous creature in Elwynn Forest?"],
      ["b", "Hogger. Ask any young paladin with a sore head."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How can you tell a dwarf has been to Stormwind?"],
      ["b", "The tavern is out of ale and the canals smell like Thunderbrew."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Have you been to Darkshire?"],
      ["b", "Once. Never again. The worgen howl all night."],
      ["a", "A whole town living behind its torches, waiting on the Night Watch to come home."],
      ["b", "Most of them never do."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "They still haven't finished the Lakeshire bridge."],
      ["b", "Magistrate Solomon has written to Stormwind for help a dozen times."],
      ["a", "Maybe someone should tell the king."],
      ["b", "We would, if anyone knew where he was."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "My grandmother lived in Stratholme when the plague came."],
      ["b", "Before the prince came with his soldiers?"],
      ["a", "She left on the last cart out. Her sister stayed behind to pack the good dishes."],
      ["b", "Light keep her. Some say it wept that day."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What's the fastest way to empty a gnome city?"],
      ["b", "Ask Mekkatorque. He did Gnomeregan in one afternoon."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "The whole city lights up when the Rallying Cry drops."],
      ["b", "Major Mattingly's speech, though. I could recite it in my sleep."],
      ["a", "Behold the might of the Alliance!"],
      ["b", "Not so loud. The guards will think it dropped."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "My father fought for Lordaeron in the Second War."],
      ["b", "And now it's a ruin full of Forsaken."],
      ["a", "He kept his old tabard to the end. Said Lordaeron would rise again."],
      ["b", "It rose, all right. Just not the way he meant."],
    ],
  },
];

const SHARED: readonly Conversation[] = [
  {
    kind: "joke",
    lines: [
      ["a", "Why do mages make terrible bartenders?"],
      ["b", "Every drink is conjured water, and they still charge for it."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What do you call a mage without mana?"],
      ["b", "A very expensive robe."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Is the Darkmoon Faire in town?"],
      ["b", "Sayge told my fortune there once."],
      ["a", "What did he say?"],
      ["b", "That I would stand in one spot for a very long time. He was not wrong."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "I studied in Dalaran before the Scourge came."],
      ["b", "Arthas marched on it himself, didn't he?"],
      ["a", "He struck down Archmage Antonidas and took the Book of Medivh. Then the Legion finished the job."],
      ["b", "Now it hides behind a violet dome in Alterac, rebuilding one spell at a time."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why is Ragnaros always so angry?"],
      ["b", "Majordomo keeps summoning him before he's ready. TOO SOON!"],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How many whelps do you think Onyxia keeps in that lair?"],
      ["b", "Many. Many whelps."],
      ["a", "Handle it."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "I passed through the Plaguelands once."],
      ["b", "What was it like?"],
      ["a", "Quiet. Whole towns of Lordaeron, doors open, as if someone was about to come home."],
      ["b", "Some of them did come home. That's the trouble."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What's the most dangerous place in Kalimdor?"],
      ["b", "Onyxia's Lair?"],
      ["a", "Barrens chat."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Do you ever wonder why we just stand here?"],
      ["b", "Someone has to hear the Rallying Cry first."],
      ["a", "And tell the whole realm about it."],
      ["b", "Mages. Forever the messengers."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Mrglglglgl."],
      ["b", "Please stop that."],
      ["a", "I'm practicing my Murloc. Stranglethorn is next."],
      ["b", "Practice somewhere I can't hear you."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Uther the Lightbringer lies buried in the Western Plaguelands."],
      ["b", "Struck down by his own student."],
      ["a", "Arthas, for his father's throne. The paladins still keep a vigil at his tomb."],
      ["b", "Some debts even the Light cannot collect."],
    ],
  },
];

/** The conversations the listeners of `faction`'s capital can have: their side's, and everyone's. */
export function conversationsFor(faction: Faction): readonly Conversation[] {
  return [...(faction === "horde" ? HORDE : ALLIANCE), ...SHARED];
}
