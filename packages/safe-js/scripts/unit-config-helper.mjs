import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const defaultShardMarkerPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../node_modules/.cache/safe-js-shards-done.json"
);

export function writePretestShardCompletion(fileSystem = fs, targetPath = defaultShardMarkerPath) {
  fileSystem.mkdirSync(path.dirname(targetPath), { recursive: true });
  fileSystem.writeFileSync(
    targetPath,
    JSON.stringify({ timestamp: Date.now(), ppid: process.ppid }) + "\n"
  );
}

export function consumePretestShardCompletion(fileSystem = fs, targetPath = defaultShardMarkerPath) {
  const baseExclude = ["**/node_modules/**", "**/dist/**"];
  try {
    if (!fileSystem.existsSync(targetPath)) return baseExclude;
    const raw = JSON.parse(fileSystem.readFileSync(targetPath, "utf8"));
    try {
      fileSystem.unlinkSync(targetPath);
    } catch {
      // A consumed marker may already have been removed by another process.
    }
    if (typeof raw?.timestamp === "number" && Date.now() - raw.timestamp < 60_000) {
      return [...baseExclude, "src/**/*.test.ts", "test/**/*.test.ts"];
    }
  } catch {
    // Missing or invalid markers leave the normal test discovery unchanged.
  }
  return baseExclude;
}
