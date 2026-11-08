import { join } from "node:path";
import type { Command } from "commander";
import { cancel, isCancel, select } from "toolcraft-design";
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

export interface SkillsTargets {
  claudeDir: string;
  agentsDir: string;
  relativeTargetFromClaude: string;
}

interface UtilsSymlinkSkillsOptions {
  cwd?: string;
  global?: boolean;
  local?: boolean;
}

export function registerUtilsSymlinkSkillsCommand(
  parent: Command,
  container: CliContainer
): void {
  parent
    .command("skills")
    .description("Move .claude/skills into .agents/skills and symlink it back.")
    .configureHelp({})
    .option("--dry-run", "Simulate commands without writing changes.")
    .option("--cwd <dir>", "Operate on <dir> instead of the current working directory.")
    .option("--local", "Use local scope (in the current project)")
    .option("--global", "Use global scope (in the user home directory)")
    .option("-y, --yes", "Accept defaults, skip prompts")
    .action(async function (this: Command, options: UtilsSymlinkSkillsOptions) {
      const flags = resolveCommandFlags(this);
      const logger = container.loggerFactory.create({
        dryRun: flags.dryRun,
        verbose: flags.verbose,
        scope: "utils:symlink:skills"
      });

      if (container.env.platform === "win32") {
        logger.error("Symlink commands are not supported on Windows.");
        process.exitCode = 2;
        return;
      }

      if (options.local && options.global) {
        logger.error("Use either --local or --global, not both.");
        process.exitCode = 1;
        return;
      }

      let scope: "local" | "global";
      if (options.local) {
        scope = "local";
      } else if (options.global) {
        scope = "global";
      } else if (flags.assumeYes) {
        scope = "global";
      } else {
        if (process.stdin.isTTY !== true) {
          logger.error(
            "utils symlink skills requires --local, --global, or --yes when running without an interactive TTY."
          );
          process.exitCode = 1;
          return;
        }

        const selected = await select({
          message: "Select scope:",
          options: [
            { value: "global", label: "Global" },
            { value: "local", label: "Local" }
          ]
        });
        if (isCancel(selected)) {
          cancel("Operation cancelled");
          return;
        }
        scope = selected as "local" | "global";
      }

      const targetCwd = options.cwd ?? container.env.cwd;
      const targets = resolveSkillsTargets(scope, {
        cwd: targetCwd,
        homeDir: container.env.homeDir
      });

      try {
        const ops = await planSkillsSymlink(container.fs, targets);
        const result = await applySymlinkOps(container.fs, ops, {
          dryRun: flags.dryRun,
          log: (message) => {
            logger.info(
              formatLoggedPath(message, {
                cwd: targetCwd,
                homeDir: container.env.homeDir
              })
            );
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

export function resolveSkillsTargets(
  scope: "local" | "global",
  env: { cwd: string; homeDir: string }
): SkillsTargets {
  const baseDir = scope === "local" ? env.cwd : env.homeDir;

  return {
    claudeDir: join(baseDir, ".claude", "skills"),
    agentsDir: join(baseDir, ".agents", "skills"),
    relativeTargetFromClaude: "../.agents/skills"
  };
}

export async function planSkillsSymlink(
  fs: FileSystem,
  targets: SkillsTargets
): Promise<SymlinkOp[]> {
  const claudeStats = await tryLstat(fs, targets.claudeDir);
  const agentsStats = await tryLstat(fs, targets.agentsDir);

  if (
    await isSymlinkPointingTo(
      fs,
      targets.claudeDir,
      targets.relativeTargetFromClaude
    )
  ) {
    return [{ kind: "noop", reason: "already linked" }];
  }

  if (claudeStats?.isSymbolicLink()) {
    const target = await fs.readlink(targets.claudeDir);
    return [
      {
        kind: "conflict",
        message: `.claude/skills is already a symlink to ${target}. Remove it or repoint it manually.`
      }
    ];
  }

  if (claudeStats && !claudeStats.isDirectory()) {
    return [
      {
        kind: "conflict",
        message:
          ".claude/skills exists but is not a directory. Resolve manually: move or remove it, then re-run this command."
      }
    ];
  }

  if (agentsStats && !agentsStats.isDirectory() && !agentsStats.isSymbolicLink()) {
    return [
      {
        kind: "conflict",
        message:
          ".agents/skills exists but is not a directory or symlink. Resolve manually: move or remove it, then re-run this command."
      }
    ];
  }

  if (claudeStats && agentsStats) {
    return [
      {
        kind: "conflict",
        message:
          "both .claude/skills and .agents/skills exist. Resolve manually: move the files you want to keep into .agents/skills, remove .claude/skills, then re-run this command."
      }
    ];
  }

  if (!claudeStats && !agentsStats) {
    return [{ kind: "noop", reason: "no .claude/skills found — nothing to do" }];
  }

  if (!claudeStats && agentsStats) {
    return [
      {
        kind: "symlink",
        target: targets.relativeTargetFromClaude,
        path: targets.claudeDir
      }
    ];
  }

  return [
    { kind: "rename", from: targets.claudeDir, to: targets.agentsDir },
    {
      kind: "symlink",
      target: targets.relativeTargetFromClaude,
      path: targets.claudeDir
    }
  ];
}
