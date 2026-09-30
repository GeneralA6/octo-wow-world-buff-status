import { connectMongo } from "../mongo-connection.js";
import { MongoBuffStore } from "../watcher/buff-store.js";
import { WARCHIEF_DROPS_COLLECTION } from "../watcher/warchief-tracker.js";
import { parseReplayArgs, replayReport } from "./replay-report.js";
import { MongoSpireSnapshotStore } from "./spire-snapshot-store.js";

/**
 * Offline refinement of the Warchief's Blessing shadow forecast: loads the recorded Blackrock Spire
 * readings and the blessings heard from the bot's MongoDB and replays them. Only reads (opening the
 * stores ensures their indexes, as the bot itself does on boot).
 *
 *   railway run npx tsx src/warchief/replay-cli.ts                 score the current thresholds, 14 days
 *   railway run npx tsx src/warchief/replay-cli.ts --days 30 --runs --context
 *   railway run npx tsx src/warchief/replay-cli.ts --min-run-size 7 --link-gap 8 --window 60
 *   railway run npx tsx src/warchief/replay-cli.ts --min-level 58     leave out players still levelling
 *   railway run npx tsx src/warchief/replay-cli.ts --sweep         rank a grid of thresholds
 *
 * Needs MONGODB_URI (and MONGODB_DB if not the default "onyxiabot") — `railway run` provides them.
 */
async function main(): Promise<void> {
  const args = parseReplayArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is not set");
  const mongo = await connectMongo(uri, process.env.MONGODB_DB?.trim() || "onyxiabot");
  try {
    const to = new Date();
    const from = new Date(to.getTime() - args.days * 86_400_000);
    const snapshots = await (await MongoSpireSnapshotStore.open(mongo.db)).between(from, to);
    const drops = await (await MongoBuffStore.open(mongo.db, undefined, WARCHIEF_DROPS_COLLECTION)).history("horde", 10_000);
    for (const line of replayReport(snapshots, drops.map((drop) => drop.appliedAt.getTime()), args)) console.log(line);
  } finally {
    await mongo.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
