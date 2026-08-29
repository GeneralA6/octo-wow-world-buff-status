# turtle-onyxia-bot

A **clientless** bot for Turtle WoW (WoW 1.12) that logs in with the game's own
network protocol — no game client — polls `/who` for a raid instance, and pushes
a Discord alert when a raid **enters** and when it **leaves** Onyxia's Lair.

The point is world-buff timing: knowing a raid is inside the lair means a kill —
and a **Rallying Cry of the Dragonslayer** — may be minutes away, so you can be in
your capital to catch it.

---

## ⚠️ Read this first

**Turtle WoW's rules forbid automation and third-party programs that connect to
their server.** This bot is exactly that. Running it risks a **ban of the account
it logs in with**.

- Use a **dedicated throwaway account** you are willing to lose. Never your main.
- The bot parks a character standing still, always online — which is detectable.
- Keep the poll interval gentle (the default is 20s; don't go below ~15s).
- Before building anything, check whether a **community "buff timer" Discord**
  already exists for Turtle — that carries zero risk and may make this moot.

This code is provided for educational purposes. You are responsible for how you
use it.

---

## The one check that decides if this works at all

WoW's `/who` filters by zone, but whether it lists players **inside an instance**
depends on the server core. Turtle may or may not expose them. **Verify manually
before relying on the bot:**

1. Have a friend (or an alt) stand inside Onyxia's Lair.
2. In the game client, type: `/who Onyxia's Lair`
3. If they appear in the results → the approach works.
   If not → `/who` can't see instanced players on Turtle, and no bot can either.
   In that case, watch for the server's world announcement on a kill instead (see
   *Limitations*).

While you're there, note the **area id** the bot should watch. Onyxia's Lair is
`2159` in stock 1.12; if Turtle uses a custom id, set `WATCH_AREA_ID` accordingly.

Also note: **`/who` only returns your own faction.** A Horde bot sees Horde raids,
an Alliance bot sees Alliance raids. That's the right side for buff timing (the
buff is faction-wide), but to watch both factions you'd run two bots.

---

## Setup

Requires **Node.js 20+** (uses built-in `fetch`, `process.loadEnvFile`, and the
`crypto`/`net` modules — the bot has **zero runtime dependencies**).

```bash
npm install
npm audit        # expect: found 0 vulnerabilities
npm test         # 88 unit + integration tests
```

Then configure:

```bash
cp .env.example .env
# edit .env — see the comments in that file
```

You need:

- A **throwaway Turtle account** (`WOW_ACCOUNT` / `WOW_PASSWORD`).
- A **character** on it (`WOW_CHARACTER`) — ideally the **only** character on the
  account (see *Limitations*). It just parks wherever it logs in.
- A **Discord webhook URL** (`DISCORD_WEBHOOK_URL`): in Discord, *Server Settings →
  Integrations → Webhooks → New Webhook*, copy its URL.

## Run

Locally, the quickest way (runs the TypeScript directly, no build):

```bash
npm run start:dev              # runs src/index.ts via tsx
LOG_LEVEL=debug npm run start:dev
```

Or the production path (compile once, then run plain Node):

```bash
npm run build   # tsc -> dist/
npm start       # node dist/index.js
```

To keep it running 24/7 on your own box, use a process manager (e.g.
`pm2 start "npm start" --name onyxia-bot`) or a systemd service. The bot
reconnects on its own if the link drops. For a hosted option, see **Deploy on
Railway** below.

You should get an "👁️ Watching Onyxia's Lair" message in Discord on startup, a
"🐉 Raid entered" when a group appears, and a "✅ cleared" when they leave.

## Deploy on Railway (24/7)

This repo is Railway-ready: `railway.json` and `nixpacks.toml` tell it to compile
to `dist/` and run `node dist/index.js`, with an on-failure restart policy.

1. On [Railway](https://railway.com), create a project → **Deploy from GitHub
   repo** → pick this repo. It builds automatically (no start command to type).
2. Open the service → **Variables** and add the same keys from `.env` (there is no
   `.env` file in the deploy — the bot reads them straight from the environment):

   | Variable | Value |
   |---|---|
   | `WOW_ACCOUNT` | your throwaway account |
   | `WOW_PASSWORD` | its password |
   | `WOW_CHARACTER` | the character to log in |
   | `DISCORD_WEBHOOK_URL` | your Discord webhook |
   | `DISCORD_MENTION_ROLE_ID` | opt-in role id to ping (optional; see below) |
   | `WOW_AUTH_HOST` | your server's realmlist host, e.g. `play.octowow.st` (default) |
   | `WOW_REALM` | the realm your character is on, e.g. `N'Zoth` (default) |
   | `WATCH_AREA_ID` | `2159` (optional) |
   | `POLL_INTERVAL_SECONDS` | `20` (optional) |
   | `LOG_LEVEL` | `info`, or `debug` while you verify it |

3. This is a **worker** — it does not serve HTTP, so it won't get a public domain,
   and that's expected. Don't set a health check port.
4. Watch the deploy logs. You want to see "in world; watching Onyxia's Lair", and
   a "👁️ Watching Onyxia's Lair" message should land in your Discord channel.

If the deploy logs stop at a handshake step, set `LOG_LEVEL=debug`, redeploy, and
read where it stops — the *Limitations* section maps each stopping point to a
cause.

---

## Personal / opt-in notifications

By default the bot posts to the channel and everyone there sees it. To let members
**opt in** to actually being *pinged* — instead of blasting the whole channel —
use a self-assignable role. No extra code or bot needed:

1. **Create a role**, e.g. `@OnyxiaWatch`, in *Server Settings → Roles*.
2. **Let members give themselves the role.** The easy native way: *Server Settings
   → Onboarding* (or *Channels & Roles*) → add it as a self-assignable/opt-in role.
   Members pick it up in the server's onboarding/roles screen. (A reaction-role bot
   works too, but isn't needed.)
3. **Get the role id:** turn on *Discord → Settings → Advanced → Developer Mode*,
   then right-click the role → **Copy Role ID**.
4. Set `DISCORD_MENTION_ROLE_ID` to that id (in `.env` locally, or Railway
   Variables). Now every **raid entered** and **cleared** post pings only that role
   — so only members who took it get notified. Everyone else can mute the channel.

Tip: put the webhook in a channel that only `@OnyxiaWatch` can see, and
non-subscribers won't even see the posts.

> Want the bot to **DM each subscriber privately** instead of posting in a channel
> at all? That's a bigger change — Discord webhooks can't DM, so it needs a real
> bot application (bot token, a subscriber list, and a `/subscribe` command). Ask
> and I'll add it; the role approach above is the simple, no-extra-infrastructure
> option.

## How it works

```
AuthClient ──SRP6 logon──► session key K
                                │
WorldClient ──auth session(K)──► header cipher on ──► char login ──► in world
                                │
   every ~POLL_INTERVAL (jittered ±15%): CMSG_WHO(zone=2159) ──► SMSG_WHO ──► players
                                │
RaidTracker groups players into cohorts (by guild, or the whole lair) and follows
each roster ──► raid-forming (crossed WOW_MIN_RAID_SIZE) / raid-left (roster empty)
                                │
    formatRaidEvent ──► DiscordWebhookNotifier ──► your channel
```

`/who` returns one flat list of everyone in the zone (all instances merged, capped
at 49 names) with **no instance or raid-group id**, so the only field that can tell
two concurrent raids apart is the guild tag — and even that fails for a pickup raid
whose members are scattered across guilds. `RaidTracker` copes with both via
`WOW_RAID_GROUPING` (default `auto`):

- **`auto`** — a guild that reaches `WOW_MIN_RAID_SIZE` is its own named raid
  (`<Nightfall>`); everyone else, scattered guilds and the unguilded, pools into one
  **pickup** cohort that forms its own raid. So a guild raid and a concurrent pickup
  raid are seen as two.
- **`guild`** — every guild is its own raid; misses a pickup raid spread across guilds.
- **`lair`** — the whole zone is one raid; simplest, never splits concurrents.

Each cohort keeps its roster by name and fires **exactly one alert when it first
reaches the threshold** (~about to start) and **one when that same roster has fully
left** — never on a steady raid poll after poll. Membership churn while a raid is
inside is silent, and a named guild raid stays named even if it dips below the
threshold. The first poll baselines: a raid already in progress reports once with
"already in progress" wording. The startup "bot online" message is off unless
`WOW_ANNOUNCE_STARTUP` is set.

> Two concurrent *pickup* raids still read as one — no `/who` field can separate
> them. And the 49-name cap means two full ~25-player raids (≈50) sit right at the
> limit; three or more undercount. A single raid forming is well under it.

Everything below the network edge is pure and unit-tested. The full handshake →
in-world → `/who` path is covered by an integration test that runs the client
against a scripted mock server speaking the real framed, encrypted wire format
(`src/net/world-client.test.ts`).

### In-game whisper interface

Besides posting to Discord, the bot's character answers whispers and can whisper
alerts to players in-game. Whisper the character:

| command | effect |
|---|---|
| `subscribe` (`sub`, `start`) | opt in to in-game raid alerts |
| `unsubscribe` (`unsub`, `stop`) | opt out |
| `discord <id>` (`discord off`) | link / unlink a Discord user id (auto-subscribes) |
| `mode both` \| `mode offline` | Discord always, or only when your character is offline |
| `status` | the current raid state, right now |
| `me` | your own subscription settings |
| `help` | the command list |

A whisper's packet carries only the sender's **GUID**, so the bot name-queries to
resolve who whispered (and to reply). Outgoing whispers are **throttled** so a raid
alert to many subscribers can't trip the server's spam mute. Subscribers persist in
**MongoDB** (`MONGODB_URI`); without it they live in memory and are lost on restart.
Set `WOW_WHISPERS=false` to disable the whole interface.

**Discord delivery is a personal @mention in the channel**, not a DM: the bot posts
via a webhook, which can't DM users, but an `@mention` still notifies the person
(bypassing channel mute). So a subscriber links their Discord id, and on a raid the
bot pings `<@their-id>` in the alert post. `mode both` pings them every time; `mode
offline` pings them **only when their character is offline in-game** — detected by
the whisper bouncing (`SMSG_CHAT_PLAYER_NOT_FOUND`), with a 60s fallback window.
(A true private DM would need a separate Discord *bot token* and the user allowing
DMs — deliberately not required here.)

> This makes the character actively talk in-game — much more visible and reportable
> than the silent `/who` poller, and a bigger ban risk. It's off with one env var.
> In-game alerts only reach players who are **online** (whispers don't queue);
> Discord stays the reliable channel.

Layout:

| path | what |
|---|---|
| `src/crypto/` | SRP6 client, vanilla header cipher, BigInt/LE helpers |
| `src/net/` | packet codecs (auth + world) and the two socket clients |
| `src/protocol/` | opcodes, the `/who` codec, and the chat / name-query codecs |
| `src/watcher/` | the cohort raid tracker (forming / left events) |
| `src/chat/` | whisper command router and the throttled outgoing-whisper queue |
| `src/subscribers/` | `SubscriberStore` interface + in-memory and MongoDB impls |
| `src/notify/` | `Notifier` interface + Discord webhook + message formatting |
| `src/config.ts`, `src/index.ts` | config validation and the supervisor loop |

---

## Limitations & things that may need live tuning

This bot has **not** been run against Turtle's live servers by its author; the
protocol is implemented from the documented 1.12 (MaNGOS-family) behaviour and
verified end-to-end against a mock. A few spots are where reality most often
differs — turn on `LOG_LEVEL=debug` and watch where the handshake stops:

- **Instanced `/who` visibility** — the make-or-break check above. If instanced
  players don't show, or show a different area id, adjust `WATCH_AREA_ID` or fall
  back to reading the server's on-kill world announcement (a different feature).
- **Warden / anticheat** — if the server pushes `SMSG_WARDEN_DATA`, the bot logs a
  warning and does not respond. A strict warden setup may disconnect it. Vanilla
  chat bots generally survive because private servers often run warden leniently
  or off; if you get repeatedly dropped shortly after login, this is the suspect.
- **Addon block in the auth session** — sent empty by default (MaNGOS cores treat
  it as optional). If login is rejected right after `CMSG_AUTH_SESSION`, a real
  client's addon blob may be required.
- **Realm-list address** — parsed from the auth server's realm list. If that
  address is unreachable (some servers advertise an internal one), set
  `WOW_WORLD_HOST` / `WOW_WORLD_PORT` to bypass it.
- **Multiple characters** — the char-enum parser is bulletproof for the **first**
  character on the account; a second character with an unexpected record layout
  could desync parsing. Use a single-character bot account.
- **Same-faction only**, as noted above.

## Development

```bash
npm test          # run the suite once
npm run test:watch
npm run typecheck  # tsc --noEmit over the whole tree
```

No `any`, no unsafe casts; strict TypeScript throughout.
