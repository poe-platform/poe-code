import type { Command } from "commander";
import { select, isCancel, cancel } from "@poe-code/design-system";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import type { CliContainer } from "../container.js";
import {
  supportedAgents,
  configure,
  unconfigure,
  resolveAgentSupport,
  type SkillScope
} from "@poe-code/agent-skill-config";
import { createExecutionResources, resolveCommandFlags, resolveDefaultAgent } from "./shared.js";
import { throwCommandNotFound } from "../command-not-found.js";
import { ValidationError } from "../errors.js";

const DEFAULT_SKILL_AGENT = "claude-code";

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

      let agent: string | undefined = agentArg;
      if (!agent) {
        const fromConfig = await resolveDefaultAgent(container, { readOnly: flags.dryRun });
        if (fromConfig !== null) {
          agent = parseAgentSpecifier(fromConfig).agent;
        } else if (flags.assumeYes) {
          agent = DEFAULT_SKILL_AGENT;
        } else {
          const selected = await select({
            message: "Select agent to configure:",
            options: supportedAgents.map((a) => ({ value: a, label: a }))
          });
          if (isCancel(selected)) {
            cancel("Operation cancelled");
            return;
          }
          agent = selected as string;
        }
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
    .option("--force", "Remove directory even if it contains files")
    .action(async (agentArg, options) => {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "skill");

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      let agent: string | undefined = agentArg;
      if (!agent) {
        const fromConfig = await resolveDefaultAgent(container, { readOnly: flags.dryRun });
        if (fromConfig !== null) {
          agent = parseAgentSpecifier(fromConfig).agent;
        } else if (flags.assumeYes) {
          agent = DEFAULT_SKILL_AGENT;
        } else {
          const selected = await select({
            message: "Select agent to unconfigure:",
            options: supportedAgents.map((a) => ({ value: a, label: a }))
          });
          if (isCancel(selected)) {
            cancel("Operation cancelled");
            return;
          }
          agent = selected as string;
        }
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
      } else {
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
            }
          },
          onComplete: (details, outcome) => {
            targetPath = details.targetPath;
            removed = outcome.changed;
            if (!flags.dryRun && outcome.changed) {
              resources.logger.verbose(details.label);
            }
          }
        }
      });

      if (flags.dryRun) {
        resources.context.complete({
          success: `Removed skill directory for ${resolvedAgent} at ${displayPath}`,
          dry: `Would remove skill directory for ${resolvedAgent} at ${displayPath}`
        });
        resources.context.finalize();
        return;
      }

      if (removed) {
        resources.context.complete({
          success: `Removed skill directory for ${resolvedAgent} at ${displayPath}`,
          dry: `Would remove skill directory for ${resolvedAgent} at ${displayPath}`
        });
        resources.context.finalize();
        return;
      }

      if (!options.force && targetPath) {
        try {
          const entries = await container.fs.readdir(targetPath);
          if (entries.length > 0) {
            resources.logger.warn(
              `Skill directory for ${resolvedAgent} at ${displayPath} has files. Use --force to remove.`
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
