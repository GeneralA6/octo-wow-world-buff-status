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

```bash
npm start                 # runs src/index.ts via tsx
LOG_LEVEL=debug npm start  # verbose: prints each /who and the raw counts
```

To keep it running 24/7, use a process manager (e.g. `pm2 start "npm start"
--name onyxia-bot`) or a systemd service. The bot reconnects on its own if the
link drops.

You should get an "👁️ Watching Onyxia's Lair" message in Discord on startup, a
"🐉 Raid entered" when a group appears, and a "✅ cleared" when they leave.

---

## How it works

```
AuthClient ──SRP6 logon──► session key K
                                │
WorldClient ──auth session(K)──► header cipher on ──► char login ──► in world
                                │
     every POLL_INTERVAL: CMSG_WHO(zone=2159) ──► SMSG_WHO ──► players in the lair
                                │
OnyxiaWatcher diffs successive snapshots ──► entered / left / roster-changed
                                │
       formatEvent ──► DiscordWebhookNotifier ──► your channel
```

Everything below the network edge is pure and unit-tested. The full handshake →
in-world → `/who` path is covered by an integration test that runs the client
against a scripted mock server speaking the real framed, encrypted wire format
(`src/net/world-client.test.ts`).

Layout:

| path | what |
|---|---|
| `src/crypto/` | SRP6 client, vanilla header cipher, BigInt/LE helpers |
| `src/net/` | packet codecs (auth + world) and the two socket clients |
| `src/protocol/` | opcodes and the `/who` request/response codec |
| `src/watcher/` | roster-diff → events |
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
