import path from "node:path";
import {
  installSkill,
  resolveAgentSupport,
  resolveSkillDir,
  type SkillFile,
  type SkillScope
} from "@poe-code/agent-skill-config";
import type { CliContainer } from "../container.js";
import type { ScopedLogger } from "../logger.js";
import { ValidationError } from "../errors.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import { renderUnifiedDiff } from "../../utils/dry-run.js";

export type SkillInstallOutcome = "created" | "overwritten" | "skipped";

export interface InstallSkillFileOptions {
  container: CliContainer;
  logger: ScopedLogger;
  agentId: string;
  skill: SkillFile;
  scope: SkillScope;
  force: boolean;
  dryRun: boolean;
}

async function readFileIfExists(
  fs: CliContainer["fs"],
  filePath: string
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

/**
 * Install a skill for an install command under one shared policy: an existing
 * SKILL.md is skipped rather than treated as an error, --force overwrites it,
 * and a forced overwrite is always preceded by a diff of what is replaced.
 */
export async function installSkillFile(
  options: InstallSkillFileOptions
): Promise<SkillInstallOutcome> {
  const support = resolveAgentSupport(options.agentId);
  if (support.status !== "supported" || !support.config) {
    throw new ValidationError(`Unsupported agent: ${options.agentId}`);
  }

  const { container, logger, skill, scope, dryRun } = options;
  const skillDir = scope === "global" ? support.config.globalSkillDir : support.config.localSkillDir;
  const displayPath = `${skillDir}/${skill.name}/SKILL.md`;
  const skillPath = path.join(
    resolveSkillDir(support.config, scope, container.env.cwd, container.env.homeDir),
    skill.name,
    "SKILL.md"
  );
  const previousContent = await readFileIfExists(container.fs, skillPath);

  if (previousContent !== null && !options.force) {
    logger.info(`Skip: ${displayPath} (already exists)`);
    return "skipped";
  }

  if (previousContent !== null) {
    logger.info(renderUnifiedDiff(displayPath, previousContent, skill.content).join("\n"));
  }

  await installSkill(options.agentId, skill, {
    fs: container.fs,
    cwd: container.env.cwd,
    homeDir: container.env.homeDir,
    scope,
    dryRun,
    force: options.force
  });

  if (previousContent !== null) {
    logger[dryRun ? "dryRun" : "info"](
      dryRun ? `Would overwrite: ${displayPath}` : `Overwrite: ${displayPath}`
    );
    return "overwritten";
  }

  logger[dryRun ? "dryRun" : "info"](
    dryRun ? `Would create: ${displayPath}` : `Create: ${displayPath}`
  );
  return "created";
}
