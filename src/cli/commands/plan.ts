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
  renderDetailCard,
  renderMarkdown,
  renderTable,
  select,
  text,
  withOutputFormat,
  type DetailCardRow
} from "toolcraft-design";
import {
  archivePlan,
  deletePlan,
  discoverAllPlans,
  editPlan,
  loadPlanPreviewMarkdown,
  runPlanBrowser,
  unarchivePlan,
  type PlanEntry,
  type PlanKind
} from "@poe-code/plan-browser";
import {
  installSkill,
  resolveAgentSupport,
  supportedAgents,
  type SkillScope
} from "@poe-code/agent-skill-config";
import { UserError } from "toolcraft";
import { readMarkdown, readSection, runMarkdownReaderMcp } from "@poe-code/markdown-reader";
import { formatAgentCapabilityError } from "@poe-code/agent-defs";
import {
  readMergedDocument,
  readMergedDocumentReadonly,
  resolveScope
} from "@poe-code/poe-code-config/core";
import type { CliContainer } from "../container.js";
import { throwCommandNotFound } from "../command-not-found.js";
import { setHelpGuidance } from "./help-guidance.js";
import { OperationCancelledError, ValidationError } from "../errors.js";
import { planConfigScope } from "../../services/config.js";
import {
  announceAssumedScope,
  createExecutionResources,
  requireInteractiveStdin,
  resolveAssumedDefaultAgent,
  resolveCommandFlags
} from "./shared.js";
import type { ScopedLogger } from "../logger.js";
import planSkillTemplate from "../../templates/plan/SKILL_plan.md";

const DEFAULT_PLAN_SCOPE: SkillScope = "local";

type OutputOption = "terminal" | "markdown" | "json";
type MarkdownReadResult = Awaited<ReturnType<typeof readMarkdown>>;
type MarkdownReadSectionResult = Awaited<ReturnType<typeof readSection>>;

type PlanCommandOptions = {
  kind?: PlanKind;
  output?: string;
  archived?: boolean;
};

function resolvePlanCommandOptions(command: Command): PlanCommandOptions {
  const localOptions = command.opts<PlanCommandOptions>();
  const parentOptions = command.parent?.opts<PlanCommandOptions>() ?? {};

  return {
    kind: localOptions.kind ?? parentOptions.kind,
    output: localOptions.output ?? parentOptions.output,
    archived: localOptions.archived ?? parentOptions.archived
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
  kind: PlanKind | undefined,
  archived = false
): Parameters<typeof runPlanBrowser>[0] {
  return {
    cwd: container.env.cwd,
    homeDir: container.env.homeDir,
    configPath: container.env.configPath,
    projectConfigPath: container.env.projectConfigPath,
    fs: container.fs as Parameters<typeof runPlanBrowser>[0]["fs"],
    kind,
    archived,
    variables: container.env.variables
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

function formatFrontmatterRows(frontmatter: Record<string, unknown>): DetailCardRow[] {
  return Object.entries(frontmatter).map(([key, value]) => ({
    label: key,
    value:
      value === null || typeof value !== "object" ? String(value) : stringifyYaml(value).trimEnd()
  }));
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
  const frontmatterRows = formatFrontmatterRows(result.frontmatter);

  return renderDetailCard({
    theme: getTheme(),
    title: result.file,
    subtitle: `${sections.length} ${sections.length === 1 ? "section" : "sections"}`,
    sections: [
      {
        title: "Frontmatter",
        rows: frontmatterRows.length === 0 ? [{ label: "(none)", value: "" }] : frontmatterRows
      },
      {
        title: "Sections",
        rows:
          sections.length === 0
            ? [{ label: "(none)", value: "" }]
            : sections.map((section) => ({
                label: section.number ?? "",
                value: formatDisplayedSectionTitle(section)
              }))
      }
    ]
  });
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
  kind: PlanKind | undefined,
  archived = false
): Promise<PlanEntry[]> {
  return discoverAllPlans({
    cwd: container.env.cwd,
    homeDir: container.env.homeDir,
    configPath: container.env.configPath,
    projectConfigPath: container.env.projectConfigPath,
    fs: container.fs as Parameters<typeof discoverAllPlans>[0]["fs"],
    kind,
    archived,
    variables: container.env.variables
  });
}

async function requirePlanBrowsingPrompt(options: {
  container: CliContainer;
  kind: PlanKind | undefined;
  assumeYes: boolean;
  archived?: boolean;
}): Promise<void> {
  if (!options.assumeYes && process.stdin.isTTY === true) {
    return;
  }
  const plans = await discoverPlans(options.container, options.kind, options.archived);
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
    throw new OperationCancelledError("Plan selection cancelled.");
  }

  const matched = options.plans.find((plan) => plan.absolutePath === selected);
  if (!matched) {
    throw new ValidationError("Plan selection cancelled.");
  }

  return matched;
}

// The markdown reader reports bad input as a toolcraft UserError, which the CLI
// would otherwise render as an internal failure with an "Error:" prefix and a log
// pointer. Re-throwing as ValidationError matches `plan view`'s clean not-found
// output.
async function readWithUserErrors<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof UserError) {
      throw new ValidationError(
        `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}`
      );
    }
    throw error;
  }
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
  const plans = await discoverPlans(container, kind, options.archived);

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

  if (plans.length === 0) {
    const scope = kind === undefined ? "" : `${kind} `;
    writeOutput(format, `No ${scope}plans found.`);
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
  action: "edit" | "archive" | "unarchive" | "delete";
  pathArg?: string;
  kind?: string;
  output?: string;
}): Promise<void> {
  const flags = resolveCommandFlags(options.program);
  const format = resolveOutputOption(options.output);
  if (format === "terminal") {
    intro(`plan ${options.action}`);
  }
  const plans = await discoverPlans(
    options.container,
    resolveKind(options.kind),
    options.action === "unarchive"
  );
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
    requireInteractiveStdin("plan edit opens $EDITOR and requires an interactive TTY.");

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
          : options.action === "unarchive"
            ? `Unarchive ${path.basename(plan.path)}?`
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

  if (options.action === "unarchive") {
    const restoredPath = await unarchivePlan(
      plan,
      options.container.fs as unknown as Parameters<typeof unarchivePlan>[1]
    );
    writeOutput(
      format,
      format === "json"
        ? JSON.stringify({ action: "unarchive", path: plan.path, restoredPath }, null, 2)
        : `Unarchived ${plan.path}`
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
    .alias("plans")
    .description("Browse and manage plans.")
    .usage("[options] [command]")
    .allowExcessArguments()
    .option(
      "--kind <kind>",
      "Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .option("--archived", "Browse archived plans instead of active plans")
    .action(async function (this: Command) {
      if (this.args.length > 0) {
        const candidates = plan.commands.flatMap((command) => [
          command.name(),
          ...command.aliases()
        ]);
        throwCommandNotFound({
          container,
          scope: "cli",
          unknownCommand: this.args.at(0) ?? "",
          helpArgs: ["plan", "--help"],
          candidates,
          moduleUrl: import.meta.url
        });
      }

      const opts = this.opts<PlanCommandOptions>();
      const flags = resolveCommandFlags(program);
      const kind = resolveKind(opts.kind);

      await requirePlanBrowsingPrompt({
        container,
        kind,
        assumeYes: flags.assumeYes,
        archived: opts.archived
      });

      intro("plan");
      await runPlanBrowser(createPlanBrowserOptions(container, kind, opts.archived));
    });

  plan
    .command("browse")
    .description("Browse plans in the interactive explorer, or render one plan when given a path.")
    .argument("[path]", "Plan path to render instead of opening the explorer")
    .option(
      "--kind <kind>",
      "Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .option("--archived", "Browse archived plans instead of active plans")
    .action(async function (this: Command, pathArg?: string) {
      const opts = resolvePlanCommandOptions(this);
      const flags = resolveCommandFlags(program);
      const kind = resolveKind(opts.kind);

      if ((pathArg?.trim() ?? "").length > 0) {
        const plans = await discoverPlans(container, kind, opts.archived);
        const selected = await resolveSelectedPlan({
          container,
          plans,
          providedPath: pathArg,
          assumeYes: flags.assumeYes,
          promptMessage: "Select a plan to view"
        });
        const markdown = await loadPlanPreviewMarkdown(selected, container.fs);
        writeOutput("terminal", renderMarkdown(markdown).trimEnd());
        return;
      }

      await requirePlanBrowsingPrompt({
        container,
        kind,
        assumeYes: flags.assumeYes,
        archived: opts.archived
      });
      intro("plan browser");
      await runPlanBrowser(createPlanBrowserOptions(container, kind, opts.archived));
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
    .option("--include-content", "Include the full plan body in json output")
    .action(async function (this: Command, pathArg?: string) {
      const flags = resolveCommandFlags(program);
      const options = resolvePlanCommandOptions(this);
      const format = resolveOutputOption(options.output);
      if (format === "terminal") {
        intro("plan view");
      }
      const plans = await discoverPlans(container, resolveKind(options.kind), options.archived);
      const plan = await resolveSelectedPlan({
        container,
        plans,
        providedPath: pathArg,
        assumeYes: flags.assumeYes,
        promptMessage: "Select a plan to view"
      });

      if (format === "json") {
        const includeContent = this.opts<{ includeContent?: boolean }>().includeContent === true;
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
              ...(includeContent
                ? { content: await loadPlanPreviewMarkdown(plan, container.fs) }
                : {})
            },
            null,
            2
          )
        );
        return;
      }

      const markdown = await loadPlanPreviewMarkdown(plan, container.fs);
      const output = format === "markdown" ? markdown : renderMarkdown(markdown);
      writeOutput(format, output.trimEnd());
    });

  plan
    .command("markdown-read")
    .description("Read a markdown file and print its table of contents.")
    .argument("<file>", "Markdown file")
    .option("--depth <n>", "Limit the table of contents to <n> levels of numbered sections")
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command, file: string) {
      const options = this.opts<{ depth?: string; output?: string }>();
      const format = resolveOutputOption(options.output);
      const result = await readWithUserErrors(() =>
        readMarkdown({
          file,
          depth: parseNonNegativeInt(options.depth, "depth")
        })
      );

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
      const result = await readWithUserErrors(() =>
        readSection({
          file,
          section,
          includeChildren: options.includeChildren
        })
      );

      writeOutput(format, formatMarkdownReadSectionOutput(result, format));
    });

  plan
    .command("markdown-reader-mcp")
    .description("Run the standalone markdown reader MCP server.")
    .addHelpText(
      "after",
      [
        "",
        "The server speaks MCP over stdio: it reads requests on stdin and writes replies",
        "on stdout, staying in the foreground until the client disconnects. It exposes",
        "two tools: `read` (frontmatter plus table of contents) and `read-section` (one",
        "section by number or heading text).",
        "",
        "Register it with an MCP client:",
        "",
        "  {",
        '    "mcpServers": {',
        '      "markdown-reader": {',
        '        "command": "poe-code",',
        '        "args": ["plan", "markdown-reader-mcp"]',
        "      }",
        "    }",
        "  }"
      ].join("\n")
    )
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
    .command("unarchive")
    .description("Move an archived plan back into the active plan directory.")
    .argument("[path]", "Archived plan path")
    .option(
      "--kind <kind>",
      "Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or superintendent-base"
    )
    .option("--output <format>", "Output format: terminal, md, or json")
    .action(async function (this: Command, pathArg?: string) {
      await executePlanAction({
        program,
        container,
        action: "unarchive",
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
      const options = this.opts<{
        agent?: string;
        local?: boolean;
        global?: boolean;
      }>();

      if (options.local && options.global) {
        throw new ValidationError("Use either --local or --global, not both.");
      }

      const resources = createExecutionResources(container, flags, "plan:install");

      try {
        const agent = await resolvePlanAgent(container, options.agent, flags, resources.logger);
        if (agent === null) {
          return;
        }

        const support = resolveAgentSupport(agent);
        if (support.status !== "supported" || !support.id) {
          throw new ValidationError(formatAgentCapabilityError({ agent, capability: "skill" }));
        }

        const scope = await resolvePlanScope(options, flags.assumeYes, resources.logger);
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

  setHelpGuidance(plan, {
    examples: [
      "poe-code plan",
      "poe-code plans",
      "poe-code plan --kind pipeline",
      "poe-code plan list --kind experiment",
      "poe-code plan view docs/plans/my-plan.md",
      "poe-code plan install --local"
    ],
    notes: ["Interactive explorer keys: e edit, a archive, d delete."]
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

async function resolvePlanAgent(
  container: CliContainer,
  value: string | undefined,
  flags: { assumeYes: boolean; dryRun: boolean },
  logger: ScopedLogger
): Promise<string | null> {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length > 0) {
    return trimmed;
  }

  if (flags.assumeYes) {
    return await resolveAssumedDefaultAgent({ container, logger, readOnly: flags.dryRun });
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
  assumeYes: boolean,
  logger: ScopedLogger
): Promise<SkillScope | null> {
  if (options.local) {
    return "local";
  }
  if (options.global) {
    return "global";
  }
  if (assumeYes) {
    announceAssumedScope(logger, DEFAULT_PLAN_SCOPE);
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
