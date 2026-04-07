import path from "node:path";
import type { Command } from "commander";
import {
  confirmOrCancel,
  getTheme,
  intro,
  isCancel,
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
  type PlanSource
} from "@poe-code/plan-browser";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { resolveCommandFlags } from "./shared.js";

type OutputOption = "terminal" | "markdown" | "json";

type PlanCommandOptions = {
  source?: PlanSource;
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

  throw new ValidationError(`Invalid --output value "${value}". Expected one of: terminal, md, json.`);
}

function resolveSource(value: string | undefined): PlanSource | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  if (value === "pipeline" || value === "experiment" || value === "ralph") {
    return value;
  }

  throw new ValidationError(`Invalid --source value "${value}". Expected pipeline, experiment, or ralph.`);
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function discoverPlans(
  container: CliContainer,
  source: PlanSource | undefined
): Promise<PlanEntry[]> {
  return discoverAllPlans({
    cwd: container.env.cwd,
    homeDir: container.env.homeDir,
    configPath: container.env.configPath,
    projectConfigPath: container.env.projectConfigPath,
    fs: container.fs as Parameters<typeof discoverAllPlans>[0]["fs"],
    source,
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

    const matched = options.plans.find((plan) =>
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
      label: text.selectLabel(path.basename(plan.path), plan.status),
      hint: plan.source,
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

async function renderPlanList(
  container: CliContainer,
  options: PlanCommandOptions
): Promise<void> {
  const format = resolveOutputOption(options.output);
  const source = resolveSource(options.source);
  const plans = await discoverPlans(container, source);

  if (format === "json") {
    writeOutput(
      format,
      JSON.stringify(
        plans.map((plan) => ({
          source: plan.source,
          name: path.basename(plan.path),
          path: plan.path,
          detail: plan.status,
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
        source: plan.source,
        name: path.basename(plan.path),
        detail: plan.status,
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
      message: options.action === "archive"
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

  await deletePlan(
    plan,
    options.container.fs as unknown as Parameters<typeof deletePlan>[1]
  );
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
    .description("Browse, view, and manage plans across pipeline, experiment, and Ralph.")
    .option("--source <source>", "Filter by plan source: pipeline, experiment, or ralph")
    .action(async function (this: Command) {
      const opts = this.opts<PlanCommandOptions>();
      const flags = resolveCommandFlags(this);
      intro("plan browser");
      await runPlanBrowser({
        cwd: container.env.cwd,
        homeDir: container.env.homeDir,
        configPath: container.env.configPath,
        projectConfigPath: container.env.projectConfigPath,
        fs: container.fs as Parameters<typeof runPlanBrowser>[0]["fs"],
        source: resolveSource(opts.source),
        variables: container.env.variables,
        assumeYes: flags.assumeYes
      });
    });

  plan
    .command("list")
    .description("List plans across all plan systems.")
    .option("--source <source>", "Filter by plan source: pipeline, experiment, or ralph")
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command) {
      intro("plan list");
      await renderPlanList(container, resolvePlanCommandOptions(this));
    });

  plan
    .command("view")
    .description("Render a single plan to the terminal.")
    .argument("[path]", "Plan path")
    .option("--source <source>", "Filter by plan source: pipeline, experiment, or ralph")
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
              source: plan.source,
              path: plan.path,
              title: plan.title,
              detail: plan.status,
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
    .option("--source <source>", "Filter by plan source: pipeline, experiment, or ralph")
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
    .option("--source <source>", "Filter by plan source: pipeline, experiment, or ralph")
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
    .option("--source <source>", "Filter by plan source: pipeline, experiment, or ralph")
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
}
