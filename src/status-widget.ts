import type { Logger } from "./logger.js";
import type { ChannelMessage, CreateResult, DiscordEmbed, DmResult } from "./notify/discord-dm.js";

/**
 * The live server-status "widget": ONE message in #server-status that the bot keeps edited in place,
 * showing whether the realm is up and healthy at a glance. Two pieces:
 *
 *  - `buildServerStatusEmbed` — pure: a view of the realm's state -> a Discord embed. All wording,
 *    colour and duration formatting live here, unit-tested, so nothing is "a number nobody can check".
 *  - `ServerStatusWidget` — the orchestrator: edits the existing message, creating it only the first
 *    time or if a moderator deleted it. It depends on a narrow `StatusChannel` port (not the Discord
 *    sender directly), so the create-then-edit behaviour is tested with a fake.
 *
 * This is deliberately SEPARATE from the community down/up event posts (which stay in the Onyxia
 * channel with their role pings): the widget answers "what is true now", the alert "something changed".
 */

/** A finished realm outage, for the "last outage" line. */
export interface LastOutage {
  readonly endedAt: number;
  readonly durationMs: number;
}

/** The live realm facts the widget reads at refresh time (from the ServerMonitor + ping samples). */
export interface LiveRealmStatus {
  readonly realm: string;
  readonly up: boolean;
  /** Median recent round-trip from the BOT's host, or null if no pongs have landed in the window. */
  readonly pingMs: number | null;
  /** Whether recent pings are stable + reasonable — only meaningful when `up` and `pingMs` is set. */
  readonly responsive: boolean;
  /** When the current up/down state began (epoch ms), or null if unknown. */
  readonly stateSince: number | null;
  /** When the bot started watching this realm (epoch ms) — for the "watching for" footer. */
  readonly watchingSince: number;
  /** When this snapshot was taken (epoch ms). */
  readonly now: number;
}

/** Everything the embed renders — the live facts plus the persisted last outage. */
export interface ServerStatusView extends LiveRealmStatus {
  readonly lastOutage: LastOutage | null;
}

/** Embed sidebar colours (0xRRGGBB): green up, amber up-but-laggy, red down. */
export const COLOR_UP = 0x2ecc71;
export const COLOR_LAGGY = 0xf1c40f;
export const COLOR_DOWN = 0xe74c3c;

/** Compact human span with day granularity: "under a minute", "42m", "3h20m", "5d", "2d4h". */
export function humanSpan(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  if (totalMin < 1) return "under a minute";
  if (totalMin < 60) return `${totalMin}m`;
  const totalHr = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (totalHr < 24) return remMin === 0 ? `${totalHr}h` : `${totalHr}h${remMin}m`;
  const days = Math.floor(totalHr / 24);
  const remHr = totalHr % 24;
  return remHr === 0 ? `${days}d` : `${days}d${remHr}h`;
}

/** Is the realm up but responding slowly? (Up, with pings that have landed but aren't stable.) */
function isLaggy(view: LiveRealmStatus): boolean {
  return view.up && view.pingMs !== null && !view.responsive;
}

function statusField(view: ServerStatusView): string {
  const word = view.up ? "Online" : "Down";
  if (view.stateSince === null) return word;
  const forHowLong = humanSpan(view.now - view.stateSince);
  return view.up ? `${word}, up ${forHowLong}` : `${word}, ${forHowLong}`;
}

/** The realm-response field is only meaningful while the realm is up. */
function responseField(view: ServerStatusView): string {
  if (view.pingMs === null) return "Checking…";
  const label = view.responsive ? "Responsive" : "Laggy";
  return `${label} (~${view.pingMs} ms)`;
}

function lastOutageField(view: ServerStatusView): string {
  if (view.lastOutage === null) return "None recorded";
  return `${humanSpan(view.now - view.lastOutage.endedAt)} ago · lasted ${humanSpan(view.lastOutage.durationMs)}`;
}

/** Render the current realm state as the widget embed. Pure. */
export function buildServerStatusEmbed(view: ServerStatusView): DiscordEmbed {
  const laggy = isLaggy(view);
  const color = !view.up ? COLOR_DOWN : laggy ? COLOR_LAGGY : COLOR_UP;
  const dot = !view.up ? "🔴" : laggy ? "🟡" : "🟢"; // 🔴 🟡 🟢
  const title = `${dot} ${view.realm} — ${view.up ? (laggy ? "Online (laggy)" : "Online") : "Down"}`;
  const description = !view.up
    ? `The realm is not responding — it looks down.`
    : laggy
      ? `The realm is online but responding slowly.`
      : `The realm is online and responding normally.`;

  const fields: DiscordEmbed["fields"] = [
    { name: "Status", value: statusField(view), inline: true },
    // The realm-response reading is the bot's own host-to-realm ping, not the reader's — labelled so.
    ...(view.up ? [{ name: "Realm response", value: responseField(view), inline: true } as const] : []),
    { name: "Last outage", value: lastOutageField(view), inline: true },
  ];

  return {
    title,
    description,
    color,
    fields,
    footer: { text: `Watching for ${humanSpan(view.now - view.watchingSince)}` },
    timestamp: new Date(view.now).toISOString(),
  };
}

/** Narrow delivery port — create the widget message once, then edit it in place. */
export interface StatusChannel {
  create(message: ChannelMessage): Promise<CreateResult>;
  edit(messageId: string, message: ChannelMessage): Promise<DmResult>;
}

/** The durable state the widget reads/writes (message id, last outage, applied channel name). */
export interface StatusWidgetState {
  readonly messageId: string | null;
  readonly lastOutageEndedAt: number | null;
  readonly lastOutageDurationMs: number | null;
  readonly channelName: string | null;
}

export interface StatusWidgetStore {
  load(): Promise<StatusWidgetState | null>;
  save(state: StatusWidgetState): Promise<void>;
}

/** The channel name for a given up/down state — the status emoji prefixed straight onto the base
 *  name, with NO separator of our own (Discord inserts its own dash after the emoji, so adding one
 *  here produced a double dash "🔴--server-status"). Pure. Only the leading 🟢/🔴 changes; laggy is
 *  deliberately NOT reflected here (it would flap the name against Discord's rename limit), so the
 *  name is coarse up/down and the embed carries the nuance. */
export function statusChannelName(up: boolean, base: string): string {
  return `${up ? "🟢" : "🔴"}${base}`;
}

export interface ServerStatusWidgetDeps {
  readonly channel: StatusChannel;
  readonly store: StatusWidgetStore;
  /** Reads the current live realm facts at render time. */
  readonly snapshot: () => LiveRealmStatus;
  /** Optional: rename the channel to reflect up/down (🟢/🔴). Omitted = embed only, no rename. */
  readonly renameChannel?: (name: string) => Promise<DmResult>;
  /** Base name the rename prefixes the status emoji onto (e.g. "server-status"). */
  readonly channelBaseName?: string;
  readonly logger: Logger;
}

export class ServerStatusWidget {
  readonly #channel: StatusChannel;
  readonly #store: StatusWidgetStore;
  readonly #snapshot: () => LiveRealmStatus;
  readonly #renameChannel: ((name: string) => Promise<DmResult>) | null;
  readonly #channelBaseName: string;
  readonly #logger: Logger;
  #messageId: string | null = null;
  #lastOutage: LastOutage | null = null;
  #channelName: string | null = null; // the channel name last applied by the rename indicator
  /** Serialises refreshes so a startup transition can't race the periodic timer into two posts. */
  #queue: Promise<void> = Promise.resolve();

  constructor(deps: ServerStatusWidgetDeps) {
    this.#channel = deps.channel;
    this.#store = deps.store;
    this.#snapshot = deps.snapshot;
    this.#renameChannel = deps.renameChannel ?? null;
    this.#channelBaseName = deps.channelBaseName ?? "server-status";
    this.#logger = deps.logger;
  }

  /** Load persisted state (message id + last outage). Call once on boot, before the first refresh. */
  async load(): Promise<void> {
    const state = await this.#store.load();
    if (!state) return;
    this.#messageId = state.messageId;
    this.#channelName = state.channelName;
    this.#lastOutage =
      state.lastOutageEndedAt !== null && state.lastOutageDurationMs !== null
        ? { endedAt: state.lastOutageEndedAt, durationMs: state.lastOutageDurationMs }
        : null;
  }

  /** Record a finished outage — persisted, and shown on the next render. */
  async recordOutageEnd(endedAt: number, durationMs: number): Promise<void> {
    this.#lastOutage = { endedAt, durationMs };
    await this.#persist();
    await this.refresh();
  }

  /** Re-render the widget. Edits the existing message; creates it the first time or if it was deleted. */
  refresh(): Promise<void> {
    this.#queue = this.#queue.then(() => this.#render()).catch((error) => {
      this.#logger.error(`server-status widget refresh threw: ${error instanceof Error ? error.message : String(error)}`);
    });
    return this.#queue;
  }

  async #render(): Promise<void> {
    const view: ServerStatusView = { ...this.#snapshot(), lastOutage: this.#lastOutage };
    // The embed and the channel-name indicator are independent surfaces — a failure of one must not
    // skip the other (e.g. Send-Messages missing but Manage-Channels granted, or vice versa).
    await this.#renderEmbed(view);
    await this.#renderChannelName(view);
  }

  async #renderEmbed(view: ServerStatusView): Promise<void> {
    const message: ChannelMessage = { embeds: [buildServerStatusEmbed(view)] };

    if (this.#messageId) {
      const edited = await this.#channel.edit(this.#messageId, message);
      if (edited.ok) return;
      if (edited.kind === "unreachable" && edited.status === 404) {
        this.#logger.warn("server-status widget message is gone; reposting it");
        this.#messageId = null; // fall through to recreate
      } else {
        this.#logger.error(`server-status widget edit failed (${describe(edited)})`);
        return;
      }
    }

    const created = await this.#channel.create(message);
    if (created.ok) {
      this.#messageId = created.messageId;
      await this.#persist();
    } else {
      this.#logger.error(`server-status widget post failed (${describe(created)})`);
    }
  }

  /** Reflect up/down in the channel name — only when rename is configured AND the name would change,
   *  so a normal refresh renames nothing and Discord's ~2/10min rename limit is not a concern. */
  async #renderChannelName(view: ServerStatusView): Promise<void> {
    if (!this.#renameChannel) return;
    const desired = statusChannelName(view.up, this.#channelBaseName);
    if (desired === this.#channelName) return; // already applied — no rename this refresh
    const renamed = await this.#renameChannel(desired);
    if (renamed.ok) {
      this.#channelName = desired;
      await this.#persist();
    } else {
      // Leave #channelName as-is so the next transition/refresh retries (e.g. a 429 backs off).
      this.#logger.error(`server-status channel rename failed (${describe(renamed)})`);
    }
  }

  #persist(): Promise<void> {
    return this.#store.save({
      messageId: this.#messageId,
      lastOutageEndedAt: this.#lastOutage?.endedAt ?? null,
      lastOutageDurationMs: this.#lastOutage?.durationMs ?? null,
      channelName: this.#channelName,
    });
  }
}

function describe(failure: { readonly kind: string; readonly status?: number }): string {
  return failure.status === undefined ? failure.kind : `${failure.kind} ${failure.status}`;
}
