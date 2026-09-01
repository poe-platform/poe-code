import path from "node:path";
import { readFile, stat, lstat, mkdir, writeFile, rename, unlink, readdir, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { S, UserError, defineCommand } from "toolcraft";
import {
  planConfigScope,
  readMergedDocument,
  resolveConfigPath,
  resolveProjectConfigPath,
  resolveScope
} from "@poe-code/poe-code-config/core";
import {
  installSkill,
  resolveAgentSupport,
  type SkillScope
} from "@poe-code/agent-skill-config";
import { skillPlanConfigSection } from "@poe-code/agent-harness-tools";
import { hasOwnErrorCode } from "../error-codes.js";

const fs = {
  readFile: (p: string, encoding: "utf8") => readFile(p, encoding),
  writeFile: (p: string, content: string) => writeFile(p, content),
  mkdir: (p: string, options?: { recursive: boolean }) => mkdir(p, options).then(() => undefined) as Promise<void>,
  rename: (oldPath: string, newPath: string) => rename(oldPath, newPath),
  unlink: (p: string) => unlink(p),
  stat: (p: string) => stat(p).then((s) => ({ mode: s.mode })),
  lstat: (p: string) => lstat(p).then((s) => ({ isSymbolicLink: () => s.isSymbolicLink() })),
  readdir: (p: string) => readdir(p),
  chmod: (p: string, mode: number) => chmod(p, mode)
};

export type InstallResult = {
  agent: string;
  scope: SkillScope;
  skillPath: string;
  planDirectory: string;
  planDirectoryCreated: boolean;
  dryRun?: true;
};

const installParams = S.Object({
  agent: S.String({
    default: "claude-code",
    description: "Agent to install the Superintendent skill for (claude-code, codex, opencode)"
  }),
  scope: S.Enum(["local", "global"] as const, {
    default: "local",
    description: "Install scope"
  }),
  force: S.Optional(S.Boolean({
    description: "Overwrite an existing Superintendent skill"
  })),
  dryRun: S.Optional(S.Boolean({
    description: "Preview install without writing changes",
    scope: ["cli", "sdk"],
    global: true
  }))
});

export const installCommand = defineCommand({
  name: "install",
  description: "Install the Superintendent /superintendent skill and scaffold the shared plan directory.",
  positional: ["agent"],
  params: installParams,
  scope: ["cli", "sdk"],
  handler: async ({ params }) => {
    const cwd = process.cwd();
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? cwd;
    const scope = params.scope as SkillScope;

    const support = resolveAgentSupport(params.agent);
    if (support.status !== "supported" || !support.id) {
      throw new UserError(`Unsupported agent: ${params.agent}`);
    }

    const skillContent = params.dryRun === true ? "" : await loadSkillTemplate();
    const skillResult = await installSkill(
      support.id,
      {
        name: "poe-code-superintendent-plan",
        content: skillContent + "\n\n" + skillPlanConfigSection("superintendent")
      },
      {
        fs,
        cwd,
        homeDir,
        scope,
        ...(params.force === true ? { force: true } : {}),
        ...(params.dryRun === true ? { dryRun: true } : {})
      }
    );

    const planDirectory = await resolvePlanDirectory(cwd, homeDir, process.env);
    const absolutePlanDirectory = resolveAbsoluteDirectory(planDirectory, cwd, homeDir);
    const planDirectoryCreated = await ensurePlanDirectory(
      absolutePlanDirectory,
      fs,
      params.dryRun === true
    );

    return {
      agent: support.id,
      scope,
      skillPath: skillResult.displayPath,
      planDirectory,
      planDirectoryCreated,
      ...(params.dryRun === true ? { dryRun: true as const } : {})
    } satisfies InstallResult;
  },
  render: {
    rich: (result, { logger }) => {
      logger.success(result.dryRun === true
        ? `Would install Superintendent skill for ${result.agent} (${result.scope}).`
        : `Installed Superintendent skill for ${result.agent} (${result.scope}).`);
      logger.message(`${result.dryRun === true ? "Would create" : "Skill"}: ${result.skillPath}`);
      if (result.planDirectoryCreated) {
        logger.message(`${result.dryRun === true ? "Would create" : "Created"}: ${result.planDirectory}`);
      }
    },
    markdown: (result) => {
      const lines = [
        "## Superintendent install",
        "",
        `- Agent: ${result.agent}`,
        `- Scope: ${result.scope}`,
        `- Skill: ${result.skillPath}`,
        ...(result.dryRun === true ? ["- Dry run: true"] : [])
      ];

      if (result.planDirectoryCreated) {
        lines.push(`- ${result.dryRun === true ? "Would create" : "Created"}: ${result.planDirectory}`);
      }

      return lines.join("\n");
    },
    json: (result) => result
  }
});

async function resolvePlanDirectory(
  cwd: string,
  homeDir: string,
  env: Record<string, string | undefined>
): Promise<string> {
  const configPath = resolveConfigPath(homeDir);
  const projectConfigPath = resolveProjectConfigPath(cwd);
  const document = await readMergedDocument(fs, configPath, projectConfigPath);
  return resolveScope(planConfigScope.schema, document.plan, env).plan_directory;
}

function resolveAbsoluteDirectory(dir: string, cwd: string, homeDir: string): string {
  if (dir.startsWith("~/")) {
    return path.join(homeDir, dir.slice(2));
  }

  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

type PlanDirectoryFs = {
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  mkdir(path: string, options?: { recursive: boolean }): Promise<void>;
};

export async function ensurePlanDirectory(
  absolutePlanDirectory: string,
  fileSystem: PlanDirectoryFs,
  dryRun = false
): Promise<boolean> {
  const missingAncestors: string[] = [];
  let currentPath = absolutePlanDirectory;

  while (true) {
    try {
      if ((await fileSystem.lstat(currentPath)).isSymbolicLink()) {
        throw new UserError(`Refusing to create superintendent plan directory through symbolic link: ${currentPath}`);
      }
      break;
    } catch (error) {
      if (!hasOwnErrorCode(error, "ENOENT")) {
        throw error;
      }
      missingAncestors.push(currentPath);
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  if (missingAncestors.length === 0) {
    return false;
  }
  if (!dryRun) {
    await fileSystem.mkdir(absolutePlanDirectory, { recursive: true });
  }
  return true;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

let skillTemplateCache: string | null = null;

async function loadSkillTemplate(): Promise<string> {
  if (skillTemplateCache) {
    return skillTemplateCache;
  }

  const packageRoot = await findPackageRoot(fileURLToPath(import.meta.url));
  const templateRoots = [
    path.join(packageRoot, "src", "templates"),
    path.join(packageRoot, "dist", "templates")
  ];

  for (const templateRoot of templateRoots) {
    if (!(await pathExists(templateRoot))) {
      continue;
    }

    skillTemplateCache = await readFile(
      path.join(templateRoot, "SKILL_superintendent.md"),
      "utf8"
    );

    return skillTemplateCache;
  }

  throw new Error("Unable to locate Superintendent skill template.");
}

async function findPackageRoot(entryFilePath: string): Promise<string> {
  let currentPath = path.dirname(entryFilePath);

  while (true) {
    if (await pathExists(path.join(currentPath, "package.json"))) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error("Unable to locate package root for Superintendent templates.");
    }

    currentPath = parentPath;
  }
}
