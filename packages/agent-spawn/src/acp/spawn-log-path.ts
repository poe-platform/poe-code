import path from "node:path";
import { homedir } from "node:os";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { hasOwnErrorCode } from "../error-codes.js";

export function getDefaultSpawnLogDir(): string {
  return path.join(homedir(), ".poe-code", "spawn-logs");
}

export async function ensureSafeDefaultSpawnLogDir(create: boolean): Promise<string> {
  const stateDir = path.join(homedir(), ".poe-code");
  const logDir = getDefaultSpawnLogDir();

  if (create) {
    await assertNotSymbolicLink(stateDir);
    await mkdir(stateDir, { recursive: true });
    await assertNotSymbolicLink(stateDir);
    await assertNotSymbolicLink(logDir);
    await mkdir(logDir, { recursive: true });
    await assertNotSymbolicLink(logDir);
  } else {
    await assertNotSymbolicLink(stateDir);
    await assertNotSymbolicLink(logDir);
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

async function assertNotSymbolicLink(targetPath: string): Promise<void> {
  try {
    if ((await lstat(targetPath)).isSymbolicLink()) {
      throw new Error(`Default spawn log path may not contain symbolic links: ${targetPath}`);
    }
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}
