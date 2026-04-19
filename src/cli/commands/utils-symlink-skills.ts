import { join } from "node:path";
import { isNotFound } from "@poe-code/config-mutations";
import type { FileSystem } from "../../utils/file-system.js";
import {
  isSymlinkPointingTo,
  type SymlinkOp
} from "./utils-symlink-ops.js";

export interface SkillsTargets {
  claudeDir: string;
  agentsDir: string;
  relativeTargetFromClaude: string;
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
