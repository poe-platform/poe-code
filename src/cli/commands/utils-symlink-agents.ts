import { join } from "node:path";
import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { resolveCommandFlags } from "./shared.js";
import {
  applySymlinkOps,
  formatLoggedPath,
  isPermissionError,
  isSymlinkPointingTo,
  tryLstat,
  type SymlinkOp
} from "./utils-symlink-ops.js";

const CANONICAL_FILE = "AGENTS.md";
const LEGACY_FILE = "CLAUDE.md";
const BOTH_FILES_CONFLICT =
  "both CLAUDE.md and AGENTS.md exist as regular files. Resolve manually: diff the files, keep the one you want as AGENTS.md, then re-run this command.";

interface UtilsSymlinkAgentsOptions {
  cwd?: string;
}

export function registerUtilsSymlinkAgentsCommand(
  parent: Command,
  container: CliContainer
): void {
  parent
    .command("agents")
    .description("Symlink CLAUDE.md <- AGENTS.md (AGENTS.md is canonical).")
    .configureHelp({})
    .option("--dry-run", "Simulate commands without writing changes.")
    .option("--cwd <dir>", "Operate on <dir> instead of the current working directory.")
    .action(async function (this: Command, options: UtilsSymlinkAgentsOptions) {
      const flags = resolveCommandFlags(this);
      const logger = container.loggerFactory.create({
        dryRun: flags.dryRun,
        verbose: flags.verbose,
        scope: "utils:symlink:agents"
      });

      if (container.env.platform === "win32") {
        logger.error("Symlink commands are not supported on Windows.");
        process.exitCode = 2;
        return;
      }

      const targetCwd = options.cwd ?? container.env.cwd;

      try {
        const ops = await planAgentsSymlink(container.fs, targetCwd);
        const result = await applySymlinkOps(container.fs, ops, {
          dryRun: flags.dryRun,
          log: (message) => {
            logger.info(formatLoggedPath(message, { cwd: targetCwd, homeDir: container.env.homeDir }));
          }
        });

        process.exitCode = result.conflicts > 0 ? 1 : 0;
      } catch (error) {
        if (isPermissionError(error)) {
          logger.error(error.message);
          process.exitCode = 2;
          return;
        }

        throw error;
      }
    });
}

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

  if (claudeStats && !claudeStats.isFile()) {
    return [
      {
        kind: "conflict",
        message:
          "CLAUDE.md exists but is not a regular file. Resolve manually: move or remove it, then re-run this command."
      }
    ];
  }

  if (agentsStats && !agentsStats.isFile() && !agentsStats.isSymbolicLink()) {
    return [
      {
        kind: "conflict",
        message:
          "AGENTS.md exists but is not a regular file or symlink. Resolve manually: move or remove it, then re-run this command."
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
