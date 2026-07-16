import type { Command } from "commander";
import * as path from "node:path";
import { select, isCancel, cancel, getTheme, renderTable } from "toolcraft-design";
import { formatAgentCapabilityError, listAgentsWithCapability } from "@poe-code/agent-defs";
import type { CliContainer } from "../container.js";
import {
  supportedAgents,
  configure,
  getAgentConfig,
  installSkill,
  resolveSkillDir,
  resolveSkillReference,
  unconfigure,
  resolveAgentSupport,
  type SkillResolutionFailure,
  type SkillScope
} from "@poe-code/agent-skill-config";
import {
  announceAssumedScope,
  createExecutionResources,
  resolveAssumedDefaultAgent,
  resolveCommandFlags
} from "./shared.js";
import type { ScopedLogger } from "../logger.js";
import { throwCommandNotFound } from "../command-not-found.js";
import { ValidationError } from "../errors.js";
import { UserError } from "@poe-code/user-error";

interface SkillCommandOptions {
  local?: boolean;
  global?: boolean;
  yes?: boolean;
}

interface SkillInstallCommandOptions extends SkillCommandOptions {
  name: string;
  file: string;
}

interface SkillBridgeCommandOptions {
  agent?: string;
  yes?: boolean;
}

interface InstalledSkill {
  ref: string;
  scope: SkillScope;
  skillPath: string;
}

/** Aliases included so the list matches what `configure --help` advertises. */
function skillAgentHelpList(): string {
  return listAgentsWithCapability("skill", { includeAliases: true }).join(" | ");
}

async function resolveSkillAgent(input: {
  agentArg: string | undefined;
  container: CliContainer;
  flags: ReturnType<typeof resolveCommandFlags>;
  promptMessage: string;
  logger: ScopedLogger;
}): Promise<string | undefined> {
  if (input.agentArg) {
    return input.agentArg;
  }

  if (input.flags.assumeYes) {
    return await resolveAssumedDefaultAgent({
      container: input.container,
      logger: input.logger,
      readOnly: input.flags.dryRun
    });
  }

  assertInteractivePromptAvailable(
    "Skill agent selection requires an agent or --yes when running without an interactive TTY."
  );

  const selected = await select({
    message: input.promptMessage,
    options: supportedAgents.map((agent) => ({ value: agent, label: agent }))
  });
  if (isCancel(selected)) {
    cancel("Operation cancelled");
    return undefined;
  }
  return selected as string;
}

function assertInteractivePromptAvailable(message: string): void {
  if (process.stdin.isTTY !== true) {
    throw new ValidationError(message);
  }
}

async function executeSkillList(
  program: Command,
  container: CliContainer,
  agentArg: string | undefined,
  options: SkillCommandOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "skill:list");
  const scopes = resolveScopes(options);
  const agentIds = agentArg ? [requireSkillAgentId(agentArg)] : [...supportedAgents];

  resources.logger.intro("skill list");

  const { skills, searchedDirs } = await collectInstalledSkills(container, agentIds, scopes);

  if (skills.length === 0) {
    resources.logger.info(
      [
        `No skills installed for ${agentIds.join(", ")}. Searched:`,
        ...searchedDirs.map((dir) => `- ${formatSkillPath(container, dir)}`),
        "Install one with poe-code skill install <agent> --name <name> --file <path>."
      ].join("\n")
    );
    return;
  }

  const theme = getTheme();
  resources.logger.info(
    renderTable({
      theme,
      columns: [
        { name: "Skill", title: "Skill", alignment: "left", maxLen: 36 },
        { name: "Scope", title: "Scope", alignment: "left", maxLen: 8 },
        { name: "Path", title: "Path", alignment: "left", maxLen: 44 }
      ],
      rows: skills.map((installed) => ({
        Skill: theme.accent(installed.ref),
        Scope: installed.scope,
        Path: formatSkillPath(container, installed.skillPath)
      }))
    })
  );
}

function formatSkillPath(container: CliContainer, filePath: string): string {
  const relative = path.relative(container.env.cwd, filePath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : filePath.replace(container.env.homeDir, "~");
}

function requireSkillAgentId(agent: string): string {
  const support = resolveAgentSupport(agent);
  if (support.status !== "supported" || !support.id) {
    throw new ValidationError(formatAgentCapabilityError({ agent, capability: "skill" }));
  }
  return support.id;
}

function resolveScopes(options: SkillCommandOptions): SkillScope[] {
  if (options.local && options.global) {
    throw new ValidationError("Use either --local or --global, not both.");
  }
  if (options.local) {
    return ["local"];
  }
  if (options.global) {
    return ["global"];
  }
  return ["local", "global"];
}

/** Directory entries are skills; SKILL.md files sitting loose in the root are not. */
async function collectInstalledSkills(
  container: CliContainer,
  agentIds: string[],
  scopes: SkillScope[]
): Promise<{ skills: InstalledSkill[]; searchedDirs: string[] }> {
  const skills: InstalledSkill[] = [];
  const searchedDirs: string[] = [];

  for (const agentId of agentIds) {
    const config = getAgentConfig(agentId);
    if (!config) {
      continue;
    }

    for (const scope of scopes) {
      const skillDir = resolveSkillDir(config, scope, container.env.cwd, container.env.homeDir);
      searchedDirs.push(skillDir);

      let entries: string[];
      try {
        entries = await container.fs.readdir(skillDir);
      } catch {
        continue;
      }

      for (const entry of [...entries].sort()) {
        const skillPath = path.join(skillDir, entry);
        const stats = await container.fs.stat(skillPath).catch(() => undefined);
        if (stats?.isDirectory() !== true) {
          continue;
        }
        skills.push({ ref: `${agentId}/${entry}`, scope, skillPath });
      }
    }
  }

  return { skills, searchedDirs };
}

function formatUnresolvedRefs(failures: SkillResolutionFailure[]): string {
  const lines = [`Could not resolve ${failures.length} skill reference(s).`];

  for (const failure of failures) {
    if (failure.kind === "malformed") {
      lines.push(`- ${failure.ref}: malformed reference, expected "<name>" or "<agentId>/<name>".`);
      continue;
    }
    if (failure.kind === "unknown-agent") {
      lines.push(
        `- ${failure.ref}: ${formatAgentCapabilityError({ agent: failure.agentInput, capability: "skill" })}`
      );
      continue;
    }
    lines.push(`- ${failure.ref}: not found, searched paths:`);
    for (const searchedPath of failure.searchedPaths) {
      lines.push(`  - ${searchedPath}`);
    }
  }

  return lines.join("\n");
}

export function registerSkillCommand(program: Command, container: CliContainer): void {
  const skill = program
    .command("skill")
    // spawn teaches the plural through --skill/--skills, so "skills" must not be an unknown command.
    .alias("skills")
    .description("Skill directory commands.")
    .allowExcessArguments()
    .action(async function (this: Command) {
      if (this.args.length > 0) {
        throwCommandNotFound({
          container,
          scope: "skill",
          unknownCommand: this.args.at(0) ?? "",
          helpArgs: ["skill", "--help"],
          moduleUrl: import.meta.url
        });
      }
      await executeSkillList(program, container, undefined, {});
    });

  skill
    .command("install")
    .description("Install an arbitrary skill for an agent.")
    .argument("[agent]", `Agent to install the skill for (${skillAgentHelpList()})`)
    .requiredOption("--name <name>", "Skill folder name to install")
    .requiredOption("--file <path>", "Path to a SKILL.md file to install")
    .option("-y, --yes", "Accept defaults, skip prompts")
    .option("--local", "Use local scope (in the current project)")
    .option("--global", "Use global scope (in the user home directory)")
    .action(async (agentArg: string | undefined, options: SkillInstallCommandOptions) => {
      const rootFlags = resolveCommandFlags(program);
      const flags = {
        ...rootFlags,
        assumeYes: rootFlags.assumeYes || Boolean(options.yes)
      };
      const resources = createExecutionResources(container, flags, "skill");

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      const agent = await resolveSkillAgent({
        agentArg,
        container,
        flags,
        promptMessage: "Select agent to install skill for:",
        logger: resources.logger
      });
      if (!agent) {
        return;
      }

      const support = resolveAgentSupport(agent);
      if (support.status !== "supported") {
        throw new ValidationError(formatAgentCapabilityError({ agent, capability: "skill" }));
      }

      let scope: SkillScope;
      if (options.local) {
        scope = "local";
      } else if (options.global) {
        scope = "global";
      } else if (flags.assumeYes) {
        scope = "local";
        announceAssumedScope(resources.logger, scope);
      } else {
        assertInteractivePromptAvailable(
          "Skill scope selection requires --local, --global, or --yes when running without an interactive TTY."
        );
        const selected = await select({
          message: "Select scope:",
          options: [
            { value: "local", label: "Local" },
            { value: "global", label: "Global" }
          ]
        });
        if (isCancel(selected)) {
          cancel("Operation cancelled");
          return;
        }
        scope = selected as SkillScope;
      }

      const resolvedAgent = support.id ?? agent;
      const sourcePath = path.isAbsolute(options.file)
        ? options.file
        : path.resolve(container.env.cwd, options.file);
      if (!(await container.fs.stat(sourcePath).catch(() => undefined))) {
        throw new UserError(
          `Skill file not found: ${sourcePath}\nPass --file <path> pointing at an existing SKILL.md.`
        );
      }
      const content = await container.fs.readFile(sourcePath, "utf8");

      resources.logger.intro(`skill install ${resolvedAgent}`);

      const result = await installSkill(
        resolvedAgent,
        {
          name: options.name,
          content
        },
        {
          fs: container.fs,
          homeDir: container.env.homeDir,
          cwd: container.env.cwd,
          scope,
          dryRun: flags.dryRun,
          observers: {
            onStart: (details) => {
              if (flags.dryRun) {
                resources.logger.dryRun(`Would ${details.label.toLowerCase()}`);
              }
            },
            onComplete: (details, outcome) => {
              if (!flags.dryRun && outcome.changed) {
                resources.logger.verbose(details.label);
              }
            }
          }
        }
      );

      resources.context.complete({
        success: `Installed skill ${options.name} for ${resolvedAgent} at ${result.displayPath}`,
        dry: `Would install skill ${options.name} for ${resolvedAgent} at ${result.displayPath}`
      });
      resources.context.finalize();
    });

  skill
    .command("list")
    .alias("ls")
    .description("List installed skills for an agent.")
    .argument(
      "[agent]",
      `Agent to list skills for (${skillAgentHelpList()}); omit to list every agent`
    )
    .option("--local", "Use local scope (in the current project)")
    .option("--global", "Use global scope (in the user home directory)")
    .action(async (agentArg: string | undefined, options: SkillCommandOptions) => {
      await executeSkillList(program, container, agentArg, options);
    });

  skill
    .command("bridge")
    .description(
      "Preview how active skill references resolve and where they would be bridged for a spawn agent. Writes nothing: bridging runs during poe-code spawn --skill <ref>."
    )
    .argument("<refs...>", "Skill references to resolve (<name> or <agentId>/<name>)")
    .option("--agent <agent>", `Spawn agent that would receive the skills (${skillAgentHelpList()})`)
    .option("-y, --yes", "Accept defaults, skip prompts")
    .action(async (refs: string[], options: SkillBridgeCommandOptions) => {
      const rootFlags = resolveCommandFlags(program);
      const flags = {
        ...rootFlags,
        assumeYes: rootFlags.assumeYes || Boolean(options.yes)
      };
      const resources = createExecutionResources(container, flags, "skill:bridge");

      const agent = await resolveSkillAgent({
        agentArg: options.agent,
        container,
        flags,
        promptMessage: "Select agent to bridge skills for:",
        logger: resources.logger
      });
      if (!agent) {
        return;
      }

      const resolvedAgent = requireSkillAgentId(agent);
      const targetDir = resolveSkillDir(
        getAgentConfig(resolvedAgent)!,
        "local",
        container.env.cwd,
        container.env.homeDir
      );

      resources.logger.intro(`skill bridge ${resolvedAgent}`);

      const resolutions = refs.map((ref) =>
        resolveSkillReference(ref, container.env.cwd, container.env.homeDir)
      );
      const failures = resolutions.filter(
        (resolution): resolution is SkillResolutionFailure => resolution.kind !== "resolved"
      );
      if (failures.length > 0) {
        throw new ValidationError(formatUnresolvedRefs(failures));
      }

      const theme = getTheme();
      resources.logger.info(
        renderTable({
          theme,
          columns: [
            { name: "Skill", title: "Skill", alignment: "left", maxLen: 30 },
            { name: "Source", title: "Source", alignment: "left", maxLen: 40 },
            { name: "Bridged to", title: "Bridged to", alignment: "left", maxLen: 40 }
          ],
          rows: resolutions.map((resolution) => {
            const source = resolution as Extract<typeof resolution, { kind: "resolved" }>;
            return {
              Skill: theme.accent(source.ref),
              Source: formatSkillPath(container, source.sourcePath),
              "Bridged to": formatSkillPath(container, path.join(targetDir, source.name))
            };
          })
        })
      );
    });

  skill
    .command("configure")
    .description("Install skill directories for an agent.")
    .argument("[agent]", `Agent to configure skills for (${skillAgentHelpList()})`)
    .option("-y, --yes", "Accept defaults, skip prompts")
    .option("--local", "Use local scope (in the current project)")
    .option("--global", "Use global scope (in the user home directory)")
    .action(async (agentArg, options) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "skill");

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      const agent = await resolveSkillAgent({
        agentArg,
        container,
        flags,
        promptMessage: "Select agent to configure:",
        logger: resources.logger
      });
      if (!agent) {
        return;
      }

      const support = resolveAgentSupport(agent);
      if (support.status !== "supported") {
        throw new ValidationError(formatAgentCapabilityError({ agent, capability: "skill" }));
      }

      const resolvedAgent = support.id ?? agent;
      const config = support.config!;

      let scope: SkillScope;
      if (options.local) {
        scope = "local";
      } else if (options.global) {
        scope = "global";
      } else if (flags.assumeYes) {
        scope = "global";
        announceAssumedScope(resources.logger, scope);
      } else {
        assertInteractivePromptAvailable(
          "Skill scope selection requires --local, --global, or --yes when running without an interactive TTY."
        );
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
        scope = selected as SkillScope;
      }

      const displayPath =
        scope === "global"
          ? config.globalSkillDir
          : config.localSkillDir.startsWith("./")
            ? config.localSkillDir
            : `./${config.localSkillDir}`;

      resources.logger.intro(`skill configure ${resolvedAgent}`);

      if (config.dirNote) {
        resources.logger.info(config.dirNote);
      }

      await configure(resolvedAgent, {
        fs: container.fs,
        homeDir: container.env.homeDir,
        cwd: container.env.cwd,
        scope,
        dryRun: flags.dryRun,
        observers: {
          onStart: (details) => {
            if (flags.dryRun) {
              resources.logger.dryRun(`Would ${details.label.toLowerCase()}`);
            }
          },
          onComplete: (details, outcome) => {
            if (!flags.dryRun && outcome.changed) {
              resources.logger.verbose(details.label);
            }
          }
        }
      });

      resources.context.complete({
        success: `Configured skills for ${resolvedAgent} at ${displayPath}`,
        dry: `Would configure skills for ${resolvedAgent} at ${displayPath}`
      });
      resources.context.finalize();
    });

  skill
    .command("unconfigure")
    .description("Remove skill directories for an agent.")
    .argument("[agent]", `Agent to unconfigure skills for (${skillAgentHelpList()})`)
    .option("--local", "Use local scope (in the current project)")
    .option("--global", "Use global scope (in the user home directory)")
    .option("--force", "Remove poe-code managed skills even if they were modified locally")
    .action(async (agentArg, options) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "skill");

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      const agent = await resolveSkillAgent({
        agentArg,
        container,
        flags,
        promptMessage: "Select agent to unconfigure:",
        logger: resources.logger
      });
      if (!agent) {
        return;
      }

      const support = resolveAgentSupport(agent);
      if (support.status !== "supported") {
        throw new ValidationError(formatAgentCapabilityError({ agent, capability: "skill" }));
      }

      const resolvedAgent = support.id ?? agent;
      const config = support.config!;

      let scope: SkillScope | undefined;
      if (options.local) {
        scope = "local";
      } else if (options.global) {
        scope = "global";
      } else if (flags.assumeYes) {
        scope = "global";
      } else {
        assertInteractivePromptAvailable(
          "Skill scope selection requires --local, --global, or --yes when running without an interactive TTY."
        );
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
        scope = selected as SkillScope;
      }

      const displayPath = scope === "global" ? config.globalSkillDir : config.localSkillDir;

      resources.logger.intro(`skill unconfigure ${resolvedAgent}`);

      let targetPath: string | undefined;
      let removed = false;

      await unconfigure(resolvedAgent, {
        fs: container.fs,
        homeDir: container.env.homeDir,
        cwd: container.env.cwd,
        scope,
        force: Boolean(options.force),
        dryRun: flags.dryRun,
        observers: {
          onStart: (details) => {
            if (flags.dryRun) {
              resources.logger.dryRun(`Would ${details.label.toLowerCase()}`);
              return;
            }
            // Blast radius: announce every path before it is deleted.
            resources.logger.info(details.label);
          },
          onComplete: (details, outcome) => {
            targetPath = details.targetPath;
            removed = removed || outcome.changed;
            if (!flags.dryRun && outcome.changed) {
              resources.logger.verbose(details.label);
            }
          }
        }
      });

      if (flags.dryRun || removed) {
        resources.context.complete({
          success: `Removed poe-code skills for ${resolvedAgent} at ${displayPath}`,
          dry: `Would remove poe-code skills for ${resolvedAgent} at ${displayPath}`
        });
        resources.context.finalize();
        return;
      }

      if (!options.force && targetPath) {
        try {
          const entries = await container.fs.readdir(targetPath);
          if (entries.length > 0) {
            resources.logger.warn(
              `Kept ${displayPath} for ${resolvedAgent}: it holds ${entries.length} entr${entries.length === 1 ? "y" : "ies"} of skills poe-code does not manage.`
            );
            return;
          }
        } catch {
          // Directory missing or unreadable.
        }
      }

      resources.logger.info(`No skill directory found for ${resolvedAgent} at ${displayPath}.`);
    });
}
