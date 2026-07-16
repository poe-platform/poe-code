import type { Command } from "commander";
import * as path from "node:path";
import { select, isCancel, cancel } from "toolcraft-design";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import type { CliContainer } from "../container.js";
import {
  supportedAgents,
  configure,
  installSkill,
  unconfigure,
  resolveAgentSupport,
  type SkillScope
} from "@poe-code/agent-skill-config";
import { createExecutionResources, resolveCommandFlags, resolveDefaultAgent } from "./shared.js";
import { throwCommandNotFound } from "../command-not-found.js";
import { ValidationError } from "../errors.js";

const DEFAULT_SKILL_AGENT = "claude-code";

interface SkillCommandOptions {
  local?: boolean;
  global?: boolean;
  yes?: boolean;
}

interface SkillInstallCommandOptions extends SkillCommandOptions {
  name: string;
  file: string;
}

async function resolveSkillAgent(input: {
  agentArg: string | undefined;
  container: CliContainer;
  flags: ReturnType<typeof resolveCommandFlags>;
  promptMessage: string;
}): Promise<string | undefined> {
  if (input.agentArg) {
    return input.agentArg;
  }

  if (input.flags.assumeYes) {
    const fromConfig = await resolveDefaultAgent(input.container, { readOnly: input.flags.dryRun });
    return fromConfig !== null
      ? parseAgentSpecifier(fromConfig).agent
      : DEFAULT_SKILL_AGENT;
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

export function registerSkillCommand(program: Command, container: CliContainer): void {
  const skill = program
    .command("skill")
    .description("Skill directory commands.")
    .allowExcessArguments()
    .action(function (this: Command) {
      if (this.args.length > 0) {
        throwCommandNotFound({
          container,
          scope: "skill",
          unknownCommand: this.args.at(0) ?? "",
          helpArgs: ["skill", "--help"],
          moduleUrl: import.meta.url
        });
      }
      this.help();
    });

  skill
    .command("install")
    .description("Install an arbitrary skill for an agent.")
    .argument("[agent]", `Agent to install the skill for (${supportedAgents.join(" | ")})`)
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
        promptMessage: "Select agent to install skill for:"
      });
      if (!agent) {
        return;
      }

      const support = resolveAgentSupport(agent);
      if (support.status === "unknown") {
        throw new ValidationError(`Unknown agent: ${agent}`);
      }
      if (support.status === "unsupported") {
        throw new ValidationError(`Skills not supported for ${support.id}.`);
      }

      let scope: SkillScope;
      if (options.local) {
        scope = "local";
      } else if (options.global) {
        scope = "global";
      } else if (flags.assumeYes) {
        scope = "local";
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
    .command("configure")
    .description("Install skill directories for an agent.")
    .argument("[agent]", `Agent to configure skills for (${supportedAgents.join(" | ")})`)
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
        promptMessage: "Select agent to configure:"
      });
      if (!agent) {
        return;
      }

      const support = resolveAgentSupport(agent);
      if (support.status === "unknown") {
        throw new ValidationError(`Unknown agent: ${agent}`);
      }
      if (support.status === "unsupported") {
        throw new ValidationError(`Skills not supported for ${support.id}.`);
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
    .argument("[agent]", `Agent to unconfigure skills for (${supportedAgents.join(" | ")})`)
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
        promptMessage: "Select agent to unconfigure:"
      });
      if (!agent) {
        return;
      }

      const support = resolveAgentSupport(agent);
      if (support.status === "unknown") {
        throw new ValidationError(`Unknown agent: ${agent}`);
      }
      if (support.status === "unsupported") {
        throw new ValidationError(`Skills not supported for ${support.id}.`);
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
