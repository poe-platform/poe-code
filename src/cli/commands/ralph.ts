import path from "node:path";
import type { Command } from "commander";
import { select, isCancel, cancel } from "@poe-code/design-system";
import { loadConfig, ralphBuild, logActivity, resolvePlanPath, parsePlan } from "@poe-code/ralph";
import {
  supportedAgents,
  resolveAgentSupport,
  installSkill,
  type SkillScope
} from "@poe-code/agent-skill-config";
import { renderTemplate } from "@poe-code/config-mutations";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  type CommandFlags
} from "./shared.js";
import { registerRalphWorktreeCommand } from "./ralph-worktree.js";
// Template imports are lazy to avoid breaking tsx/tsc output
// (Node.js can't resolve .md/.log as ESM modules)
const templateImports = {
  promptPartialPlan: () => import("../../templates/ralph/PROMPT_PARTIAL_plan.md"),
  skillPlan: () => import("../../templates/ralph/SKILL_plan.md"),
  promptPlan: () => import("../../templates/ralph/PROMPT_plan.md"),
  promptBuild: () => import("../../templates/ralph/PROMPT_build.md"),
  refGuardrails: () => import("../../templates/ralph/references/GUARDRAILS.md"),
  refContextEngineering: () => import("../../templates/ralph/references/CONTEXT_ENGINEERING.md"),
  stateProgress: () => import("../../templates/ralph/state/progress.md"),
  stateGuardrails: () => import("../../templates/ralph/state/guardrails.md"),
  stateErrors: () => import("../../templates/ralph/state/errors.log"),
  stateActivity: () => import("../../templates/ralph/state/activity.log"),
} as const;

async function loadRalphTemplates() {
  const [
    promptPartialPlan,
    skillPlan,
    promptPlan,
    promptBuild,
    refGuardrails,
    refContextEngineering,
    stateProgress,
    stateGuardrails,
    stateErrors,
    stateActivity
  ] = await Promise.all([
    templateImports.promptPartialPlan(),
    templateImports.skillPlan(),
    templateImports.promptPlan(),
    templateImports.promptBuild(),
    templateImports.refGuardrails(),
    templateImports.refContextEngineering(),
    templateImports.stateProgress(),
    templateImports.stateGuardrails(),
    templateImports.stateErrors(),
    templateImports.stateActivity(),
  ]);
  return {
    promptPartialPlan: promptPartialPlan.default,
    skillPlan: skillPlan.default,
    promptPlan: promptPlan.default,
    promptBuild: promptBuild.default,
    refGuardrails: refGuardrails.default,
    refContextEngineering: refContextEngineering.default,
    stateProgress: stateProgress.default,
    stateGuardrails: stateGuardrails.default,
    stateErrors: stateErrors.default,
    stateActivity: stateActivity.default,
  };
}

const DEFAULT_RALPH_AGENT = "claude-code";

type RalphBuildCommandOptions = {
  plan?: string;
  agent?: string;
  commit?: boolean;
  maxFailures?: string;
  pauseOnOverbake?: boolean;
  worktree?: boolean;
  worktreeName?: string;
};

type RalphInstallCommandOptions = {
  force?: boolean;
  agent?: string;
  local?: boolean;
  global?: boolean;
};

type RalphAgentLogCommandOptions = {
  activityLog?: string;
};

type RalphAgentValidatePlanCommandOptions = {
  plan?: string;
};

async function pathExists(
  fs: CliContainer["fs"],
  filePath: string
): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as any).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function resolveIterations(value: string | undefined): number {
  if (value == null) {
    return 25;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ValidationError(
      `Invalid iterations "${value}". Expected a positive integer.`
    );
  }
  return parsed;
}

function resolveMaxFailures(value: string | undefined): number {
  if (value == null) {
    return 3;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ValidationError(
      `Invalid max failures "${value}". Expected a positive integer.`
    );
  }
  return parsed;
}

async function writeFileOrSkip(args: {
  fs: CliContainer["fs"];
  filePath: string;
  contents: string;
  force: boolean;
  logger: ReturnType<CliContainer["loggerFactory"]["create"]>;
  displayPath: string;
}): Promise<"written" | "skipped"> {
  const exists = await pathExists(args.fs, args.filePath);
  if (exists && !args.force) {
    args.logger.info(`Skip: ${args.displayPath} (already exists)`);
    return "skipped";
  }

  await args.fs.mkdir(path.dirname(args.filePath), { recursive: true });
  await args.fs.writeFile(args.filePath, args.contents, { encoding: "utf8" });

  args.logger.info(`${exists ? "Overwrite" : "Create"}: ${args.displayPath}`);
  return "written";
}

async function installRalphTemplates(args: {
  container: CliContainer;
  flags: CommandFlags;
  force: boolean;
  agent: string;
  scope: SkillScope;
}): Promise<void> {
  const resources = createExecutionResources(
    args.container,
    args.flags,
    "ralph:install"
  );

  try {
    resources.logger.intro(`ralph install (${args.agent}, ${args.scope})`);

    const cwd = args.container.env.cwd;
    const force = args.force;

    const support = resolveAgentSupport(args.agent);
    if (support.status !== "supported" || !support.config) {
      throw new ValidationError(`Unsupported agent: ${args.agent}`);
    }

    const templates = await loadRalphTemplates();

    // Install /plan skill to agent's skill directory
    const skillContents = renderTemplate(templates.skillPlan, { PROMPT_PARTIAL_PLAN: templates.promptPartialPlan });

    const skillResult = await installSkill(
      args.agent,
      { name: "poe-code-ralph-plan", content: skillContents },
      {
        fs: resources.context.fs,
        cwd,
        homeDir: args.container.env.homeDir,
        scope: args.scope,
        dryRun: args.flags.dryRun
      }
    );
    resources.logger.info(`Create: ${skillResult.displayPath}`);

    // Install project templates to .agents/poe-code-ralph
    // PROMPT_plan.md: use string replace to preserve {{REQUEST}} and {{OUT_PATH}} as runtime variables
    const promptPlanContents = templates.promptPlan.replace("{{{PROMPT_PARTIAL_PLAN}}}", templates.promptPartialPlan);

    const templateWrites = [
      {
        targetPath: path.join(cwd, ".agents", "poe-code-ralph", "PROMPT_plan.md"),
        displayPath: ".agents/poe-code-ralph/PROMPT_plan.md",
        contents: promptPlanContents
      },
      {
        targetPath: path.join(cwd, ".agents", "poe-code-ralph", "PROMPT_build.md"),
        displayPath: ".agents/poe-code-ralph/PROMPT_build.md",
        contents: templates.promptBuild
      },
      {
        targetPath: path.join(cwd, ".agents", "poe-code-ralph", "references", "GUARDRAILS.md"),
        displayPath: ".agents/poe-code-ralph/references/GUARDRAILS.md",
        contents: templates.refGuardrails
      },
      {
        targetPath: path.join(cwd, ".agents", "poe-code-ralph", "references", "CONTEXT_ENGINEERING.md"),
        displayPath: ".agents/poe-code-ralph/references/CONTEXT_ENGINEERING.md",
        contents: templates.refContextEngineering
      }
    ];

    for (const entry of templateWrites) {
      await writeFileOrSkip({
        fs: resources.context.fs,
        filePath: entry.targetPath,
        contents: entry.contents,
        force,
        logger: resources.logger,
        displayPath: entry.displayPath
      });
    }

    // Install state files to .poe-code-ralph
    const stateFiles = [
      {
        contents: templates.stateProgress,
        targetPath: path.join(cwd, ".poe-code-ralph", "progress.md"),
        displayPath: ".poe-code-ralph/progress.md"
      },
      {
        contents: templates.stateGuardrails,
        targetPath: path.join(cwd, ".poe-code-ralph", "guardrails.md"),
        displayPath: ".poe-code-ralph/guardrails.md"
      },
      {
        contents: templates.stateErrors,
        targetPath: path.join(cwd, ".poe-code-ralph", "errors.log"),
        displayPath: ".poe-code-ralph/errors.log"
      },
      {
        contents: templates.stateActivity,
        targetPath: path.join(cwd, ".poe-code-ralph", "activity.log"),
        displayPath: ".poe-code-ralph/activity.log"
      }
    ];

    for (const entry of stateFiles) {
      await writeFileOrSkip({
        fs: resources.context.fs,
        filePath: entry.targetPath,
        contents: entry.contents,
        force,
        logger: resources.logger,
        displayPath: entry.displayPath
      });
    }

    resources.context.complete({
      success: `Installed Ralph templates for ${args.agent}.`,
      dry: `Dry run: would install Ralph templates for ${args.agent}.`
    });
  } finally {
    resources.context.finalize();
  }
}

export function registerRalphCommand(
  program: Command,
  container: CliContainer
): void {
  const ralph = program
    .command("ralph")
    .description("Run Ralph iterations for a plan.");

  const agent = ralph.command("agent").description("Agent helper commands.");

  agent
    .command("log")
    .description("Append a message to the Ralph activity log.")
    .option("--activity-log <path>", "Custom activity log path")
    .argument("<message>", "Message to append to the activity log")
    .action(async function (this: Command, message: string) {
      const flags = resolveCommandFlags(program);
      if (flags.dryRun) {
        return;
      }

      const options = this.opts<RalphAgentLogCommandOptions>();
      const trimmedMessage = typeof message === "string" ? message.trim() : "";
      if (trimmedMessage.length === 0) {
        throw new ValidationError("Activity log message cannot be empty.");
      }

      let configActivityLogPath: string | undefined;
      try {
        const config = await loadConfig(container.env.cwd, { fs: container.fs as any });
        configActivityLogPath = config.activityLogPath;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ValidationError(message);
      }

      const rawPath = options.activityLog?.trim() || configActivityLogPath || ".poe-code-ralph/activity.log";
      const resolvedPath = path.isAbsolute(rawPath)
        ? rawPath
        : path.resolve(container.env.cwd, rawPath);

      await logActivity(resolvedPath, trimmedMessage, {
        fs: container.fs as any
      });
    });

  agent
    .command("validate-plan")
    .description("Validate a Ralph plan YAML file.")
    .option("--plan <path>", "Path to the plan file")
    .action(async function (this: Command) {
      const options = this.opts<RalphAgentValidatePlanCommandOptions>();
      const cwd = container.env.cwd;

      const planPath = options.plan?.trim();
      if (!planPath) {
        throw new ValidationError("--plan <path> is required.");
      }

      const resolvedPath = path.isAbsolute(planPath)
        ? planPath
        : path.resolve(cwd, planPath);

      let content: string;
      try {
        content = await container.fs.readFile(resolvedPath, "utf8");
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as any).code === "ENOENT"
        ) {
          throw new ValidationError(`Plan file not found: ${planPath}`);
        }
        throw error;
      }

      try {
        parsePlan(content);
        console.log(`Plan valid: ${planPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ValidationError(`Invalid plan: ${message}`);
      }
    });

  ralph
    .command("install")
    .description("Install Ralph templates and /plan skill.")
    .option("--force", "Overwrite existing files")
    .option("--agent <name>", "Agent to install skills for")
    .option("--local", "Use local scope (in the current project)")
    .option("--global", "Use global scope (in the user home directory)")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const options = this.opts<RalphInstallCommandOptions>();

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      let agent: string | undefined = options.agent;
      if (!agent) {
        if (flags.assumeYes) {
          agent = DEFAULT_RALPH_AGENT;
        } else {
          const selected = await select({
            message: "Select agent to install Ralph for:",
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

      let scope: SkillScope;
      if (options.local) {
        scope = "local";
      } else if (options.global) {
        scope = "global";
      } else if (flags.assumeYes) {
        scope = "local";
      } else {
        const selected = await select({
          message: "Select scope:",
          options: [
            { value: "local", label: "Local (project)" },
            { value: "global", label: "Global (user home)" }
          ]
        });
        if (isCancel(selected)) {
          cancel("Operation cancelled");
          return;
        }
        scope = selected as SkillScope;
      }

      await installRalphTemplates({
        container,
        flags,
        force: Boolean(options.force),
        agent: support.id ?? agent,
        scope
      });
    });

  ralph
    .command("build")
    .description("Run the Ralph build loop for the selected plan.")
    .option("--plan <path>", "Path to the plan file")
    .option("--agent <name>", "Agent name to run (default: codex)")
    .option("--no-commit", "Instruct the agent not to commit changes")
    .option("--max-failures <n>", "Warn after <n> consecutive failures (default 3)")
    .option("--pause-on-overbake", "Pause and prompt when overbaking is detected")
    .option("--worktree", "Run the build loop in an isolated git worktree")
    .option("--worktree-name <name>", "Name for the worktree (default: derived from plan file name)")
    .argument("[iterations]", "Number of iterations to run (default 25)")
    .action(async function (this: Command, iterations?: string) {
      const flags = resolveCommandFlags(program);
      const options = this.opts<RalphBuildCommandOptions>();
      const resources = createExecutionResources(container, flags, "ralph:build");

      try {
        resources.logger.intro("ralph build");
        if (flags.dryRun) {
          throw new ValidationError(
            "ralph build does not support --dry-run. Use --no-commit instead."
          );
        }

        let config: Awaited<ReturnType<typeof loadConfig>>;
        try {
          config = await loadConfig(container.env.cwd, { fs: container.fs as any });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new ValidationError(message);
        }

        let planPath: string | null;
        try {
          planPath = await resolvePlanPath({
            cwd: container.env.cwd,
            plan: options.plan ?? config.planPath,
            fs: container.fs as any
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new ValidationError(message);
        }

        if (!planPath) {
          return;
        }

        const maxIterations =
          typeof iterations === "string" ? resolveIterations(iterations) : config.maxIterations ?? 25;
        const agent = options.agent?.trim() ? options.agent.trim() : config.agent ?? "codex";
        const noCommit = options.commit === false ? true : config.noCommit ?? false;
        const staleSeconds = config.staleSeconds ?? 60;
        const maxFailures =
          typeof options.maxFailures === "string" ? resolveMaxFailures(options.maxFailures) : undefined;
        const pauseOnOverbake = Boolean(options.pauseOnOverbake);

        const worktreeEnabled = Boolean(options.worktree);
        const worktree = worktreeEnabled
          ? { enabled: true, name: options.worktreeName?.trim() || undefined }
          : undefined;

        const cwd = container.env.cwd;

        resources.logger.info(`Plan:       ${planPath}`);
        resources.logger.info(`Agent:      ${agent}`);
        resources.logger.info(`Iterations: ${maxIterations}`);
        if (noCommit) resources.logger.info("No-commit:  true");
        if (worktree) resources.logger.info(`Worktree:   ${worktree.name ?? "(auto)"}`);

        try {
          const planContent = await container.fs.readFile(
            path.resolve(cwd, planPath),
            "utf8"
          );
          const plan = parsePlan(planContent);
          const total = plan.stories.length;
          const done = plan.stories.filter((s) => s.status === "done").length;
          const inProgress = plan.stories.filter((s) => s.status === "in_progress").length;
          const open = total - done - inProgress;
          resources.logger.info(`Stories:    ${done}/${total} done${inProgress ? `, ${inProgress} in progress` : ""}${open ? `, ${open} open` : ""}`);
        } catch {
          // Plan file may not be parseable yet
        }

        await ralphBuild({
          planPath,
          progressPath: config.progressPath,
          guardrailsPath: config.guardrailsPath,
          errorsLogPath: config.errorsLogPath,
          activityLogPath: config.activityLogPath,
          maxIterations,
          maxFailures,
          pauseOnOverbake,
          agent,
          noCommit,
          staleSeconds,
          cwd,
          worktree
        });

        resources.logger.success("Ralph run finished.");
      } finally {
        resources.context.finalize();
      }
    });

  registerRalphWorktreeCommand(ralph, container);

  ralph
    .command("plan")
    .description("Generate a plan file via an agent.")
    .option("--out <path>", "Output path for generated plan YAML")
    .argument("[request]", "Inline plan request")
    .action(async function (this: Command) {
      throw new ValidationError(
        "Interactive planning is not yet available. Create your plan YAML manually or use the poe-code-ralph-plan skill inside your agent."
      );
    });
}
