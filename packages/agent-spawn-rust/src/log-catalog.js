import path from "node:path";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { ensureSafeDefaultSpawnLogDir } from "./spawn-log-path.js";
const native = createRequire(import.meta.url)("./agent-spawn-rust.node");
function hasOwnErrorCode(error, code) {
  return error instanceof Error && Object.hasOwn(error, "code") && error.code === code;
}
export async function listSpawnLogs(options = {}) {
  const requestedLimit = options.limit;
  const limit = native.spawnLogCatalogLimit(
    typeof requestedLimit === "number" ? requestedLimit : NaN
  );
  let directory, entries;
  try {
    directory = await ensureSafeDefaultSpawnLogDir(false);
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) return [];
    throw error;
  }
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) return [];
    throw error;
  }
  const logs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const metadata = native.spawnLogCatalogMetadata(entry.name);
    const log = { path: path.join(directory, entry.name), filename: entry.name };
    if (metadata.parsed) {
      log.agent = metadata.agent;
      log.timestamp = metadata.timestamp === undefined ? undefined : new Date(metadata.timestamp);
    }
    if (options.agent && log.agent !== options.agent) continue;
    logs.push(log);
  }
  return native
    .spawnLogCatalogSort(logs.map((log) => log.filename))
    .map((index) => logs[index])
    .slice(0, limit);
}
export async function findLatestLog(agent) {
  const entries = await listSpawnLogs({ agent, limit: Number.MAX_SAFE_INTEGER });
  const index = native.spawnLogCatalogLatest(
    entries.map((entry) => entry.filename),
    entries.map((entry) => entry.timestamp?.getTime() ?? NaN)
  );
  return entries[index]?.path;
}
export async function pickRandomLog(agent) {
  const entries = await listSpawnLogs({ agent });
  if (entries.length === 0) return undefined;
  return entries[Math.floor(Math.random() * entries.length)]?.path;
}
