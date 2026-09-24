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
  {
    kind: "story",
    lines: [
      ["a", "Did you know the Dark Lady was a high elf once?"],
      ["b", "Ranger-General of Silvermoon, before Arthas came."],
      ["a", "She fought him at every gate of Quel'Thalas. He made her a banshee for it."],
      ["b", "Now she rules beneath his father's city and hunts him from below."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "I asked a Forsaken in the Undercity what he misses most."],
      ["b", "His heartbeat?"],
      ["a", "His daughter. She lives in Southshore now, and runs when she sees him."],
      ["b", "The plague took his life. The living took the rest."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Thrall's parents were murdered when he was still a babe."],
      ["b", "Durotan and Draka. Gul'dan sent the assassins."],
      ["a", "A human lord found him in the snow and raised him to fight in the pits of Durnholde."],
      ["b", "And the slave became Warchief. The world has a sense of humor."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Thrall wears Doomhammer's armor, you know."],
      ["b", "The old Warchief's? How did he come by it?"],
      ["a", "Orgrim fell beside him freeing the camps, a lance through his back."],
      ["b", "He gave Thrall the hammer and the Horde with his last breath."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The village down the coast is named for Sen'jin."],
      ["b", "Vol'jin's father?"],
      ["a", "Murlocs took him for their sea witch the night the Darkspear escaped with Thrall."],
      ["b", "He never left that island. His people did, and they never forgot him."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Remember the lazy peons in the Valley of Trials?"],
      ["b", "The ones you wake with a blackjack?"],
      ["a", "Foreman Thazz'ril swears it builds character."],
      ["b", "It built a headache. I was one of the peons."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why does the tauren at the inn never order the steak?"],
      ["b", "Says it reminds him of his uncle."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How can you tell a goblin is cheating you?"],
      ["b", "He's offering you a discount."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "The zeppelin to the Undercity is late again."],
      ["b", "Goblin engineering. It either arrives or it explodes."],
      ["a", "Last week it did both."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "You know the Burning Blade are hiding right under our feet?"],
      ["b", "Ragefire Chasm. Cultists in the Warchief's own cellar."],
      ["a", "Every new recruit gets sent down to clear them out."],
      ["b", "And every week they're back. Like rats with daggers."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Have you seen the Kodo Graveyard in Desolace?"],
      ["b", "Where the old kodo go to die?"],
      ["a", "They walk across half of Kalimdor to lie down beside their ancestors' bones."],
      ["b", "Alone?"],
      ["a", "The herd walks with them to the edge, then turns back. The old one goes on alone."],
      ["b", "The tauren say the Earth Mother waits at the other end. I hope they're right."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Do you remember waking up in Deathknell?"],
      ["b", "Grave dirt in my mouth, and Shadow Priest Sarvis standing over me."],
      ["a", "I asked him where my wife was. He handed me a sword and a list of zombies to kill."],
      ["b", "Welcome to the Forsaken. Here is your first errand."],
      ["a", "I found her later. She wears the Scarlet tabard now, at the Monastery."],
      ["b", "Alive, at least. That's more than either of us can say."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Rend Blackhand still calls himself Warchief up in Blackrock Spire."],
      ["b", "Warchief of what? A mountain full of dragons he takes orders from?"],
      ["a", "Nefarian holds his leash, and he thinks it's a crown."],
      ["b", "His father led the Horde. Rend runs errands for a lizard."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why do trolls make the best cooks in Durotar?"],
      ["b", "Lose a finger in the stew, grow it back by supper."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why don't the Forsaken play cards?"],
      ["b", "Their poker face keeps falling off."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "I ran into Rexxar on the road through Desolace."],
      ["b", "The Champion of the Horde? What was he doing out there?"],
      ["a", "Walking. Just him, his bear Misha, and a trail of dead centaur behind them."],
      ["b", "He never did like cities. Or people. Or centaur, apparently."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The priests of Zul'Gurub have called Hakkar back into this world."],
      ["b", "The Soulflayer? The Gurubashi drove him out once already."],
      ["a", "It nearly ended their empire. A blood god, and he wanted all of it."],
      ["b", "And now the Zandalari on Yojamba Isle are asking outsiders to finish the job."],
      ["a", "Trolls asking for help. That's how bad it is."],
      ["b", "Or how clever. Let the outsiders bleed for the Gurubashi's mistake."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Did you walk through the Cleft of Shadow today?"],
      ["b", "I try not to. Every warlock in Durotar lives down there."],
      ["a", "One of them offered me a free soulstone."],
      ["b", "Nothing a warlock gives you is free. Ask anyone who's met his Infernal."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Naralex still sleeps beneath the Barrens."],
      ["b", "The night elf druid? Why is he sleeping?"],
      ["a", "He meant to dream the Barrens green again. The Nightmare found him instead."],
      ["b", "So that's why the oases have gone bad."],
      ["a", "His own disciples went mad with him. They call themselves the Druids of the Fang now."],
      ["b", "One bad dream, and a whole land pays for it."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "A peon told me 'zug zug' means yes, and work, and hello."],
      ["b", "And goodbye."],
      ["a", "And 'the Warchief is coming'."],
      ["b", "And 'I'm on fire'."],
      ["a", "Then how do you know what he means?"],
      ["b", "You don't. You just watch which way he runs."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The Venture Company is still cutting down Stonetalon."],
      ["b", "Goblins with saws the size of kodos."],
      ["a", "The Charred Vale burned for a week last summer. The druids wept."],
      ["b", "And the goblins sold the ashes."],
      ["a", "To whom?"],
      ["b", "To the druids. For fertilizer."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Magatha Grimtotem smiles at Cairne in every council."],
      ["b", "She smiles like a hyena at a carcass."],
      ["a", "Her tribe ambushes travelers in Stonetalon and Feralas, and she sits on Elder Rise."],
      ["b", "One day she'll stop smiling. I hope Cairne is watching when she does."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "A troll witch doctor offered to read my future."],
      ["b", "What did he see?"],
      ["a", "Me paying him five silver. He was right."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The Royal Apothecaries are brewing something new under the Undercity."],
      ["b", "A cure for the plague?"],
      ["a", "A new plague. For the Scourge, they say."],
      ["b", "For the Scourge. Of course."],
      ["a", "I asked Master Apothecary Faranell what it does. He smiled and sent me to Hillsbrad for samples."],
      ["b", "Stay away from anything green down there. That's all I'm saying."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What do you call a tauren with no legs?"],
      ["b", "Ground beef."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Did you see the new High Warlord in the Hall of Legends?"],
      ["b", "Fourteen ranks of honor, and still no time to sleep."],
      ["a", "They say he hasn't logged out in months."],
      ["b", "Neither have we, and nobody gives us a title."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The Kul Tirans still hold Tiragarde Keep on our own coast."],
      ["b", "Proudmoore's leftovers. They never went home."],
      ["a", "Their admiral died on these shores. They think they're guarding his grave."],
      ["b", "Maybe they are."],
      ["a", "Every week some young grunt gets sent to clear them out."],
      ["b", "You have to respect it. Holding a keep for a dead man's grudge."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How does an orc knock on a door?"],
      ["b", "Axe first. Then he asks who's there."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Brill has the only inn where the patrons are deader than the ale."],
      ["b", "The Gallows' End Tavern. Innkeeper Renee pours a fine drink."],
      ["a", "The whole town was human, once. Some of them still sit in the same chairs."],
      ["b", "Old habits don't die. Even when you do."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why did the goblin build a rocket to the moon?"],
      ["b", "He heard it was made of gold."],
      ["a", "It wasn't. He sold the rocket to a gnome anyway."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Hamuul Runetotem studied at Moonglade with the night elves."],
      ["b", "A tauren, taught by the kaldorei? How did that go?"],
      ["a", "Malfurion himself took him as a student. The first tauren druid in ten thousand years."],
      ["b", "And now the Cenarion Circle sits in Thunder Bluff too."],
      ["a", "Horde and night elves, sharing tea in the Moonglade."],
      ["b", "The only place in the world where nobody fights. The owls are watching."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Went to watch the races at the Shimmering Flats."],
      ["b", "Goblins against gnomes. Who won?"],
      ["a", "Nobody. Both cars blew up at the starting line."],
      ["b", "So a normal day at the Flats."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Do you know why this land is called Durotar?"],
      ["b", "For Thrall's father, Durotan."],
      ["a", "Chieftain of the Frostwolves. He never saw it. Never saw his son grown, either."],
      ["b", "So his son gave him a whole country instead."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why did the Forsaken skip dinner?"],
      ["b", "No stomach for it."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Drek'Thar still leads the Frostwolves in Alterac Valley."],
      ["b", "The blind shaman? He raised Thrall, didn't he?"],
      ["a", "Taught him the elements when no one else would. Now the dwarves dig in his valley."],
      ["b", "The Stormpike want the iron. The Frostwolves want to be left alone."],
      ["a", "So the whole Horde marches in to help."],
      ["b", "And that valley never stays quiet for more than an hour."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "The Crossroads is under attack again."],
      ["b", "Centaur?"],
      ["a", "Kolkar, this time. Or the Alliance. Or a very angry raptor."],
      ["b", "That town has been under attack since the day it was built. It's a tradition now."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why did the kodo cross the Barrens?"],
      ["b", "It didn't. It's still halfway. Kodos are slow."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The old orc beside Thrall in Grommash Hold is Eitrigg."],
      ["b", "The one a human paladin spared?"],
      ["a", "Tirion Fordring. He lost his title for it."],
      ["b", "And Eitrigg never forgot. Honor doesn't care what color your skin is."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "I asked a grunt for directions to the bank."],
      ["b", "What did he say?"],
      ["a", "Lok'tar ogar. Then he pointed at the auction house."],
      ["b", "Close enough, for a grunt."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "My grandmother told me about Shattrath."],
      ["b", "The draenei city on Draenor?"],
      ["a", "The Horde burned it on Gul'dan's word. She held a torch that day."],
      ["b", "Did she regret it?"],
      ["a", "Every day of her life. She said the fel doesn't ask. It just burns through you."],
      ["b", "Then we make sure nothing asks us that again."],
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
  {
    kind: "story",
    lines: [
      ["a", "Jaina Proudmoore stood by while the orcs killed her father."],
      ["b", "Admiral Proudmoore? He sailed on Durotar with the whole fleet."],
      ["a", "She begged him to leave the peace alone. He wouldn't listen."],
      ["b", "Theramore has its peace. Kul Tiras has a grudge."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Anduin Lothar fell at the foot of Blackrock Spire."],
      ["b", "The Lion of Azeroth. Doomhammer struck him down himself."],
      ["a", "Turalyon took up his sword and won the war anyway."],
      ["b", "And the prince carries Lothar's name now. Big boots to fill."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Turalyon and Alleria led the Sons of Lothar through the Dark Portal."],
      ["b", "To end the orcs for good. What happened?"],
      ["a", "Ner'zhul tore Draenor apart and the portal fell. They never came home."],
      ["b", "Some say they still fight out there. Some say that is just hope."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Have you met Verna Furlbrow's horse in Westfall?"],
      ["b", "Old Blanchy? The one everyone steals oats for?"],
      ["a", "Half the heroes of Stormwind started out feeding that horse."],
      ["b", "And she still looks hungry every time I pass."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How can you tell a gnome engineer built something?"],
      ["b", "It's on fire, and he's taking notes."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why is there always a night elf dancing on the mailbox?"],
      ["b", "Ten thousand years of practice. It has to go somewhere."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Magni still believes his daughter was kidnapped."],
      ["b", "Moira? She married the Dark Iron emperor."],
      ["a", "He sent a whole army into Blackrock Depths to bring her home."],
      ["b", "Hard to rescue someone who locked the door herself."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "King Magni lost his brother in Northrend."],
      ["b", "Muradin? He went north with Prince Arthas."],
      ["a", "He found the cursed blade first. It took him before it took the prince."],
      ["b", "They say Magni still raises a mug to him every night."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Remind me never to rest at the Lion's Pride Inn."],
      ["b", "In Goldshire? What happened?"],
      ["a", "Nothing I can repeat in front of the guards."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The Dragonmaw kept the Dragonqueen chained in Grim Batol."],
      ["b", "Alexstrasza? For how long?"],
      ["a", "Years. They took her young as they hatched and rode them into war."],
      ["b", "The Wetlands still smell of smoke when the wind turns."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Did you know King Llane died in his own throne room?"],
      ["b", "The orcs broke through the walls?"],
      ["a", "No. Garona, the half-orc envoy. He trusted her, and she cut out his heart."],
      ["b", "And a hundred years on, we let a dragon wear a gown at court."],
      ["a", "Stormwind lets its enemies close. We never learn."],
      ["b", "Next time someone new smiles at Bolvar, I'm checking for scales."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why do dwarves never shave?"],
      ["b", "Where else would they keep the crumbs?"],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Gilneas built a wall to keep out the rest of the world."],
      ["b", "Greymane's Wall. When the Scourge came, they shut the gates and let Lordaeron burn."],
      ["a", "My uncle's family lives behind it. I write to them every season."],
      ["b", "Do they answer?"],
      ["a", "The letters come back sealed. Every one."],
      ["b", "Then they're still keeping the world out. Maybe that means they're safe."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "The prisoners have taken the Stockade again."],
      ["b", "Again? Who's in charge this time?"],
      ["a", "Bazil Thredd and his Defias friends. Warden Thelwater is begging for volunteers."],
      ["b", "Stormwind's finest prison. Easier to get out of than to get into."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Have you taken the Deeprun Tram to Ironforge?"],
      ["b", "Once. Under all that sea, with a gnome in charge of the plumbing."],
      ["a", "I held my breath the whole ride."],
      ["b", "Smart. The gnomes say it only leaks on Tuesdays."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The night elves won't say Illidan's name out loud."],
      ["b", "Malfurion's own brother, wasn't he?"],
      ["a", "He betrayed his people for power, and made a new Well of Eternity atop Hyjal."],
      ["b", "So Malfurion chained him under the earth for ten thousand years."],
      ["a", "And Tyrande let him out. Out of pity, some say. Or love."],
      ["b", "Now he's gone beyond the Portal, and she carries that choice alone."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What's a paladin's favorite spell?"],
      ["b", "Divine Shield. Followed by his Hearthstone."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Did Stitches make it to Darkshire again?"],
      ["b", "The abomination? He walks right up the road every time someone finishes that quest."],
      ["a", "And every time, the Night Watch dies to the last man."],
      ["b", "Somebody please stop doing that quest."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Prince Arthas came home to Lordaeron with the bells ringing."],
      ["b", "I know how this ends."],
      ["a", "King Terenas rose from his throne to embrace his son."],
      ["b", "And the boy drove that cursed blade through his father's heart."],
      ["a", "The bells were still ringing when the Scourge came through the gates."],
      ["b", "Some homecomings end kingdoms."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why did the gnome get thrown out of the Pig and Whistle?"],
      ["b", "He kept standing on the bar to order."],
      ["a", "The barkeep told him to get down. He said he was down."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Have you heard the true story of Gnomeregan?"],
      ["b", "The troggs came up from below, didn't they?"],
      ["a", "And Mekkatorque flooded the city with radiation to stop them. Half his people were still inside."],
      ["b", "On his advisor Thermaplugg's word."],
      ["a", "Who stayed behind to take the throne of what was left."],
      ["b", "A king of glowing ruins. Some ambitions are best left unmet."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why do dwarves ride gryphons?"],
      ["b", "Rams can't fly, and the gnomes' flying machines keep exploding."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Gryan Stoutmantle raised a militia in Westfall."],
      ["b", "Farmers with pitchforks against the Defias?"],
      ["a", "Farmers with pitchforks and a very long list of names."],
      ["b", "The People's Militia. Stormwind won't help them, so they help themselves."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Teldrassil was planted without the blessing of the dragons."],
      ["b", "Is that why the forest there feels wrong?"],
      ["a", "The Gnarlpine furbolgs went mad, and the timberlings turn on anything that walks."],
      ["b", "Fandral says the tree is healthy."],
      ["a", "Fandral says a lot of things."],
      ["b", "And the Archdruid is never wrong. Just ask him."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How many paladins does it take to light a candle?"],
      ["b", "One. After Blessing of Might, Blessing of Wisdom and Blessing of Kings."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "The Great Forge in Ironforge has never gone out, you know."],
      ["b", "Not once in all these centuries?"],
      ["a", "The dwarves say the day it goes cold, Ironforge goes with it."],
      ["b", "Then keep the coal coming. I like the dwarves."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Southshore buried three more militiamen last week."],
      ["b", "The Forsaken from Tarren Mill again?"],
      ["a", "They were neighbors once. Same farms, same chapel, before the plague."],
      ["b", "Now one town is alive and the other isn't."],
      ["a", "And they still fight over the same fields."],
      ["b", "Some feuds outlive the people who started them."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How long does it take to cross Darnassus?"],
      ["b", "Nobody knows. Nobody has ever found the other side."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "SI:7 knows everything that happens in this city."],
      ["b", "Even what we're saying right now?"],
      ["a", "Especially that. Master Shaw's people are everywhere."],
      ["b", "Then hello, Master Shaw. Lovely weather in the Trade District."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Alterac sided with the Horde in the Second War."],
      ["b", "Lord Perenolde's betrayal. The kingdom paid for it."],
      ["a", "Lordaeron burned his capital to the ground and gave his lands away."],
      ["b", "And his nobles?"],
      ["a", "Went into the hills and became the Syndicate. Thieves in fine coats."],
      ["b", "Some nobles never change. They just lose their castles."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "A gnome told me he's the tallest mage in Ironforge."],
      ["b", "Standing on what?"],
      ["a", "A dwarf."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Westfall's farmers built mechanical scarecrows to guard their crops."],
      ["b", "The harvest golems? They work for the Defias now."],
      ["a", "Turns out if you build a golem to reap, it doesn't care what it reaps."],
      ["b", "Stormwind's finest engineering, pointed the wrong way."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "The Explorers' League found another tablet in Uldaman."],
      ["b", "What did it say?"],
      ["a", "That the dwarves were made of stone by the Titans, long ago."],
      ["b", "Half of Ironforge refuses to believe it. Imagine finding out you're a statue."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Someone fell into the Stormwind canal again."],
      ["b", "Did they drown?"],
      ["a", "No, but they came out with three murlocs and a quest."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The orphanage behind the Cathedral is full again."],
      ["b", "The Scourge?"],
      ["a", "The Scourge, the Defias, the Blackrock. Every one of them leaves children behind."],
      ["b", "Children's Week is coming. I'll take one of them to see the Great Forge."],
      ["a", "Matron Nightingale says they mostly want someone who comes back."],
      ["b", "Then I'll come back."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What's the difference between a dwarf and his rifle?"],
      ["b", "The rifle doesn't need a drink after every shot."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "The Dark Irons blew a hole in the Thandol Span."],
      ["b", "The bridge between the Wetlands and Arathi?"],
      ["a", "Half of it's gone. You cross it holding your breath."],
      ["b", "Dark Iron diplomacy. Always explosive."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "A gnome, a dwarf and a night elf walk into a tavern."],
      ["b", "What happened?"],
      ["a", "The dwarf drank, the elf danced, and the gnome got stepped on."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The night elves still remember the Sundering."],
      ["b", "When the Well of Eternity exploded?"],
      ["a", "Their whole world sank under the sea. Queen Azshara and her court with it."],
      ["b", "Ten thousand years, and they still won't touch arcane magic."],
      ["a", "Most of them look at us mages like we're holding a lit torch in a library."],
      ["b", "To be fair, we usually are."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "There was an explosion in the Mage Quarter again."],
      ["b", "An apprentice?"],
      ["a", "A Frost Nova, somehow. Half the street is still stuck."],
      ["b", "Leave them. It builds character."],
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
  {
    kind: "joke",
    lines: [
      ["a", "How does a mage win every argument?"],
      ["b", "Polymorph. It is very hard to argue as a sheep."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What's a mage's favorite part of a raid?"],
      ["b", "The water break. Suddenly everyone remembers my name."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why do warlocks never get invited to parties?"],
      ["b", "They always bring an Infernal."],
      ["a", "And then act surprised when it sets the whole city on fire."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What loot does a hunter need from a raid?"],
      ["b", "All of it. Ask him, he already rolled need."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Karazhan still stands empty in Deadwind Pass."],
      ["b", "Medivh's tower? Since the Guardian died?"],
      ["a", "Sargeras hid in him from birth. He opened the Dark Portal for the orcs."],
      ["b", "His best friend had to kill him to end it. The tower remembers."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The night elves traded forever to beat Archimonde."],
      ["b", "At Mount Hyjal? What did they give up?"],
      ["a", "Their World Tree, and the immortality it gave them. They age now, like the rest of us."],
      ["b", "Ten thousand years, spent in one morning."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Deathwing was a guardian of this world once."],
      ["b", "The Earth-Warder? Before the madness?"],
      ["a", "Neltharion. He forged the Dragon Soul to protect the world, then turned it on everyone."],
      ["b", "And his daughter's head hangs at our gate. Like father, like daughter."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Ever been to Gadgetzan?"],
      ["b", "Once. A goblin robbed me, then sold me my own purse back."],
      ["a", "That's not robbery. That's commerce."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Have you heard the tale of the Ashbringer?"],
      ["b", "Mograine's blade? The Scourge fled at the sight of it."],
      ["a", "His own son lured him out alone and gave him to the Scourge."],
      ["b", "The greatest paladin of his age, sold for an inheritance."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Fandral Staghelm lost his son at the Scarab Wall."],
      ["b", "In the Qiraji war, a thousand years ago?"],
      ["a", "Their general tore Valstann apart in front of him."],
      ["b", "Fandral broke the Scepter the day they sealed the gate. Some wounds don't close."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Remember the War Effort for Ahn'Qiraj?"],
      ["b", "Every copper bar and bandage in the realm, piled up in Silithus."],
      ["a", "One champion rang the gong, while the rest of us counted linen."],
      ["b", "Horde and Alliance side by side, and nobody even started a fight."],
      ["a", "Then the gates opened and the bugs poured out."],
      ["b", "And everyone started fighting again. The bugs, mostly."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Have you seen what floats over the Plaguelands now?"],
      ["b", "Naxxramas. Kel'Thuzad's necropolis."],
      ["a", "He was a mage of the Kirin Tor, once. One of the best in Dalaran."],
      ["b", "He went looking for forbidden magic, and found a master waiting for him."],
      ["a", "A warning for every one of us who reads past midnight."],
      ["b", "Put the book down. I mean it."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How long does it take a druid to fetch a candle?"],
      ["b", "Long enough to be a bear, a cat and a seal, and forget why he came in."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Did you see that rogue sneak past us?"],
      ["b", "No."],
      ["a", "Exactly."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "A warrior asked me for Arcane Intellect today."],
      ["b", "Why? He can't use it."],
      ["a", "He heard it makes you smarter. It didn't take."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Onyxia has a brother, you know."],
      ["b", "Nefarian? Up in Blackwing Lair?"],
      ["a", "Breeding dragons from all five flights at once. Chromatic, he calls them."],
      ["b", "His head would look good at the gate next to hers. Same cheering, twice the smell."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Hemet Nesingwary wants fifteen panthers skinned."],
      ["b", "Then fifteen tigers. Then fifteen raptors."],
      ["a", "Stranglethorn is running out of cats."],
      ["b", "Meanwhile half the Vale is hunting for pages of his book."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Tirion Fordring lives in a hut by a lake in the Plaguelands."],
      ["b", "The paladin who was stripped of his title?"],
      ["a", "For sparing an orc who had saved his life. The Silver Hand called it treason."],
      ["b", "And his son grew up in the Scarlet Crusade."],
      ["a", "Taelan. He chose his father in the end, and Isillien struck him down in front of Tirion."],
      ["b", "A man who lost everything for doing right. Twice."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "How long did you save for your first mount?"],
      ["b", "Forty levels of walking and every copper I had."],
      ["a", "And the epic one?"],
      ["b", "Still saving. Ask me again next year."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Green dragons have been seen at the great trees again."],
      ["b", "Ysera's own? They guard the Emerald Dream."],
      ["a", "Something in the Dream has turned them. They breathe sleep and rot now."],
      ["b", "If even the Dream's guardians are falling, who is left to guard us?"],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What's the last thing a priest says before a wipe?"],
      ["b", "Don't stand in the fire."],
      ["a", "And the first thing after?"],
      ["b", "I said don't stand in the fire."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "A stranger asked me for a free portal today."],
      ["b", "What did you say?"],
      ["a", "Nothing is free. Reagents cost money, and so does my patience."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why do frost mages make terrible friends?"],
      ["b", "They give everyone the cold shoulder."],
      ["a", "Then Frost Nova them when they try to leave."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "How can you tell a fire mage has visited the library?"],
      ["b", "There isn't one anymore."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Aegwynn fought Sargeras himself, long ago."],
      ["b", "Medivh's mother? The Guardian of Tirisfal?"],
      ["a", "She slew his avatar in Northrend. But his spirit hid inside her."],
      ["b", "And passed into her son."],
      ["a", "She saved the world, and handed it the Dark Portal without knowing it."],
      ["b", "The worst tragedies start with a victory."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Why do kobolds wear candles on their heads?"],
      ["b", "So they can see who's about to take the candle."],
      ["a", "You no take candle!"],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Thaurissan summoned Ragnaros to win his war against Ironforge."],
      ["b", "Did it work?"],
      ["a", "The Firelord burned him to ash and took the mountain for himself."],
      ["b", "Be careful what you summon. It might want your house."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Where did you set your hearthstone?"],
      ["b", "Right here. Where else would I go?"],
      ["a", "Somewhere with a chair, maybe."],
      ["b", "Chairs are for people who don't stand guard."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Have you ever heard the whispers in Silithus?"],
      ["b", "The sandstorms?"],
      ["a", "Something older. The Twilight's Hammer camp out there worships it."],
      ["b", "C'Thun, they say. Sleeping beneath Ahn'Qiraj."],
      ["a", "They say if you listen too long, you hear your own name."],
      ["b", "Then we stop listening. We have enough voices to deal with."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "My friend tried to rez me with goblin jumper cables."],
      ["b", "Did it work?"],
      ["a", "On the fourth try. I'm still smoking."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "Nat Pagle says the big fish are in Dustwallow Marsh."],
      ["b", "Is that where he lives?"],
      ["a", "On a little island, fishing all day, never bothering anyone."],
      ["b", "Now there's a man who has figured life out."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The bronze dragons guard a cave in Tanaris."],
      ["b", "The Caverns of Time?"],
      ["a", "They say every moment that ever happened is kept in there."],
      ["b", "Then somewhere in there, we're still standing here. Forever."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "What's the most dangerous monster in Azeroth?"],
      ["b", "Onyxia? Ragnaros?"],
      ["a", "The repair bill after a wipe."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The Bloodsail Buccaneers attacked Booty Bay again."],
      ["b", "Pirates against goblins? Who do you root for?"],
      ["a", "The sharks. They're the only ones in that bay who aren't cheating anyone."],
      ["b", "Baron Revilgaz pays well to sink pirates, though."],
      ["a", "He pays in pirate hats."],
      ["b", "Currency is currency, in Booty Bay."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "Felwood was part of Ashenvale, once."],
      ["b", "Before the demons?"],
      ["a", "The Legion's blood soaked into the roots. Now even the furbolgs are mad."],
      ["b", "The Timbermaw held out. Stubborn bears."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "I polymorphed a gnoll this morning."],
      ["b", "What happened?"],
      ["a", "The sheep was smarter. I left it that way."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "One of the Four Horsemen in Naxxramas was a paladin once."],
      ["b", "Sir Zeliek?"],
      ["a", "He still begs forgiveness while he swings his hammer."],
      ["b", "The Lich King doesn't just take your life. He makes you watch what he does with it."],
    ],
  },
  {
    kind: "joke",
    lines: [
      ["a", "Did you hear about the paladin in Blackrock Spire?"],
      ["b", "The one who ran into the rookery alone?"],
      ["a", "At least he had chicken."],
    ],
  },
  {
    kind: "story",
    lines: [
      ["a", "The centaur are the children of Zaetar and Princess Theradras."],
      ["b", "Cenarius' son, and the earth elemental?"],
      ["a", "Their children killed him for being their father. Now his ghost wanders Maraudon."],
      ["b", "No wonder the centaur hate everyone. They started with family."],
    ],
  },
  {
    kind: "chat",
    lines: [
      ["a", "The Argent Dawn takes Horde and Alliance alike."],
      ["b", "At Light's Hope? Anyone at all?"],
      ["a", "If you kill Scourge, you're welcome. That's their only rule."],
      ["b", "Best rule in the Plaguelands."],
    ],
  },
];

/** The conversations the listeners of `faction`'s capital can have: their side's, and everyone's. */
export function conversationsFor(faction: Faction): readonly Conversation[] {
  return [...(faction === "horde" ? HORDE : ALLIANCE), ...SHARED];
}
