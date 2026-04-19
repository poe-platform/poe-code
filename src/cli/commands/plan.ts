import path from "node:path";
import type { Command } from "commander";
import {
  cancel,
  confirmOrCancel,
  getTheme,
  intro,
  isCancel,
  promptText,
  renderMarkdown,
  renderTable,
  select,
  text,
  withOutputFormat
} from "@poe-code/design-system";
import {
  archivePlan,
  deletePlan,
  discoverAllPlans,
  editPlan,
  loadPlanPreviewMarkdown,
  runPlanBrowser,
  type PlanEntry,
  type PlanKind
} from "@poe-code/plan-browser";
import {
  installSkill,
  resolveAgentSupport,
  supportedAgents,
  type SkillScope
} from "@poe-code/agent-skill-config";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import { readMergedDocument, resolveScope } from "@poe-code/poe-code-config";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { planConfigScope } from "../../services/config.js";
import { createExecutionResources, resolveCommandFlags, resolveDefaultAgent } from "./shared.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";
import planSkillTemplate from "../../templates/plan/SKILL_plan.md";

const DEFAULT_PLAN_AGENT = "claude-code";
const DEFAULT_PLAN_SCOPE: SkillScope = "local";

export interface BuildPlanPromptOptions {
  question: string;
  planDirectory: string;
  skillContent: string;
}

export function buildPlanPrompt(options: BuildPlanPromptOptions): string {
  const trimmedQuestion = options.question.trim();
  const userSection =
    trimmedQuestion.length > 0
      ? `User request: ${trimmedQuestion}`
      : 'The user has not yet stated what they want to plan. Follow the skill\'s "If The Request Is Empty" instruction and ask: What do you want to plan?';

  return [
    "Follow the skill below to draft a feature plan.",
    "",
    options.skillContent,
    "",
    "---",
    "",
    `Plan directory: ${options.planDirectory}`,
    userSection
  ].join("\n");
}

type OutputOption = "terminal" | "markdown" | "json";

type PlanCommandOptions = {
  source?: PlanKind;
  output?: string;
};

function resolvePlanCommandOptions(command: Command): PlanCommandOptions {
  const localOptions = command.opts<PlanCommandOptions>();
  const parentOptions = command.parent?.opts<PlanCommandOptions>() ?? {};

  return {
    source: localOptions.source ?? parentOptions.source,
    output: localOptions.output ?? parentOptions.output
  };
}

function resolveOutputOption(value: string | undefined): OutputOption {
  if (!value || value.trim().length === 0) {
    return "terminal";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "json") {
    return "json";
  }
  if (normalized === "md" || normalized === "markdown") {
    return "markdown";
  }
  if (normalized === "terminal") {
    return "terminal";
  }

  throw new ValidationError(
    `Invalid --output value "${value}". Expected one of: terminal, md, json.`
  );
}

function resolveSource(value: string | undefined): PlanKind | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  if (
    value === "plan" ||
    value === "pipeline" ||
    value === "experiment" ||
    value === "ralph" ||
    value === "superintendent" ||
    value === "superintendent-base"
  ) {
    return value;
  }

  throw new ValidationError(
    `Invalid --source value "${value}". Expected plan, pipeline, experiment, ralph, superintendent, or superintendent-base.`
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function discoverPlans(
  container: CliContainer,
  kind: PlanKind | undefined
): Promise<PlanEntry[]> {
  return discoverAllPlans({
    cwd: container.env.cwd,
    homeDir: container.env.homeDir,
    configPath: container.env.configPath,
    projectConfigPath: container.env.projectConfigPath,
    fs: container.fs as Parameters<typeof discoverAllPlans>[0]["fs"],
    kind,
    variables: container.env.variables
  });
}

async function resolveSelectedPlan(options: {
  container: CliContainer;
  plans: PlanEntry[];
  providedPath?: string;
  assumeYes: boolean;
  promptMessage: string;
}): Promise<PlanEntry> {
  const providedPath = options.providedPath?.trim();
  if (providedPath) {
    const resolvedAbsolute = providedPath.startsWith("~/")
      ? path.join(options.container.env.homeDir, providedPath.slice(2))
      : path.isAbsolute(providedPath)
        ? providedPath
        : path.resolve(options.container.env.cwd, providedPath);

    const matched = options.plans.find(
      (plan) =>
        plan.path === providedPath ||
        plan.absolutePath === providedPath ||
        plan.absolutePath === resolvedAbsolute
    );
    if (!matched) {
      throw new ValidationError(`Plan not found: ${providedPath}`);
    }
    return matched;
  }

  if (options.plans.length === 0) {
    throw new ValidationError("No plans found.");
  }

  if (options.assumeYes) {
    return options.plans[0]!;
  }

  const selected = await select({
    message: options.promptMessage,
    options: options.plans.map((plan) => ({
      label: text.selectLabel(path.basename(plan.path), plan.detail),
      hint: plan.typeLabel,
      value: plan.absolutePath
    }))
  });

  if (isCancel(selected)) {
    throw new ValidationError("Plan selection cancelled.");
  }

  const matched = options.plans.find((plan) => plan.absolutePath === selected);
  if (!matched) {
    throw new ValidationError("Plan selection cancelled.");
  }

  return matched;
}

function writeOutput(format: OutputOption, value: string): void {
  if (format === "terminal") {
    process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
    return;
  }

  const scopedFormat = format === "markdown" ? "markdown" : "json";
  withOutputFormat(scopedFormat, () => {
    process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
  });
}

async function renderPlanList(container: CliContainer, options: PlanCommandOptions): Promise<void> {
  const format = resolveOutputOption(options.output);
  const source = resolveSource(options.source);
  const plans = await discoverPlans(container, source);

  if (format === "json") {
    writeOutput(
      format,
      JSON.stringify(
        plans.map((plan) => ({
          source: plan.kind,
          name: path.basename(plan.path),
          path: plan.path,
          detail: plan.detail,
          updated: formatDate(plan.updatedAt)
        })),
        null,
        2
      )
    );
    return;
  }

  const table = withOutputFormat(format, () =>
    renderTable({
      theme: getTheme(),
      columns: [
        { name: "source", title: "Source", alignment: "left", maxLen: 12 },
        { name: "name", title: "Name", alignment: "left", maxLen: 32 },
        { name: "detail", title: "Detail", alignment: "left", maxLen: 40 },
        { name: "updated", title: "Updated", alignment: "left", maxLen: 12 }
      ],
      rows: plans.map((plan) => ({
        source: plan.kind,
        name: path.basename(plan.path),
        detail: plan.detail,
        updated: formatDate(plan.updatedAt)
      }))
    })
  );

  writeOutput(format, table);
}

async function executePlanAction(options: {
  program: Command;
  container: CliContainer;
  action: "edit" | "archive" | "delete";
  pathArg?: string;
  source?: string;
  output?: string;
}): Promise<void> {
  intro(`plan ${options.action}`);
  const flags = resolveCommandFlags(options.program);
  const format = resolveOutputOption(options.output);
  const plans = await discoverPlans(options.container, resolveSource(options.source));
  const plan = await resolveSelectedPlan({
    container: options.container,
    plans,
    providedPath: options.pathArg,
    assumeYes: flags.assumeYes,
    promptMessage: `Select a plan to ${options.action}`
  });

  if (options.action === "edit") {
    editPlan(plan.absolutePath, {
      env: options.container.env.variables
    });
    writeOutput(
      format,
      format === "json"
        ? JSON.stringify({ action: "edit", path: plan.path }, null, 2)
        : `Edited ${plan.path}`
    );
    return;
  }

  if (!flags.assumeYes) {
    const confirmed = await confirmOrCancel({
      message:
        options.action === "archive"
          ? `Archive ${path.basename(plan.path)}?`
          : `Permanently delete ${path.basename(plan.path)}?`,
      initialValue: true
    });
    if (!confirmed) {
      return;
    }
  }

  if (options.action === "archive") {
    const archivedPath = await archivePlan(
      plan,
      options.container.fs as unknown as Parameters<typeof archivePlan>[1]
    );
    writeOutput(
      format,
      format === "json"
        ? JSON.stringify({ action: "archive", path: plan.path, archivedPath }, null, 2)
        : `Archived ${plan.path}`
    );
    return;
  }

  await deletePlan(plan, options.container.fs as unknown as Parameters<typeof deletePlan>[1]);
  writeOutput(
    format,
    format === "json"
      ? JSON.stringify({ action: "delete", path: plan.path }, null, 2)
      : `Deleted ${plan.path}`
  );
}

export function registerPlanCommand(program: Command, container: CliContainer): void {
  const plan = program
    .command("plan")
    .description("Plan a feature with an interactive agent session, or manage existing plans.")
    .argument("[question]", "What you want to plan")
    .option("--agent <name>", "Agent to run the plan session with")
    .action(async function (this: Command, questionArg?: string) {
      const opts = this.opts<{ agent?: string }>();
      const flags = resolveCommandFlags(program);
      const question = await resolvePlanQuestion(questionArg, flags.assumeYes);
      if (question === null) {
        return;
      }

      const agent = resolvePlanSessionAgent(opts.agent);
      await runPlanSession({
        container,
        agent,
        question
      });
    });

  plan
    .command("browse")
    .description("Browse, view, and manage plans across all plan systems.")
    .option(
      "--source <source>",
      "Filter by plan source: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .action(async function (this: Command) {
      const opts = this.opts<PlanCommandOptions>();
      const flags = resolveCommandFlags(program);
      intro("plan browser");
      await runPlanBrowser({
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        configPath: container.env.configPath,
        projectConfigPath: container.env.projectConfigPath,
        fs: container.fs as Parameters<typeof runPlanBrowser>[0]["fs"],
        kind: resolveSource(opts.source),
        variables: container.env.variables,
        assumeYes: flags.assumeYes
      });
    });

  plan
    .command("list")
    .description("List plans across all plan systems.")
    .option(
      "--source <source>",
      "Filter by plan source: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command) {
      intro("plan list");
      await renderPlanList(container, resolvePlanCommandOptions(this));
    });

  plan
    .command("view")
    .description("Render a single plan to the terminal.")
    .argument("[path]", "Plan path")
    .option(
      "--source <source>",
      "Filter by plan source: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command, pathArg?: string) {
      intro("plan view");
      const flags = resolveCommandFlags(program);
      const options = resolvePlanCommandOptions(this);
      const format = resolveOutputOption(options.output);
      const plans = await discoverPlans(container, resolveSource(options.source));
      const plan = await resolveSelectedPlan({
        container,
        plans,
        providedPath: pathArg,
        assumeYes: flags.assumeYes,
        promptMessage: "Select a plan to view"
      });
      const markdown = await loadPlanPreviewMarkdown(plan, container.fs);

      if (format === "json") {
        writeOutput(
          format,
          JSON.stringify(
            {
              source: plan.kind,
              path: plan.path,
              title: plan.title,
              detail: plan.detail,
              content: markdown
            },
            null,
            2
          )
        );
        return;
      }

      const output = format === "markdown" ? markdown : renderMarkdown(markdown);
      writeOutput(format, output.trimEnd());
    });

  plan
    .command("edit")
    .description("Open a plan in $EDITOR.")
    .argument("[path]", "Plan path")
    .option(
      "--source <source>",
      "Filter by plan source: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command, pathArg?: string) {
      await executePlanAction({
        program,
        container,
        action: "edit",
        pathArg,
        ...resolvePlanCommandOptions(this)
      });
    });

  plan
    .command("archive")
    .description("Move a plan into archive/.")
    .argument("[path]", "Plan path")
    .option(
      "--source <source>",
      "Filter by plan source: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command, pathArg?: string) {
      await executePlanAction({
        program,
        container,
        action: "archive",
        pathArg,
        ...resolvePlanCommandOptions(this)
      });
    });

  plan
    .command("delete")
    .description("Delete a plan file.")
    .argument("[path]", "Plan path")
    .option(
      "--source <source>",
      "Filter by plan source: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command, pathArg?: string) {
      await executePlanAction({
        program,
        container,
        action: "delete",
        pathArg,
        ...resolvePlanCommandOptions(this)
      });
    });

  plan
    .command("install")
    .description("Install the /plan five-levels skill.")
    .option("--agent <name>", "Agent to install the plan skill for")
    .option("--local", "Install project-local skill")
    .option("--global", "Install user-global skill")
    .action(async function (this: Command) {
      const flags = resolveCommandFlags(program);
      const localOptions = this.opts<{
        agent?: string;
        local?: boolean;
        global?: boolean;
      }>();
      const parentOptions = this.parent?.opts<{ agent?: string }>() ?? {};
      const options = {
        agent: localOptions.agent ?? parentOptions.agent,
        local: localOptions.local,
        global: localOptions.global
      };

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      const resources = createExecutionResources(container, flags, "plan:install");

      try {
        const agent = await resolvePlanAgent(container, options.agent, flags.assumeYes);
        if (agent === null) {
          return;
        }

        const support = resolveAgentSupport(agent);
        if (support.status !== "supported" || !support.id) {
          throw new ValidationError(`Unsupported agent: ${agent}`);
        }

        const scope = await resolvePlanScope(options, flags.assumeYes);
        if (scope === null) {
          return;
        }

        resources.logger.intro(`plan install (${support.id}, ${scope})`);

        const skillResult = await installSkill(
          support.id,
          {
            name: "poe-code-plan",
            content: planSkillTemplate
          },
          {
            fs: container.fs,
            cwd: container.env.cwd,
            homeDir: container.env.homeDir,
            scope,
            dryRun: flags.dryRun
          }
        );

        if (flags.dryRun) {
          resources.logger.dryRun(`Would create: ${skillResult.displayPath}`);
        } else {
          resources.logger.info(`Create: ${skillResult.displayPath}`);
        }

        resources.context.complete({
          success: `Installed plan skill for ${support.id} (${scope}).`,
          dry: `Would install plan skill for ${support.id} (${scope}).`
        });
      } finally {
        resources.context.finalize();
      }
    });
}

async function resolvePlanQuestion(
  value: string | undefined,
  assumeYes: boolean
): Promise<string | null> {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length > 0) {
    return trimmed;
  }

  if (assumeYes) {
    throw new ValidationError(
      "A question is required for `poe-code plan`. Pass it as the first argument."
    );
  }

  const entered = await promptText({
    message: "What do you want to plan?"
  });
  if (isCancel(entered)) {
    cancel("Plan session cancelled.");
    return null;
  }

  const question = typeof entered === "string" ? entered.trim() : "";
  if (question.length === 0) {
    throw new ValidationError("A question is required for `poe-code plan`.");
  }
  return question;
}

function resolvePlanSessionAgent(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : DEFAULT_PLAN_AGENT;
}

async function resolvePlanDirectory(container: CliContainer): Promise<string> {
  const document = await readMergedDocument(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const config = resolveScope(
    planConfigScope.schema,
    document[planConfigScope.scope],
    container.env.variables
  );
  const configured = config.plan_directory?.trim();
  return configured && configured.length > 0 ? configured : "docs/plans";
}

interface RunPlanSessionOptions {
  container: CliContainer;
  agent: string;
  question: string;
}

async function runPlanSession(options: RunPlanSessionOptions): Promise<void> {
  const planDirectory = await resolvePlanDirectory(options.container);
  const prompt = buildPlanPrompt({
    question: options.question,
    planDirectory,
    skillContent: planSkillTemplate
  });

  const { result } = sdkSpawn(options.agent, prompt, {
    interactive: true,
    cwd: options.container.env.cwd
  });

  const final = await result;
  if (final.exitCode !== 0) {
    process.exitCode = final.exitCode;
  }
}

async function resolvePlanAgent(
  container: CliContainer,
  value: string | undefined,
  assumeYes: boolean
): Promise<string | null> {
  if (value && value.trim().length > 0) {
    return value.trim();
  }

  const fromConfig = await resolveDefaultAgent(container);
  if (fromConfig !== null) {
    return parseAgentSpecifier(fromConfig).agent;
  }

  if (assumeYes) {
    return DEFAULT_PLAN_AGENT;
  }

  const selected = await select({
    message: "Select agent to install the plan skill for:",
    options: supportedAgents.map((name) => ({ value: name, label: name }))
  });
  if (isCancel(selected)) {
    cancel("Plan install cancelled.");
    return null;
  }
  return selected as string;
}

async function resolvePlanScope(
  options: { local?: boolean; global?: boolean },
  assumeYes: boolean
): Promise<SkillScope | null> {
  if (options.local) {
    return "local";
  }
  if (options.global) {
    return "global";
  }
  if (assumeYes) {
    return DEFAULT_PLAN_SCOPE;
  }

  const selected = await select({
    message: "Select install scope:",
    options: [
      { value: "local", label: "Local" },
      { value: "global", label: "Global" }
    ]
  });
  if (isCancel(selected)) {
    cancel("Plan install cancelled.");
    return null;
  }
  return selected as SkillScope;
}
