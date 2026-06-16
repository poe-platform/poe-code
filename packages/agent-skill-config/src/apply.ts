import { fileMutation, runMutations, templateMutation } from "@poe-code/config-mutations";
import { resolveAgentSupport } from "./configs.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { createTemplateLoader } from "./templates.js";
import type { ApplyOptions, SkillFile } from "./types.js";

export class UnsupportedAgentError extends Error {
  constructor(agentId: string) {
    super(`Unsupported agent: ${agentId}`);
    this.name = "UnsupportedAgentError";
  }
}

function toHomeRelative(localSkillDir: string): string {
  if (localSkillDir.startsWith("~/") || localSkillDir === "~") {
    return localSkillDir;
  }

  const normalized = localSkillDir.startsWith("./")
    ? localSkillDir.slice(2)
    : localSkillDir;

  return `~/${normalized}`;
}

const bundledSkillTemplateIds = ["poe-generate.md"] as const;

async function pathExists(fs: ApplyOptions["fs"], targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

export async function configure(agentId: string, options: ApplyOptions): Promise<void> {
  const support = resolveAgentSupport(agentId);
  if (support.status !== "supported") {
    throw new UnsupportedAgentError(agentId);
  }

  const scope = options.scope ?? "global";
  const config = support.config!;

  const skillDir =
    scope === "global" ? config.globalSkillDir : toHomeRelative(config.localSkillDir);
  const homeDir = scope === "global" ? options.homeDir : options.cwd;
  const templateLoader = createTemplateLoader();

  for (const templateId of bundledSkillTemplateIds) {
    const targetPath = `${scope === "global" ? options.homeDir : options.cwd}/${skillDir.slice(2)}/${templateId}`;
    if (await pathExists(options.fs, targetPath)) {
      const existing = await options.fs.readFile(targetPath, "utf8");
      if (existing !== (await templateLoader(templateId))) {
        throw new Error(`Skill already exists: ${targetPath}`);
      }
    }
  }

  await runMutations(
    [
      fileMutation.ensureDirectory({
        path: skillDir,
        label: `Ensure directory ${skillDir}`
      }),
      ...bundledSkillTemplateIds.map((templateId) =>
        templateMutation.write({
          target: `${skillDir}/${templateId}`,
          templateId,
          label: `Write bundled skill ${templateId} to ${skillDir}`
        })
      )
    ],
    {
      fs: options.fs,
      homeDir,
      dryRun: options.dryRun,
      observers: options.observers,
      templates: templateLoader
    }
  );
}

export async function unconfigure(
  agentId: string,
  options: ApplyOptions & { force?: boolean }
): Promise<void> {
  const support = resolveAgentSupport(agentId);
  if (support.status !== "supported") {
    throw new UnsupportedAgentError(agentId);
  }

  const scope = options.scope ?? "global";
  const config = support.config!;

  const skillDir =
    scope === "global" ? config.globalSkillDir : toHomeRelative(config.localSkillDir);
  const homeDir = scope === "global" ? options.homeDir : options.cwd;
  const templateLoader = createTemplateLoader();
  const removeBundledSkills = [];

  for (const templateId of bundledSkillTemplateIds) {
    const targetPath = `${scope === "global" ? options.homeDir : options.cwd}/${skillDir.slice(2)}/${templateId}`;
    if (await pathExists(options.fs, targetPath)) {
      const existing = await options.fs.readFile(targetPath, "utf8");
      if (existing === (await templateLoader(templateId))) {
        removeBundledSkills.push(
          fileMutation.remove({
            target: `${skillDir}/${templateId}`,
            label: `Remove bundled skill ${templateId} from ${skillDir}`
          })
        );
      }
    }
  }

  await runMutations(
    [
      ...removeBundledSkills,
      fileMutation.removeDirectory({
        path: skillDir,
        force: options.force,
        label: `Remove skills directory ${skillDir}`
      })
    ],
    {
      fs: options.fs,
      homeDir,
      dryRun: options.dryRun,
      observers: options.observers
    }
  );
}

export type InstallSkillOptions = {
  fs: ApplyOptions["fs"];
  cwd: string;
  homeDir: string;
  scope: ApplyOptions["scope"];
  dryRun?: boolean;
  observers?: ApplyOptions["observers"];
};

export type InstallSkillResult = {
  skillPath: string;
  displayPath: string;
};

const SKILL_TEMPLATE_ID = "__skill_content__";

/**
 * Install a skill for an agent.
 * Creates folder structure: skillDir/<skill.name>/SKILL.md
 */
export async function installSkill(
  agentId: string,
  skill: SkillFile,
  options: InstallSkillOptions
): Promise<InstallSkillResult> {
  const support = resolveAgentSupport(agentId);
  if (support.status !== "supported") {
    throw new UnsupportedAgentError(agentId);
  }

  const scope = options.scope ?? "local";
  const config = support.config!;

  if (
    skill.name.length === 0 ||
    skill.name !== skill.name.trim() ||
    skill.name === "." ||
    skill.name === ".." ||
    skill.name.includes("/") ||
    skill.name.includes("\\") ||
    skill.name.includes("\n") ||
    skill.name.includes("\r")
  ) {
    throw new Error(`Invalid skill name: ${skill.name}`);
  }

  // Use home-relative paths for mutations (same pattern as configure/unconfigure)
  const skillDir =
    scope === "global" ? config.globalSkillDir : toHomeRelative(config.localSkillDir);
  const skillFolderPath = `${skillDir}/${skill.name}`;
  const skillFilePath = `${skillFolderPath}/SKILL.md`;
  const displayPath = `${scope === "global" ? config.globalSkillDir : config.localSkillDir}/${skill.name}/SKILL.md`;
  const absoluteSkillPath = `${scope === "global" ? options.homeDir : options.cwd}/${skillFilePath.slice(2)}`;

  if (await pathExists(options.fs, absoluteSkillPath)) {
    throw new Error(`Skill already exists: ${displayPath}`);
  }

  await runMutations(
    [
      fileMutation.ensureDirectory({
        path: skillFolderPath,
        label: `Ensure skill directory ${skill.name}`
      }),
      templateMutation.write({
        target: skillFilePath,
        templateId: SKILL_TEMPLATE_ID,
        label: `Write skill ${skill.name}`
      })
    ],
    {
      fs: options.fs,
      homeDir: scope === "global" ? options.homeDir : options.cwd,
      dryRun: options.dryRun,
      observers: options.observers,
      templates: async (templateId) => {
        if (templateId === SKILL_TEMPLATE_ID) {
          return skill.content;
        }
        throw new Error(`Unknown template: ${templateId}`);
      }
    }
  );

  return { skillPath: absoluteSkillPath, displayPath };
}
