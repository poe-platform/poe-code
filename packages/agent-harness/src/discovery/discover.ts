import nodeFs from "node:fs/promises";
import { join } from "node:path";

import { hasOwnErrorCode } from "../error-codes.js";
import { MissingPairError, resolvePair, type HarnessFs, type HarnessPair } from "../loader/pair.js";

type DirectoryEntry = string | { name: string; isDirectory(): boolean };

function isMissingDirectory(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}

export async function discoverHarnesses(
  rootDir: string,
  fs: HarnessFs = nodeFs
): Promise<HarnessPair[]> {
  if (!fs.readdir) {
    throw new Error("discoverHarnesses requires a filesystem with readdir support");
  }

  let entries: DirectoryEntry[];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) {
      return [];
    }
    throw error;
  }

  const pairs: HarnessPair[] = [];
  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry.name;
    if (typeof entry !== "string" && !entry.isDirectory()) {
      continue;
    }

    if (typeof entry === "string") {
      const stat = await fs.stat(join(rootDir, entry));
      if (!stat.isDirectory?.()) {
        continue;
      }
    }

    try {
      pairs.push(await resolvePair(join(rootDir, name, `${name}.md`), fs));
    } catch (error) {
      if (error instanceof MissingPairError) {
        continue;
      }
      throw error;
    }
  }

  return pairs.sort((left, right) => left.basename.localeCompare(right.basename));
}
