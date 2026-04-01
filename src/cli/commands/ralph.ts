import path from "node:path";
import type { Command } from "commander";
import {
  cancel,
  isCancel,
  promptText,
  select,
  text as designText
} from "@poe-code/design-system";
import { resolveAgentId } from "@poe-code/agent-defs";
import { allSpawnConfigs } from "@poe-code/agent-spawn";
import {
  discoverDocs,
  parseFrontmatter,
  writeFrontmatter,
  type RalphFrontmatter
} from "@poe-code/ralph";
import {
  readMergedDocument,
  resolveScope
} from "@poe-code/poe-code-config";
import type { CliContainer } from "../container.js";
import { ralphConfigScope } from "../../services/config.js";
import { ValidationError } from "../errors.js";
import {
  createExecutionResources,
  resolveCommandFlags
} from "./shared.js";
import { runRalph as sdkRunRalph } from "../../sdk/ralph.js";

const DEFAULT_RALPH_AGENT = "claude-code";
const DEFAULT_RALPH_ITERATIONS = 3;

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function resolveRalphAgent(
  value: string | undefined,
  sourceLabel = "agent"
): string {
  if (!value || value.trim().length === 0) {
    return DEFAULT_RALPH_AGENT;
  }

  const resolved = resolveAgentId(value.trim());
  if (!resolved) {
    throw new ValidationError(`Unsupported ${sourceLabel}: ${value}`);
  }

  return resolved;
}

function parsePositiveInt(
  value: string | undefined,
  fieldName: string
): number | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ValidationError(
      `Invalid ${fieldName} "${value}". Expected a positive integer.`
    );
  }

  return parsed;
}

function normalizeConfiguredIterations(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

function resolveAbsoluteDocPath(container: CliContainer, docPath: string): string {
  if (docPath.startsWith("~/")) {
    return path.join(container.env.homeDir, docPath.slice(2));
  }

  return path.isAbsolute(docPath)
    ? docPath
    : path.resolve(container.env.cwd, docPath);
}

async function resolvePlanDirectory(
  container: CliContainer
): Promise<string | undefined> {
  const configDoc = await readMergedDocument(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const ralphConfig = resolveScope(
    ralphConfigScope.schema,
    configDoc[ralphConfigScope.scope],
    container.env.variables
  );
  const configDir = ralphConfig.plan_directory?.trim();
  return configDir || undefined;
}

function formatDocHint(frontmatter: RalphFrontmatter): string | undefined {
  const parts: string[] = [];

  if (frontmatter.agent !== undefined) {
    const agents = Array.isArray(frontmatter.agent)
      ? frontmatter.agent
      : [frontmatter.agent];
    if (agents.length > 0) {
      parts.push(agents.join(", "));
    }
  }

  if (frontmatter.iterations !== undefined) {
    parts.push(`×${frontmatter.iterations}`);
  }

  if (frontmatter.status.state !== "open" || frontmatter.status.iteration > 0) {
    parts.push(`${frontmatter.status.state} ${frontmatter.status.iteration}`);
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

async function readDocHint(
  container: CliContainer,
  docPath: string
): Promise<string | undefined> {
  const absolutePath = resolveAbsoluteDocPath(container, docPath);
  try {
    const content = await container.fs.readFile(absolutePath, "utf8");
    const { data } = parseFrontmatter(content);
    return formatDocHint(data);
  } catch {
    return undefined;
  }
}

async function resolveDocPath(options: {
  container: CliContainer;
  program: Command;
  providedDoc?: string;
  planDirectory?: string;
}): Promise<string | null> {
  if (options.providedDoc && options.providedDoc.trim().length > 0) {
    return options.providedDoc.trim();
  }

  const docs = await discoverDocs({
    cwd: options.container.env.cwd,
    homeDir: options.container.env.homeDir,
    planDirectory: options.planDirectory,
    fs: options.container.fs
  });
  if (docs.length === 0) {
    throw new ValidationError(
      "No markdown doc found under .poe-code/ralph/plans/ or ~/.poe-code/ralph/plans/. Provide a doc path."
    );
  }

  const flags = resolveCommandFlags(options.program);
  if (flags.assumeYes) {
    return docs[0]!.path;
  }

  const hints = await Promise.all(
    docs.map((doc) => readDocHint(options.container, doc.path))
  );

  const selected = await select({
    message: "Select the Ralph markdown doc to run:",
    options: docs.map((doc, index) => ({
      label: designText.selectLabel(doc.displayPath, hints[index]),
      value: doc.path
    }))
  });
  if (isCancel(selected)) {
    cancel("Ralph run cancelled.");
    return null;
  }

  return typeof selected === "string" ? selected : null;
}

async function readRalphDoc(
  container: CliContainer,
  docPath: string
): Promise<{
  absolutePath: string;
  body: string;
  data: RalphFrontmatter;
}> {
  const absolutePath = resolveAbsoluteDocPath(container, docPath);

  try {
    const content = await container.fs.readFile(absolutePath, "utf8");
    const parsed = parseFrontmatter(content);
    return {
      absolutePath,
      body: parsed.body,
      data: parsed.data
    };
  } catch {
    throw new ValidationError(`Ralph doc not found: ${docPath}`);
  }
}

function resolveConfiguredAgents(
  value: RalphFrontmatter["agent"]
): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return resolveRalphAgent(value, "frontmatter agent");
  }

  if (value.length === 0) {
    throw new ValidationError("Frontmatter agent array must not be empty.");
  }

  return value.map((entry) => resolveRalphAgent(entry, "frontmatter agent"));
}

async function promptForAgent(program: Command): Promise<string | null> {
  const flags = resolveCommandFlags(program);
  if (flags.assumeYes) {
    return DEFAULT_RALPH_AGENT;
  }

  const selected = await select({
    message: "Select agent to run Ralph with:",
    options: allSpawnConfigs.map((config) => ({
      label: config.agentId,
      value: config.agentId
    }))
  });
  if (isCancel(selected)) {
    cancel("Ralph run cancelled.");
    return null;
  }

  return resolveRalphAgent(typeof selected === "string" ? selected : undefined);
}

async function resolveRunAgent(options: {
  program: Command;
  providedAgent?: string;
  frontmatterAgent?: RalphFrontmatter["agent"];
}): Promise<string | string[] | null> {
  if (options.providedAgent) {
    return resolveRalphAgent(options.providedAgent);
  }

  const configured = resolveConfiguredAgents(options.frontmatterAgent);
  if (configured !== undefined) {
    return configured;
  }

  return promptForAgent(options.program);
}

async function resolveRunIterations(options: {
  program: Command;
  providedIterations?: string;
  frontmatterIterations?: number;
}): Promise<number | null> {
  const explicitIterations = parsePositiveInt(
    options.providedIterations,
    "iterations"
  );
  if (explicitIterations != null) {
    return explicitIterations;
  }

  const configuredIterations = normalizeConfiguredIterations(
    options.frontmatterIterations
  );
  if (configuredIterations != null) {
    return configuredIterations;
  }

  const flags = resolveCommandFlags(options.program);
  if (flags.assumeYes) {
    return DEFAULT_RALPH_ITERATIONS;
  }

  const entered = await promptText({
    message: "How many Ralph iterations should run?"
  });
  if (isCancel(entered)) {
    cancel("Ralph run cancelled.");
    return null;
  }

  return parsePositiveInt(
    typeof entered === "string" ? entered.trim() : undefined,
    "iterations"
  ) ?? null;
}

async function resolveInitAgent(options: {
  program: Command;
  providedAgent?: string;
}): Promise<string | null> {
  if (options.providedAgent) {
    return resolveRalphAgent(options.providedAgent);
  }

  return promptForAgent(options.program);
}

async function resolveInitIterations(options: {
  program: Command;
  providedIterations?: string;
}): Promise<number | null> {
  const explicitIterations = parsePositiveInt(
    options.providedIterations,
    "iterations"
  );
  if (explicitIterations != null) {
    return explicitIterations;
  }

  const flags = resolveCommandFlags(options.program);
  if (flags.assumeYes) {
    return DEFAULT_RALPH_ITERATIONS;
  }

  const entered = await promptText({
    message: "How many Ralph iterations should run?"
  });
  if (isCancel(entered)) {
    cancel("Ralph init cancelled.");
    return null;
  }

  return parsePositiveInt(
    typeof entered === "string" ? entered.trim() : undefined,
    "iterations"
  ) ?? null;
}

function formatCurrentConfig(frontmatter: RalphFrontmatter): string | null {
  if (frontmatter.agent === undefined && frontmatter.iterations === undefined) {
    return null;
  }

  const items: string[] = [];
  if (frontmatter.iterations !== undefined) {
    items.push(String(frontmatter.iterations));
  }

  const agentList = expandAgentList(frontmatter.agent, frontmatter.iterations);
  if (agentList.length > 0) {
    items.push(...agentList);
  }

  return items.length > 0 ? `Current: ${items.join(", ")}` : null;
}

function expandAgentList(
  agent: RalphFrontmatter["agent"],
  iterations: number | undefined
): string[] {
  if (agent === undefined) {
    return [];
  }

  if (typeof agent === "string") {
    const count = normalizeConfiguredIterations(iterations) ?? 1;
    return Array.from({ length: count }, () => agent);
  }

  if (agent.length === 0) {
    return [];
  }

  const count = normalizeConfiguredIterations(iterations) ?? agent.length;
  return Array.from({ length: count }, (_, index) => agent[index % agent.length]!);
}

export function registerRalphCommand(
  program: Command,
  container: CliContainer
): void {
  const ralph = program
    .command("ralph")
    .description("Run a simple iterative markdown loop.");

  ralph
    .command("init")
    .description("Write Ralph config into an existing markdown doc frontmatter.")
    .argument("[doc]", "Markdown doc path")
    .option("--agent <name>", "Agent to write into frontmatter")
    .option("--iterations <n>", "Number of iterations to write into frontmatter")
    .action(async function (this: Command, docArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "ralph:init");
      const options = this.opts<{
        agent?: string;
        iterations?: string;
      }>();

      resources.logger.intro("ralph init");

      try {
        const planDirectory = await resolvePlanDirectory(container);
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          planDirectory
        });
        if (!docPath) {
          return;
        }

        const doc = await readRalphDoc(container, docPath);
        const currentConfig = formatCurrentConfig(doc.data);
        if (!options.agent && !options.iterations && !flags.assumeYes && currentConfig) {
          resources.logger.info(currentConfig);
        }

        const agent = await resolveInitAgent({
          program,
          providedAgent: options.agent
        });
        if (!agent) {
          return;
        }

        const iterations = await resolveInitIterations({
          program,
          providedIterations: options.iterations
        });
        if (iterations == null) {
          return;
        }

        const updated = writeFrontmatter(
          {
            agent,
            iterations,
            status: {
              state: doc.data.status.state,
              iteration: doc.data.status.iteration
            }
          },
          doc.body
        );
        await container.fs.writeFile(doc.absolutePath, updated, { encoding: "utf8" });

        resources.logger.resolved(
          "Initialized Ralph config",
          `Doc: ${docPath}\n   Agent: ${agent}\n   Iterations: ${iterations}`
        );
        resources.logger.success("Ralph config saved.");
      } finally {
        resources.context.finalize();
      }
    });

  ralph
    .command("run")
    .description("Run the selected markdown doc through repeated agent iterations.")
    .argument("[doc]", "Markdown doc path")
    .option("--agent <name>", "Override the agent from frontmatter")
    .option("--iterations <n>", "Override iterations from frontmatter")
    .option("--model <model>", "Model override passed to the agent")
    .action(async function (this: Command, docArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "ralph:run");
      const options = this.opts<{
        agent?: string;
        iterations?: string;
        model?: string;
      }>();

      resources.logger.intro("ralph run");

      try {
        const planDirectory = await resolvePlanDirectory(container);
        const docPath = await resolveDocPath({
          container,
          program,
          providedDoc: docArg,
          planDirectory
        });
        if (!docPath) {
          return;
        }

        const doc = await readRalphDoc(container, docPath);
        const agent = await resolveRunAgent({
          program,
          providedAgent: options.agent,
          frontmatterAgent: doc.data.agent
        });
        if (!agent) {
          return;
        }

        const maxIterations = await resolveRunIterations({
          program,
          providedIterations: options.iterations,
          frontmatterIterations: doc.data.iterations
        });
        if (maxIterations == null) {
          return;
        }

        const result = await sdkRunRalph({
          agent,
          cwd: container.env.cwd,
          homeDir: container.env.homeDir,
          docPath,
          maxIterations,
          ...(options.model ? { model: options.model } : {}),
          onIterationStart(iteration, total, currentAgent) {
            resources.logger.info(`Iteration ${iteration}/${total} (${currentAgent})`);
          },
          onIterationComplete(iteration, durationMs, success) {
            const status = success ? "done" : "failed";
            resources.logger.info(
              `Iteration ${iteration} ${status} in ${formatDuration(durationMs)}`
            );
          }
        });

        const summary = [
          `Iterations: ${result.iterationsCompleted}/${maxIterations}`,
          `Doc: ${result.docPath}`,
          `Duration: ${formatDuration(result.totalDurationMs)}`
        ].join("\n   ");

        if (result.stopReason === "cancelled") {
          process.exitCode = 130;
          resources.logger.warn("Ralph run cancelled.");
          resources.logger.resolved("Run summary", summary);
          return;
        }

        if (result.stopReason === "failed") {
          process.exitCode = 1;
          resources.logger.error("Agent run failed.");
          resources.logger.resolved("Run summary", summary);
          return;
        }

        resources.logger.resolved("Run summary", summary);
        resources.logger.success("Ralph run finished.");
      } finally {
        resources.context.finalize();
      }
    });
}
