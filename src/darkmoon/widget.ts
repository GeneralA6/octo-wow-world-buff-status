import type {
  ChannelMessage,
  CreateResult,
  DiscordEmbed,
  DiscordEmbedField,
  DmResult,
} from "../notify/discord-dm.js";
import { humanSpan } from "../notify/format.js";
import type { Logger } from "../logger.js";
import type { FaireReport } from "./resolve.js";
import type { DarkmoonWidgetStore } from "./widget-store.js";

/**
 * A live Darkmoon Faire board: ONE message in its own channel, edited in place forever.
 *
 * Edited rather than reposted for the reason the server-status widget was: a channel that posts a
 * fresh message every refresh buries itself, and a redeploy that forgets which message it owns
 * orphans the last one and starts again. The message id is persisted, so a restart keeps editing
 * the same message.
 *
 * The other half of keeping this channel quiet is that a render only reaches Discord when the
 * rendered TEXT changes. The faire moves four times a month and the countdown is coarse (~hourly
 * at day scale), so a five-minute refresh timer produces roughly one edit an hour while a faire is
 * running and none at all in between — instead of 288 a day.
 */

/** Discord embed colours: open, arriving, away. */
const COLOUR_UP = 0x57f287;
const COLOUR_SETTING_UP = 0xfee75c;
const COLOUR_TRAVELLING = 0x5865f2;

/** Where the answer came from, said plainly — the reader gets to judge it for themselves. */
function provenance(report: FaireReport): string {
  if (report.source === "onsite") return "seen by our own character, standing in it";
  if (report.source === "sighting") return "seen by players in-game (PizzaWorldBuffs)";
  switch (report.confirmedBy) {
    case "onsite":
      return "from the schedule — zone confirmed by our own character";
    case "herald":
      return "from the schedule — zone confirmed by a Darkmoon herald";
    case "sighting":
      return "from the schedule — zone confirmed by in-game sightings";
    default:
      return "from the vanilla schedule — zone not yet confirmed on this realm";
  }
}

/** A date a player can act on, in realm-neutral terms: "Mon 5 Oct". */
function shortDate(at: number): string {
  return new Date(at).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function buildFaireEmbed(report: FaireReport, now: number): DiscordEmbed {
  const where = `${report.site.zone} (${report.site.landmark})`;
  const unsure = report.source === "calendar" && report.confirmedBy === null;

  const fields: DiscordEmbedField[] = [];
  let description: string;
  let color: number;

  if (report.phase === "up") {
    color = COLOUR_UP;
    const closes =
      report.closesAt !== null
        ? `Closes in ${humanSpan(report.closesAt - now)}`
        : report.observation !== null
          ? `Last seen ${humanSpan(now - report.observation.observedAt)} ago`
          : "Open now";
    description = `**${where}**\n${unsure ? "Should be open" : "Open now"} · ${closes}`;
  } else if (report.phase === "setting-up") {
    color = COLOUR_SETTING_UP;
    const opens = report.opensAt !== null ? ` · Opens in ${humanSpan(report.opensAt - now)}` : "";
    // Worth its own wording: the tents are there but nobody will take your tickets yet.
    description = `**${where}**\nSetting up — not open for business yet${opens}`;
  } else {
    color = COLOUR_TRAVELLING;
    const opens = report.opensAt !== null ? ` · Opens in ${humanSpan(report.opensAt - now)}` : "";
    description = `Travelling — not in Azeroth right now.\nNext stop **${where}**${opens}`;
  }

  if (report.opensAt !== null && report.closesAt !== null) {
    fields.push({
      name: report.phase === "travelling" ? "Next visit" : "This visit",
      value: `${shortDate(report.opensAt)} – ${shortDate(report.closesAt - 1)}`,
      inline: true,
    });
  }
  if (report.setupAt !== null && report.phase === "travelling") {
    fields.push({ name: "Tents go up", value: shortDate(report.setupAt), inline: true });
  }

  return {
    title: "🎪 Darkmoon Faire",
    description,
    color,
    fields,
    footer: { text: provenance(report) },
    timestamp: new Date(now).toISOString(),
  };
}

/** The two channel operations the board needs — the same shape the status widget uses. */
export interface FaireChannel {
  create(message: ChannelMessage): Promise<CreateResult>;
  edit(messageId: string, message: ChannelMessage): Promise<DmResult>;
}

export interface DarkmoonWidgetDeps {
  readonly channel: FaireChannel;
  readonly store: DarkmoonWidgetStore;
  /** Reads the current answer at render time. */
  readonly report: (now: number) => FaireReport;
  readonly now?: () => number;
  readonly logger: Logger;
}

function describe(result: DmResult | CreateResult): string {
  return result.ok ? "ok" : `${result.kind}${result.status ? ` ${result.status}` : ""}`;
}

export class DarkmoonWidget {
  readonly #deps: DarkmoonWidgetDeps;
  #messageId: string | null = null;
  /** The last text actually sent to Discord — a render that matches it is not worth an API call. */
  #rendered: string | null = null;
  /** Serialises refreshes so a boot paint cannot race the timer into two posted messages. */
  #queue: Promise<void> = Promise.resolve();

  constructor(deps: DarkmoonWidgetDeps) {
    this.#deps = deps;
  }

  /** Load the persisted message id. Call once on boot, before the first refresh. */
  async load(): Promise<void> {
    const state = await this.#deps.store.load();
    this.#messageId = state?.messageId ?? null;
  }

  /** Re-render. Edits the existing message; creates it the first time, or if it was deleted. */
  refresh(): Promise<void> {
    this.#queue = this.#queue
      .then(() => this.#render())
      .catch((error) =>
        this.#deps.logger.error(
          `darkmoon widget refresh threw: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    return this.#queue;
  }

  async #render(): Promise<void> {
    const now = (this.#deps.now ?? Date.now)();
    const embed = buildFaireEmbed(this.#deps.report(now), now);
    // The timestamp moves every render by design, so it is excluded from the comparison — otherwise
    // nothing would ever match and the "only edit on change" saving would be zero.
    const signature = JSON.stringify({ ...embed, timestamp: undefined });
    if (signature === this.#rendered && this.#messageId !== null) return;

    const message: ChannelMessage = { embeds: [embed] };
    if (this.#messageId !== null) {
      const edited = await this.#deps.channel.edit(this.#messageId, message);
      if (edited.ok) {
        this.#rendered = signature;
        return;
      }
      if (edited.kind === "unreachable" && edited.status === 404) {
        this.#deps.logger.warn("darkmoon board message is gone; reposting it");
        this.#messageId = null; // fall through and recreate
      } else {
        this.#deps.logger.error(`darkmoon board edit failed (${describe(edited)})`);
        return;
      }
    }

    const created = await this.#deps.channel.create(message);
    if (!created.ok) {
      this.#deps.logger.error(`darkmoon board post failed (${describe(created)})`);
      return;
    }
    this.#messageId = created.messageId;
    this.#rendered = signature;
    await this.#deps.store.save({ messageId: created.messageId });
  }
}
