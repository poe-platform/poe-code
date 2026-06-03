import path from "node:path";
import { homedir } from "node:os";
import { mkdir, realpath } from "node:fs/promises";

export function getDefaultSpawnLogDir(): string {
  return path.join(homedir(), ".poe-code", "spawn-logs");
}

export async function ensureSafeDefaultSpawnLogDir(create: boolean): Promise<string> {
  const stateDir = path.join(homedir(), ".poe-code");
  const logDir = getDefaultSpawnLogDir();

  if (create) {
    await mkdir(stateDir, { recursive: true });
    await mkdir(logDir, { recursive: true });
  }

  const [canonicalStateDir, canonicalLogDir] = await Promise.all([
    realpath(stateDir),
    realpath(logDir)
  ]);
  const relativeLogDir = path.relative(canonicalStateDir, canonicalLogDir);

  if (
    relativeLogDir === ".." ||
    relativeLogDir.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeLogDir)
  ) {
    throw new Error("Default spawn log directory resolves outside the poe-code state directory.");
  }

  return logDir;
}
