import { join } from "node:path";
import { isNotFound } from "@poe-code/config-mutations";
import type { FileSystem } from "../../utils/file-system.js";
import {
  isSymlinkPointingTo,
  type SymlinkOp
} from "./utils-symlink-ops.js";

const CANONICAL_FILE = "AGENTS.md";
const LEGACY_FILE = "CLAUDE.md";
const BOTH_FILES_CONFLICT =
  "both CLAUDE.md and AGENTS.md exist as regular files. Resolve manually: diff the files, keep the one you want as AGENTS.md, then re-run this command.";

export async function planAgentsSymlink(
  fs: FileSystem,
  cwd: string
): Promise<SymlinkOp[]> {
  const agentsPath = join(cwd, CANONICAL_FILE);
  const claudePath = join(cwd, LEGACY_FILE);
  const claudeStats = await tryLstat(fs, claudePath);
  const agentsStats = await tryLstat(fs, agentsPath);

  if (await isSymlinkPointingTo(fs, claudePath, CANONICAL_FILE)) {
    return [{ kind: "noop", reason: "already linked" }];
  }

  if (claudeStats?.isSymbolicLink()) {
    const target = await fs.readlink(claudePath);
    return [
      {
        kind: "conflict",
        message: `CLAUDE.md is already a symlink to ${target}. Remove it or repoint it manually.`
      }
    ];
  }

  if (claudeStats && agentsStats) {
    return [{ kind: "conflict", message: BOTH_FILES_CONFLICT }];
  }

  if (!claudeStats && !agentsStats) {
    return [{ kind: "noop", reason: "no CLAUDE.md or AGENTS.md" }];
  }

  if (!claudeStats && agentsStats) {
    return [{ kind: "symlink", target: CANONICAL_FILE, path: claudePath }];
  }

  return [
    { kind: "rename", from: claudePath, to: agentsPath },
    { kind: "symlink", target: CANONICAL_FILE, path: claudePath }
  ];
}

async function tryLstat(fs: FileSystem, path: string) {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}
