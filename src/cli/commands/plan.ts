import path from "node:path";
import type { Command } from "commander";
import { stringify as stringifyYaml } from "yaml";
import {
  cancel,
  confirmOrCancel,
  getTheme,
  intro,
  isCancel,
  outro,
  promptText,
  renderMarkdown,
  renderTable,
  select,
  text,
  withOutputFormat
} from "toolcraft-design";
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
import { readMarkdown, readSection, runMarkdownReaderMcp } from "@poe-code/markdown-reader";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import { readMergedDocument, readMergedDocumentReadonly, resolveScope } from "@poe-code/poe-code-config";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { planConfigScope } from "../../services/config.js";
import {
  createExecutionResources,
  requireInteractiveStdin,
  resolveCommandFlags,
  resolveDefaultAgent
} from "./shared.js";
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
type MarkdownReadResult = Awaited<ReturnType<typeof readMarkdown>>;
type MarkdownReadSectionResult = Awaited<ReturnType<typeof readSection>>;

type PlanCommandOptions = {
  agent?: string;
  kind?: PlanKind;
  output?: string;
};

function resolvePlanCommandOptions(command: Command): PlanCommandOptions {
  const localOptions = command.opts<PlanCommandOptions>();
  const parentOptions = command.parent?.opts<PlanCommandOptions>() ?? {};

  return {
    kind: localOptions.kind ?? parentOptions.kind,
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

const VALID_KINDS: PlanKind[] = [
  "plan",
  "pipeline",
  "experiment",
  "ralph",
  "superintendent",
  "superintendent-base"
];

function resolveKind(value: string | undefined): PlanKind | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  if ((VALID_KINDS as string[]).includes(value)) {
    return value as PlanKind;
  }
  throw new ValidationError(`Invalid --kind value "${value}". Expected ${VALID_KINDS.join(", ")}.`);
}

function createPlanBrowserOptions(
  container: CliContainer,
  options: {
    kind: PlanKind | undefined;
    onCreatePlan?: () => Promise<void>;
  }
): Parameters<typeof runPlanBrowser>[0] {
  return {
    cwd: container.env.cwd,
    homeDir: container.env.homeDir,
    configPath: container.env.configPath,
    projectConfigPath: container.env.projectConfigPath,
    fs: container.fs as Parameters<typeof runPlanBrowser>[0]["fs"],
    kind: options.kind,
    variables: container.env.variables,
    ...(options.onCreatePlan ? { onCreatePlan: options.onCreatePlan } : {})
  };
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseNonNegativeInt(value: string | undefined, fieldName: string): number | undefined {
  if (value == null) {
    return undefined;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    [...trimmed].some((character) => character < "0" || character > "9")
  ) {
    throw new ValidationError(`Invalid ${fieldName} "${value}". Expected a non-negative integer.`);
  }

  return Number.parseInt(trimmed, 10);
}

function formatFrontmatterLines(frontmatter: Record<string, unknown>): string[] {
  if (Object.keys(frontmatter).length === 0) {
    return ["  (none)"];
  }

  return stringifyYaml(frontmatter)
    .trimEnd()
    .split("\n")
    .map((line) => `  ${line}`);
}

function getDisplayedSections(result: MarkdownReadResult): MarkdownReadResult["sections"] {
  return result.sections.filter((section) => section.number !== null);
}

function formatDisplayedSectionTitle(section: MarkdownReadResult["sections"][number]): string {
  if (!section.number) {
    return section.title;
  }

  const numberedPrefix = `${section.number}. `;
  return section.title.startsWith(numberedPrefix)
    ? section.title.slice(numberedPrefix.length)
    : section.title;
}

function formatMarkdownReadTerminalOutput(result: MarkdownReadResult): string {
  const sections = getDisplayedSections(result);
  const numberWidth = Math.max(0, ...sections.map((section) => section.number?.length ?? 0));
  const sectionLines =
    sections.length === 0
      ? ["  (none)"]
      : sections.map((section) => {
          const number = (section.number ?? "").padEnd(numberWidth);
          const separator = numberWidth > 0 ? "    " : "";
          return `  ${number}${separator}${formatDisplayedSectionTitle(section)}`.trimEnd();
        });

  return [
    `file: ${result.file}`,
    "frontmatter:",
    ...formatFrontmatterLines(result.frontmatter),
    "sections:",
    ...sectionLines
  ].join("\n");
}

function formatMarkdownReadMarkdownOutput(result: MarkdownReadResult): string {
  const sections = getDisplayedSections(result);
  const frontmatterBlock =
    Object.keys(result.frontmatter).length === 0
      ? "(none)"
      : stringifyYaml(result.frontmatter).trimEnd();
  const sectionLines =
    sections.length === 0
      ? ["- (none)"]
      : sections.map((section) =>
          section.number
            ? `- \`${section.number}\` ${formatDisplayedSectionTitle(section)}`
            : `- ${formatDisplayedSectionTitle(section)}`
        );

  return [
    "## File",
    "",
    `\`${result.file}\``,
    "",
    "## Frontmatter",
    "",
    "```yaml",
    frontmatterBlock,
    "```",
    "",
    "## Sections",
    "",
    ...sectionLines
  ].join("\n");
}

function formatMarkdownReadOutput(result: MarkdownReadResult, format: OutputOption): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  if (format === "markdown") {
    return formatMarkdownReadMarkdownOutput(result);
  }

  return formatMarkdownReadTerminalOutput(result);
}

function formatMarkdownReadSectionOutput(
  result: MarkdownReadSectionResult,
  format: OutputOption
): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  if (format === "terminal") {
    return renderMarkdown(result.markdown).trimEnd();
  }

  return result.markdown.trimEnd();
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

async function requirePlanBrowsingPrompt(options: {
  container: CliContainer;
  kind: PlanKind | undefined;
  assumeYes: boolean;
}): Promise<void> {
  if (!options.assumeYes && process.stdin.isTTY === true) {
    return;
  }
  const plans = await discoverPlans(options.container, options.kind);
  if (plans.length === 0) {
    return;
  }
  throw new ValidationError(formatPlanPathRequired(plans));
}

function formatPlanPathRequired(plans: PlanEntry[]): string {
  return [
    "Name the plan you want: pass an explicit plan path. --yes and non-interactive runs never pick one for you.",
    "",
    "Plans:",
    ...plans.map((plan) => `- ${plan.path}`)
  ].join("\n");
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

  if (options.assumeYes || process.stdin.isTTY !== true) {
    throw new ValidationError(formatPlanPathRequired(options.plans));
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
  const kind = resolveKind(options.kind);
  const plans = await discoverPlans(container, kind);

  if (format === "json") {
    writeOutput(
      format,
      JSON.stringify(
        plans.map((plan) => ({
          kind: plan.kind,
          type: plan.typeLabel,
          runner: plan.runner,
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
        { name: "kind", title: "Kind", alignment: "left", maxLen: 20 },
        { name: "type", title: "Type", alignment: "left", maxLen: 24 },
        { name: "name", title: "Name", alignment: "left", maxLen: 32 },
        { name: "detail", title: "Detail", alignment: "left", maxLen: 40 },
        { name: "updated", title: "Updated", alignment: "left", maxLen: 12 }
      ],
      rows: plans.map((plan) => ({
        kind: plan.kind,
        type: plan.typeLabel,
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
  kind?: string;
  output?: string;
}): Promise<void> {
  const flags = resolveCommandFlags(options.program);
  const format = resolveOutputOption(options.output);
  if (format === "terminal") {
    intro(`plan ${options.action}`);
  }
  const plans = await discoverPlans(options.container, resolveKind(options.kind));
  const plan = await resolveSelectedPlan({
    container: options.container,
    plans,
    providedPath: options.pathArg,
    assumeYes: flags.assumeYes || (format === "json" && options.action !== "edit"),
    promptMessage: `Select a plan to ${options.action}`
  });

  if (flags.dryRun) {
    writeOutput(
      format,
      format === "json"
        ? JSON.stringify({ action: options.action, path: plan.path, dryRun: true }, null, 2)
        : `Would ${options.action} ${plan.path}`
    );
    return;
  }

  if (options.action === "edit") {
    const { changed } = await editPlan(plan.absolutePath, {
      env: options.container.env.variables,
      fs: options.container.fs
    });
    const message = changed ? `Edited ${plan.path}` : `No changes to ${plan.path}`;
    if (format === "terminal") {
      outro(message);
      return;
    }
    writeOutput(
      format,
      format === "json"
        ? JSON.stringify({ action: "edit", path: plan.path, changed }, null, 2)
        : message
    );
    return;
  }

  if (!flags.assumeYes) {
    if (format === "json") {
      writeOutput(
        format,
        JSON.stringify(
          {
            action: options.action,
            path: plan.path,
            confirmationRequired: true,
            skipped: true
          },
          null,
          2
        )
      );
      return;
    }

    requireInteractiveStdin(
      `plan ${options.action} requires --yes when running without an interactive TTY.`
    );

    const confirmed = await confirmOrCancel({
      message:
        options.action === "archive"
          ? `Archive ${path.basename(plan.path)}?`
          : `Permanently delete ${path.basename(plan.path)}?`,
      initialValue: false
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
    .description(
      "Browse plans in an interactive explorer, or draft a new plan when given a question."
    )
    .argument("[question]", "What you want to plan")
    .option("--agent <name>", "Agent to run the plan session with")
    .option(
      "--kind <kind>",
      "Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .addHelpText("after", "\nExplorer keymap: e edit, a archive, d delete, n new")
    .action(async function (this: Command, questionArg?: string) {
      const opts = this.opts<PlanCommandOptions>();
      const flags = resolveCommandFlags(program);
      const kind = resolveKind(opts.kind);
      const question = questionArg?.trim() ?? "";

      if (question.length > 0) {
        const agent = await resolvePlanSessionAgent(container, opts.agent, flags);
        if (agent === null) {
          return;
        }
        await runPlanSession({
          container,
          agent,
          question,
          dryRun: flags.dryRun
        });
        return;
      }

      if (flags.assumeYes) {
        throw new ValidationError(
          "A question is required for `poe-code plan`. Pass it as the first argument."
        );
      }

      await requirePlanBrowsingPrompt({ container, kind, assumeYes: flags.assumeYes });

      intro("plan");
      await runPlanBrowser(
        createPlanBrowserOptions(container, {
          kind,
          onCreatePlan: () => runPlanSessionWithPrompt(container, opts.agent, flags)
        })
      );
    });

  plan
    .command("browse")
    .description("Browse plans in the interactive explorer.")
    .option(
      "--kind <kind>",
      "Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .action(async function (this: Command) {
      const opts = resolvePlanCommandOptions(this);
      const flags = resolveCommandFlags(program);
      const kind = resolveKind(opts.kind);
      await requirePlanBrowsingPrompt({ container, kind, assumeYes: flags.assumeYes });
      intro("plan browser");
      await runPlanBrowser(createPlanBrowserOptions(container, { kind }));
    });

  plan
    .command("list")
    .description("List plans across all plan systems.")
    .option(
      "--kind <kind>",
      "Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command) {
      const options = resolvePlanCommandOptions(this);
      if (resolveOutputOption(options.output) === "terminal") {
        intro("plan list");
      }
      await renderPlanList(container, options);
    });

  plan
    .command("view")
    .description("Render a single plan to the terminal.")
    .argument("[path]", "Plan path")
    .option(
      "--kind <kind>",
      "Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command, pathArg?: string) {
      const flags = resolveCommandFlags(program);
      const options = resolvePlanCommandOptions(this);
      const format = resolveOutputOption(options.output);
      if (format === "terminal") {
        intro("plan view");
      }
      const plans = await discoverPlans(container, resolveKind(options.kind));
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
              kind: plan.kind,
              type: plan.typeLabel,
              runner: plan.runner,
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
    .command("markdown-read")
    .description("Read a markdown file and print its table of contents.")
    .argument("<file>", "Markdown file")
    .option("--depth <n>", "Limit the table of contents to headings at depth <= n")
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command, file: string) {
      const options = this.opts<{ depth?: string; output?: string }>();
      const format = resolveOutputOption(options.output);
      const result = await readMarkdown({
        file,
        depth: parseNonNegativeInt(options.depth, "depth")
      });

      writeOutput(format, formatMarkdownReadOutput(result, format));
    });

  plan
    .command("markdown-read-section")
    .description("Read one section from a markdown file.")
    .argument("<file>", "Markdown file")
    .argument("<section>", "Section number or heading text")
    .option("--no-include-children", "Exclude nested child sections")
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command, file: string, section: string) {
      const options = this.opts<{ includeChildren?: boolean; output?: string }>();
      const format = resolveOutputOption(options.output ?? "markdown");
      const result = await readSection({
        file,
        section,
        includeChildren: options.includeChildren
      });

      writeOutput(format, formatMarkdownReadSectionOutput(result, format));
    });

  plan
    .command("markdown-reader-mcp")
    .description("Run the standalone markdown reader MCP server.")
    .action(async () => {
      await runMarkdownReaderMcp();
    });

  plan
    .command("edit")
    .description("Open a plan in $EDITOR.")
    .argument("[path]", "Plan path")
    .option(
      "--kind <kind>",
      "Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
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
      "--kind <kind>",
      "Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
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
      "--kind <kind>",
      "Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
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
        const agent = await resolvePlanAgent(container, options.agent, flags);
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

  requireInteractiveStdin(
    "Plan question prompt requires a question when running without an interactive TTY."
  );

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

async function resolvePlanSessionAgent(
  container: CliContainer,
  value: string | undefined,
  flags: { assumeYes: boolean; dryRun: boolean }
): Promise<string | null> {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length > 0) {
    return trimmed;
  }

  if (flags.assumeYes) {
    const fromConfig = await resolveDefaultAgent(container, { readOnly: flags.dryRun });
    return fromConfig !== null ? parseAgentSpecifier(fromConfig).agent : DEFAULT_PLAN_AGENT;
  }

  requireInteractiveStdin(
    "Plan session agent selection requires --agent or --yes when running without an interactive TTY."
  );

  const selected = await select({
    message: "Select agent to draft the plan with:",
    options: supportedAgents.map((name) => ({ value: name, label: name }))
  });
  if (isCancel(selected)) {
    cancel("Plan session cancelled.");
    return null;
  }

  return selected as string;
}

async function runPlanSessionWithPrompt(
  container: CliContainer,
  agentValue: string | undefined,
  flags: { assumeYes: boolean; dryRun: boolean }
): Promise<void> {
  const question = await resolvePlanQuestion(undefined, flags.assumeYes);
  if (question === null) {
    return;
  }

  const agent = await resolvePlanSessionAgent(container, agentValue, flags);
  if (agent === null) {
    return;
  }

  await runPlanSession({
    container,
    agent,
    question,
    dryRun: flags.dryRun
  });
}

export async function resolvePlanDirectory(
  container: CliContainer,
  options: { readOnly?: boolean } = {}
): Promise<string> {
  const readConfig = options.readOnly ? readMergedDocumentReadonly : readMergedDocument;
  const document = await readConfig(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const config = resolveScope(
    planConfigScope.schema,
    document[planConfigScope.scope],
    container.env.variables
  );
  return config.plan_directory;
}

interface RunPlanSessionOptions {
  container: CliContainer;
  agent: string;
  question: string;
  dryRun?: boolean;
}

async function runPlanSession(options: RunPlanSessionOptions): Promise<void> {
  const planDirectory = await resolvePlanDirectory(options.container, { readOnly: options.dryRun });
  const prompt = buildPlanPrompt({
    question: options.question,
    planDirectory,
    skillContent: planSkillTemplate
  });

  if (options.dryRun) {
    const resources = createExecutionResources(
      options.container,
      { assumeYes: true, dryRun: true, verbose: false },
      "plan"
    );
    resources.logger.dryRun(
      `Dry run: would run plan session with ${options.agent} for ${options.question}.`
    );
    return;
  }

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
  flags: { assumeYes: boolean; dryRun: boolean }
): Promise<string | null> {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length > 0) {
    return trimmed;
  }

  if (flags.assumeYes) {
    const fromConfig = await resolveDefaultAgent(container, { readOnly: flags.dryRun });
    return fromConfig !== null ? parseAgentSpecifier(fromConfig).agent : DEFAULT_PLAN_AGENT;
  }

  requireInteractiveStdin(
    "Plan install agent selection requires --agent or --yes when running without an interactive TTY."
  );

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

  requireInteractiveStdin(
    "Plan install scope selection requires --local, --global, or --yes when running without an interactive TTY."
  );

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
