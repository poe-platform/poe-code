import path from "node:path";
import { readFile } from "node:fs/promises";
import { Argument, type Command } from "commander";
import {
  discoverHarnesses,
  listBuiltinTemplates,
  MissingPairError,
  resolvePair,
  runHarnessPair,
  type HarnessImportMeta,
  type HarnessPair
} from "@poe-code/agent-harness";
import {
  Budget,
  migrateSnapshotFile,
  makeAgentModule,
  makeEnvModule,
  parseEnvConfig,
  makeFailModule,
  makeFsModule,
  parseFsConfig,
  resolveFsConfig,
  makeGitModule,
  makeHarnessModule,
  makeLogModule,
  makeMetricModule,
  makeMcpModule,
  parseMcpConfig,
  restore,
  splitFrontmatter,
  type AgentSpawnEvent,
  type Diagnostic,
  type EnvModuleOptions,
  type FsModuleOptions,
  type McpModuleOptions
} from "@poe-code/safe-js";
import {
  cancel,
  getTheme,
  isCancel,
  promptText,
  renderTable,
  select,
  withSpinner
} from "toolcraft-design";
import type { CliContainer } from "../container.js";
import { OperationCancelledError, ReportedError, ValidationError } from "../errors.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";
import { runWithOptionalWorktree } from "../../sdk/worktree.js";
import {
  isHarnessSpawnErrorRetryable,
  isHarnessSpawnResultRetryable
} from "./harness-spawn-retry.js";
import {
  addWorktreeOptions,
  isWorktreeRequested,
  pickWorktreeOptions
} from "./worktree-options.js";

type HarnessRunOptions = {
  agent?: string;
  dir?: string;
  fix?: boolean;
  fs?: boolean;
  fsRoot?: string;
  fsConfig?: string;
  envConfig?: string;
  maxSteps?: number;
  dataSize?: number;
  mcpConfig?: string;
  mode?: string;
  model?: string;
  resume?: boolean;
  snapshotPath?: string;
  worktree?: boolean;
  yes?: boolean;
};

type HarnessNewOptions = {
  dir?: string;
  yes?: boolean;
};

type HarnessFsOptions = {
  root?: string;
  adapter?: FsModuleOptions["adapter"];
};

type ModuleExports = ReadonlyMap<string, unknown> | Record<string, unknown>;
type ModuleRegistry = ReadonlyMap<string, ModuleExports> | Record<string, ModuleExports>;

type HarnessPairWithLocation = HarnessPair & {
  dir: string;
  mdMtimeMs: number;
};

export function registerHarnessCommand(program: Command, container: CliContainer): void {
  const harness = program.command("harness").description("Run and manage agent harness pairs.");

  addWorktreeOptions(
    harness
      .command("run")
      .description("Run a harness pair.")
      .argument("[md-paths...]", "Paths to harness .md files to run sequentially")
      .option("--dir <path>", "Directory to search for harness pairs when no md-path is given.")
      .option("--fix", "Apply supported lint fixes to the harness .ajs file before running.")
      .option("--fs", "Give the harness a real filesystem module, confined to --fs-root.")
      .option(
        "--fs-root <path>",
        "Directory --fs confines the harness to (default: the harness directory)."
      )
      .option(
        "--fs-config <path>",
        "Configure shared filesystem access from JSON (Node only).",
        (value: string, previous: string | undefined) => {
          if (previous !== undefined)
            throw new ValidationError("--fs-config may be specified only once.");
          if (value.trim().length === 0)
            throw new ValidationError("--fs-config needs a JSON file path.");
          return value;
        }
      )
      .option("--snapshot-path <path>", "File to write/read harness snapshots.")
      .option(
        "--max-steps <n>",
        "Cap interpreter steps; raise explicitly when resuming.",
        (value) => parseBudgetLimit(value, "--max-steps")
      )
      .option(
        "--data-size <n>",
        "Cap retained sandbox data; raise explicitly when resuming.",
        (value) => parseBudgetLimit(value, "--data-size")
      )
      .option("--mcp-config <path>", "Give the harness named MCP servers from a JSON config.")
      .option("--env-config <path>", "Grant environment reads from an explicit JSON config.")
      .option("--resume", "Resume from the snapshot file when it exists.")
      .option("--agent <name>", "Override the agent id from the harness frontmatter agent block.")
      .option("--model <name>", "Override the model from the harness frontmatter agent block.")
      .option(
        "--mode <mode>",
        "Override the mode from the harness frontmatter agent block (read|edit|auto|yolo)."
      )
      .option("-y, --yes", "Accept defaults without prompting.")
  ).action(async (mdPaths: string[], options: HarnessRunOptions) => {
    const selectedPaths: Array<string | undefined> = mdPaths.length > 0 ? mdPaths : [undefined];
    for (const mdPath of selectedPaths) {
      await executeHarnessRun(program, container, mdPath, options);
    }
  });

  harness
    .command("migrate")
    .description("Inspect or explicitly migrate a checkpoint to continuation source.")
    .argument("<snapshot-path>", "Original checkpoint JSON; never overwritten")
    .requiredOption("--from <path>", "Original executable .ajs source")
    .option("--inspect", "Inspect identities and unresolved calls without writing")
    .option("--to <path>", "New continuation .ajs source")
    .option("--plan <path>", "JSON application state and digest-bound reconciliation")
    .option("--output <path>", "New checkpoint path; must not already exist")
    .action(
      async (
        snapshotPath: string,
        options: { from: string; inspect?: boolean; to?: string; plan?: string; output?: string }
      ) => {
        const flags = resolveHarnessFlags(program, undefined);
        const result = await withSpinner({
          message: options.inspect ? "Inspecting checkpoint" : "Validating checkpoint migration",
          fn: () =>
            migrateSnapshotFile({
              snapshotPath,
              sourcePath: options.from,
              targetSourcePath: options.to,
              planPath: options.plan,
              outputPath: options.output,
              inspect: options.inspect,
              dryRun: flags.dryRun,
              cwd: container.env.cwd
            })
        });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    );

  harness
    .command("new")
    .description("Scaffold a harness pair from a built-in template.")
    .addArgument(new Argument("<kind>", "Built-in template kind").choices(builtinKinds()))
    .argument("<basename>", "New harness basename")
    .option("--dir <path>", "Output directory for the harness pair")
    .option("-y, --yes", "Accept defaults without prompting.")
    .action(async (kind: string, basename: string, options: HarnessNewOptions) => {
      await executeHarnessNew(program, container, kind, basename, options);
    });

  harness
    .command("list")
    .description("List discovered harness pairs.")
    .option("--dir <path>", "Additional directory to search for harness pairs.")
    .action(async (options: { dir?: string }) => {
      await executeHarnessList(program, container, options.dir);
    });
}

async function executeHarnessRun(
  program: Command,
  container: CliContainer,
  mdPath: string | undefined,
  options: HarnessRunOptions
): Promise<void> {
  const flags = resolveHarnessFlags(program, options.yes);
  const resources = createExecutionResources(container, flags, "harness:run");
  if (options.fsConfig !== undefined && (options.fs === true || options.fsRoot !== undefined)) {
    throw new ValidationError("--fs-config cannot be combined with --fs or --fs-root.");
  }
  const fsOptions = resolveHarnessFsOptions(container, options);
  const fsConfig =
    options.fsConfig === undefined
      ? undefined
      : parseFsConfig(
          await container.fs.readFile(path.resolve(container.env.cwd, options.fsConfig), "utf8")
        );
  const configuredFs =
    fsConfig === undefined || flags.dryRun ? undefined : await resolveFsConfig(fsConfig);
  let envOptions: EnvModuleOptions | undefined;
  if (options.envConfig !== undefined) {
    if (options.envConfig.trim().length === 0)
      throw new ValidationError("--env-config needs a JSON file path.");
    const configPath = path.resolve(container.env.cwd, options.envConfig);
    envOptions = parseEnvConfig(await container.fs.readFile(configPath, "utf8"));
  }
  let mcpOptions: McpModuleOptions | undefined;
  if (options.mcpConfig !== undefined) {
    if (options.mcpConfig.trim().length === 0)
      throw new ValidationError("--mcp-config needs a JSON file path.");
    const configPath = path.resolve(container.env.cwd, options.mcpConfig);
    mcpOptions = parseMcpConfig(
      await container.fs.readFile(configPath, "utf8"),
      path.dirname(configPath)
    );
  }
  const selectedPath = mdPath
    ? path.resolve(container.env.cwd, mdPath)
    : (await resolveDiscoveredHarness(container, options.dir, flags.assumeYes)).mdPath;
  if (flags.dryRun) {
    await resolvePair(selectedPath, container.fs);
    resources.logger.dryRun(
      `Dry run: would run ${formatDisplayPath(container, selectedPath)} without executing its script or applying fixes.`
    );
    if (fsOptions !== undefined) {
      resources.logger.dryRun(
        `Dry run: would enable the fs module rooted at ${formatDisplayPath(container, resolveFsRoot(fsOptions, path.dirname(selectedPath)))}.`
      );
    }
    if (fsConfig !== undefined) {
      resources.logger.dryRun(
        `Dry run: would configure the fs module with adapter "${fsConfig.adapter.type}" without constructing it.`
      );
    }
    return;
  }
  const snapshotPath = resolveRunSnapshotPath(container, selectedPath, options.snapshotPath);
  const snapshotPathIsDefault = options.snapshotPath === undefined;
  await prepareHarnessSnapshot(container, selectedPath, snapshotPath, Boolean(options.resume));
  const worktreeOptions = pickWorktreeOptions(options as Record<string, unknown>);
  const selectedAgent = isWorktreeRequested(options as Record<string, unknown>)
    ? await resolveHarnessWorktreeAgent(container, selectedPath, options)
    : (options.agent ?? "codex");

  resources.logger.intro("harness run");

  const baseMessage = `Running ${formatDisplayPath(container, selectedPath)}`;
  const progress = createSnapshotProgressReader(container, snapshotPath);
  const lintDiagnostics: Diagnostic[] = [];
  const frontmatterOverrides = buildAgentFrontmatterOverrides(options);
  const reportedSpawnFailures = new Set<string>();
  const abortController = new AbortController();
  const onSigint = () => {
    abortController.abort(new DOMException("Harness interrupted by SIGINT.", "AbortError"));
  };
  let result: Awaited<ReturnType<typeof runHarnessPair>>;
  process.on("SIGINT", onSigint);
  try {
    const wrapped = await withSpinner({
      message: () => formatRunMessage(baseMessage, progress.current()),
      fn: () =>
        runWithOptionalWorktree({
          cwd: container.env.cwd,
          selectedAgent,
          worktree: worktreeOptions,
          run: async ({ worktreeCwd }) => {
            abortController.signal.throwIfAborted();
            const runSelectedPath = mapSourcePathIntoWorktree(
              container.env.cwd,
              selectedPath,
              worktreeCwd
            );
            const runSnapshotPath = mapSourcePathIntoWorktree(
              container.env.cwd,
              snapshotPath,
              worktreeCwd
            );
            const runFsOptions =
              fsOptions?.root === undefined
                ? fsOptions
                : {
                    root: mapSourcePathIntoWorktree(container.env.cwd, fsOptions.root, worktreeCwd)
                  };
            return await runHarnessPair(runSelectedPath, {
              budget:
                options.maxSteps === undefined && options.dataSize === undefined
                  ? undefined
                  : new Budget({ maxSteps: options.maxSteps, dataSize: options.dataSize }),
              signal: abortController.signal,
              modulesFor: (frontmatter, meta) =>
                createHarnessModules(
                  container,
                  resources.logger,
                  frontmatter,
                  meta,
                  (error) => {
                    reportedSpawnFailures.add(error);
                  },
                  configuredFs ?? runFsOptions,
                  mcpOptions,
                  envOptions
                ),
              onDiagnostics: (diagnostics) => {
                lintDiagnostics.push(...diagnostics);
              },
              fix: Boolean(options.fix),
              resume: Boolean(options.resume),
              snapshotPath: runSnapshotPath,
              ...(snapshotPathIsDefault ? { snapshotPathIsDefault: true } : {}),
              ...(frontmatterOverrides === undefined ? {} : { frontmatterOverrides })
            });
          }
        }),
      stopMessage: () => `Ran ${formatDisplayPath(container, selectedPath)}`
    });
    abortController.signal.throwIfAborted();
    result = wrapped.value;
  } catch (error) {
    if (abortController.signal.aborted) {
      resources.logger.info("Harness interrupted.");
      process.exitCode = 130;
      return;
    }
    const message = formatUnknownError(error);
    if (isAlreadyReportedSpawnFailure(error, reportedSpawnFailures)) {
      throw new ReportedError(message);
    }
    throw error;
  } finally {
    process.off("SIGINT", onSigint);
  }

  logNonErrorLintDiagnostics(resources.logger, lintDiagnostics);
  logHarnessResult(resources.logger, result);
  const costLine = formatTotalCostLine(result);
  if (costLine !== undefined) {
    resources.logger.info(costLine);
  }
  if (!result.ok) {
    throw new ReportedError(formatSpawnFailureText(formatUnknownError(result.error)));
  }
}

async function resolveHarnessWorktreeAgent(
  container: CliContainer,
  selectedPath: string,
  options: HarnessRunOptions
): Promise<string> {
  if (options.agent !== undefined) {
    return options.agent;
  }

  const source = await container.fs.readFile(selectedPath, "utf8");
  const { frontmatter } = splitFrontmatter(source);
  const agentBlock = readOwn(frontmatter, "agent");
  if (typeof agentBlock === "object" && agentBlock !== null) {
    const agent = readOwn(agentBlock, "agent");
    if (typeof agent === "string" && agent.length > 0) {
      return agent;
    }
  }

  throw new ValidationError(
    "Cannot run harness with --worktree because no run agent could be resolved. Pass --agent <name> or define agent.agent in harness frontmatter."
  );
}

function mapSourcePathIntoWorktree(
  sourceCwd: string,
  sourcePath: string,
  worktreeCwd: string
): string {
  const relativePath = path.relative(sourceCwd, sourcePath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return path.join(worktreeCwd, relativePath);
  }
  return sourcePath;
}

function parseBudgetLimit(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${flag} must be a positive safe integer.`);
  }
  return parsed;
}

function readOwn(record: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

function logHarnessResult(
  logger: ReturnType<typeof createExecutionResources>["logger"],
  result: Awaited<ReturnType<typeof runHarnessPair>>
): void {
  if (result.ok) {
    // The outcome is stated outright: the result summary below names keys, not values,
    // so on its own it cannot tell the reader whether the run succeeded.
    logger.success("Harness passed");
    logger.info(`Result: ${formatResultValue(result.returnValue)}`);
  } else {
    logger.error(`Harness failed: ${formatSpawnFailureText(formatUnknownError(result.error))}`);
  }

  const usage = result.usage;
  if (usage !== undefined) {
    logger.info(formatHarnessUsage(usage));
  }
}

function formatResultValue(value: unknown): string {
  if (value === undefined) {
    return "completed";
  }
  if (typeof value === "string") {
    return truncateResultValue(sanitizeTerminalText(value));
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `array · ${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).map((key) =>
      truncateResultValue(sanitizeTerminalText(key))
    );
    const keySummary = keys.slice(0, 5).join(", ");
    const summary =
      keys.length === 0
        ? "object"
        : `object · ${keySummary}${keys.length > 5 ? `, +${keys.length - 5} more` : ""}`;
    return truncateResultValue(summary);
  }
  return typeof value;
}

function truncateResultValue(value: string): string {
  return value.length > 240 ? `${value.slice(0, 239)}…` : value;
}

function sanitizeTerminalText(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "\n" || character === "\r" || character === "\t") {
      sanitized += " ";
    } else if (code >= 32 && code !== 127) {
      sanitized += character;
    } else {
      sanitized += " ";
    }
  }
  return sanitized
    .split(" ")
    .filter((part) => part.length > 0)
    .join(" ");
}

function formatHarnessUsage(usage: {
  attemptCount?: number;
  cachedTokens: number;
  inputTokens: number;
  outputTokens: number;
  spawnCount: number;
}): string {
  const parts = [`${usage.spawnCount} ${usage.spawnCount === 1 ? "spawn" : "spawns"}`];
  if (usage.attemptCount !== undefined && usage.attemptCount !== usage.spawnCount) {
    parts.push(`${usage.attemptCount} ${usage.attemptCount === 1 ? "attempt" : "attempts"}`);
  }
  if (usage.inputTokens > 0) {
    parts.push(`${usage.inputTokens} input`);
  }
  if (usage.outputTokens > 0) {
    parts.push(`${usage.outputTokens} output`);
  }
  if (usage.cachedTokens > 0) {
    parts.push(`${usage.cachedTokens} cached`);
  }
  return `Usage: ${parts.join(" · ")}`;
}

function isAlreadyReportedSpawnFailure(error: unknown, reported: ReadonlySet<string>): boolean {
  const message = formatSpawnFailureText(formatUnknownError(error));
  if (reported.has(message)) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ("result" in error) {
    const resultMessage = formatSpawnResultFailure(error.result);
    if (resultMessage !== undefined && reported.has(resultMessage)) {
      return true;
    }
  }
  if ("errors" in error && Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors.every((nestedError) =>
      isAlreadyReportedSpawnFailure(nestedError, reported)
    );
  }
  return false;
}

function formatSpawnFailureText(value: string): string {
  const sanitized = sanitizeTerminalText(value);
  return sanitized.length > 400 ? `${sanitized.slice(0, 399)}…` : sanitized;
}

function formatSpawnResultFailure(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null || !("exitCode" in result)) {
    return undefined;
  }
  const exitCode = result.exitCode;
  if (typeof exitCode !== "number") {
    return undefined;
  }
  const stderr =
    "stderr" in result && typeof result.stderr === "string" ? result.stderr.trim() : "";
  const summary =
    "summary" in result && typeof result.summary === "string" ? result.summary.trim() : "";
  const message =
    stderr.length > 0
      ? `Agent spawn failed with exit code ${exitCode}: ${stderr}`
      : summary.length > 0
        ? `Agent spawn failed with exit code ${exitCode}: ${summary}`
        : `Agent spawn failed with exit code ${exitCode}.`;
  return formatSpawnFailureText(message);
}

function logNonErrorLintDiagnostics(
  logger: ReturnType<typeof createExecutionResources>["logger"],
  diagnostics: readonly Diagnostic[]
): void {
  const nonErrors = diagnostics.filter((diagnostic) => diagnostic.severity !== "error");
  if (nonErrors.length === 0) {
    return;
  }

  logger.warn(`Lint diagnostics:\n${formatDiagnostics(nonErrors)}`);
}

function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.filename}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.code} ${diagnostic.message}`
    )
    .join("\n");
}

function buildAgentFrontmatterOverrides(
  options: HarnessRunOptions
): { agent: Record<string, string> } | undefined {
  const agentOverride: Record<string, string> = {};
  if (options.agent !== undefined) {
    agentOverride.agent = options.agent;
  }
  if (options.model !== undefined) {
    agentOverride.model = options.model;
  }
  if (options.mode !== undefined) {
    agentOverride.mode = options.mode;
  }
  if (Object.keys(agentOverride).length === 0) {
    return undefined;
  }
  return { agent: agentOverride };
}

function resolveRunSnapshotPath(
  container: CliContainer,
  mdPath: string,
  snapshotPath: string | undefined
): string {
  if (snapshotPath !== undefined) {
    return path.resolve(container.env.cwd, snapshotPath);
  }

  const basename = path.basename(mdPath, path.extname(mdPath));
  return path.join(container.env.cwd, ".poe-code", "harnesses", basename, "snapshot.json");
}

async function prepareHarnessSnapshot(
  container: CliContainer,
  mdPath: string,
  snapshotPath: string,
  resumeRequested: boolean
): Promise<void> {
  const snapshotExists = await pathExists(container, snapshotPath);

  if (!resumeRequested) {
    return;
  }

  if (!snapshotExists) {
    return;
  }

  const [snapshotSource, scriptSource] = await Promise.all([
    container.fs.readFile(snapshotPath, "utf8"),
    container.fs.readFile(resolveAjsPath(mdPath), "utf8")
  ]);

  try {
    restore(JSON.parse(snapshotSource) as Parameters<typeof restore>[0], { source: scriptSource });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("source changed since snapshot was taken")
    ) {
      throw new ValidationError(
        `Cannot resume harness from ${formatDisplayPath(container, snapshotPath)}: source changed since the snapshot was taken. The .ajs script was edited; start a fresh run without --resume to discard the old snapshot.`
      );
    }

    throw error;
  }
}

function createSnapshotProgressReader(
  container: CliContainer,
  snapshotPath: string
): { current(): string | undefined } {
  let progress: string | undefined;
  let lastReadStartedAt = 0;

  return {
    current() {
      const now = Date.now();
      if (now - lastReadStartedAt > 750) {
        lastReadStartedAt = now;
        void readSnapshotProgress(container, snapshotPath).then((next) => {
          if (next !== undefined) {
            progress = next;
          }
        });
      }

      return progress;
    }
  };
}

async function readSnapshotProgress(
  container: CliContainer,
  snapshotPath: string
): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await container.fs.readFile(snapshotPath, "utf8")) as unknown;
    const step = readSnapshotStep(parsed);
    return step === undefined ? undefined : `step ${step}`;
  } catch {
    return undefined;
  }
}

function readSnapshotStep(snapshot: unknown): number | undefined {
  if (typeof snapshot !== "object" || snapshot === null) {
    return undefined;
  }

  const record = snapshot as Record<string, unknown>;
  for (const key of ["step", "currentStep", "currentAstNodeId"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function formatRunMessage(baseMessage: string, progress: string | undefined): string {
  return progress === undefined ? baseMessage : `${baseMessage} (${progress})`;
}

function resolveAjsPath(mdPath: string): string {
  const parsed = path.parse(mdPath);
  return path.join(parsed.dir, `${parsed.name}.ajs`);
}

async function pathExists(container: CliContainer, targetPath: string): Promise<boolean> {
  try {
    await container.fs.stat(targetPath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return hasOwnErrorCode(error, code);
}

async function executeHarnessNew(
  program: Command,
  container: CliContainer,
  kind: string,
  basename: string,
  options: HarnessNewOptions
): Promise<void> {
  const flags = resolveHarnessFlags(program, options.yes);
  const resources = createExecutionResources(container, flags, "harness:new");
  const template = listBuiltinTemplates().find((entry) => entry.kind === kind);

  resources.logger.intro("harness new");

  if (!template) {
    throw new ValidationError(
      `Unknown harness template "${kind}". Available kinds: ${builtinKinds().join(", ")}.`
    );
  }

  if (
    basename.length === 0 ||
    basename === "." ||
    basename === ".." ||
    path.basename(basename) !== basename
  ) {
    throw new ValidationError(
      `Invalid harness basename "${basename}". Use a single directory name.`
    );
  }

  const defaultDir = path.join(".poe-code", "harnesses", basename);
  const outputDir = options.dir ?? (await resolveOutputDir(defaultDir, flags.assumeYes));
  const resolvedDir = path.resolve(container.env.cwd, outputDir);
  const mdPath = path.join(resolvedDir, `${basename}.md`);
  const ajsPath = path.join(resolvedDir, `${basename}.ajs`);

  await assertFilesDoNotExist(container, [mdPath, ajsPath]);

  if (flags.dryRun) {
    resources.logger.dryRun(`Would create ${formatDisplayPath(container, mdPath)}`);
    resources.logger.dryRun(`Would create ${formatDisplayPath(container, ajsPath)}`);
    return;
  }

  const [mdSource, ajsSource] = await Promise.all([
    readFile(template.mdPath, "utf8"),
    readFile(template.ajsPath, "utf8")
  ]);

  await container.fs.mkdir(resolvedDir, { recursive: true });
  const createdPaths: string[] = [];
  try {
    await writeHarnessScaffoldFile(container.fs, mdPath, mdSource);
    createdPaths.push(mdPath);
    await writeHarnessScaffoldFile(container.fs, ajsPath, ajsSource);
    createdPaths.push(ajsPath);
  } catch (error) {
    await cleanupHarnessScaffoldFiles(container.fs, createdPaths);
    throw error;
  }

  resources.context.complete({
    success: `Created harness pair at ${formatDisplayPath(container, resolvedDir)}`,
    dry: `Would create harness pair at ${formatDisplayPath(container, resolvedDir)}`
  });
  resources.logger.info(`Next: poe-code harness run ${formatDisplayPath(container, mdPath)}`);
  resources.context.finalize();
}

async function writeHarnessScaffoldFile(
  fs: CliContainer["fs"],
  filePath: string,
  source: string
): Promise<void> {
  try {
    await fs.writeFile(filePath, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      await tryUnlinkHarnessScaffoldFile(fs, filePath);
    }
    throw error;
  }
}

async function cleanupHarnessScaffoldFiles(
  fs: CliContainer["fs"],
  filePaths: string[]
): Promise<void> {
  await Promise.all(filePaths.map((filePath) => tryUnlinkHarnessScaffoldFile(fs, filePath)));
}

async function tryUnlinkHarnessScaffoldFile(
  fs: CliContainer["fs"],
  filePath: string
): Promise<void> {
  await fs.unlink(filePath).catch(() => undefined);
}

async function executeHarnessList(
  program: Command,
  container: CliContainer,
  dir: string | undefined
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "harness:list");

  resources.logger.intro("harness list");

  const pairs = await discoverProjectThenUserHarnesses(container, dir);
  if (pairs.length === 0) {
    resources.logger.info(
      `No harness pairs found in ${formatSearchedRoots(container, dir)}. Scaffold one with poe-code harness new <kind> <basename>, or pass --dir <path> to search another directory.`
    );
    return;
  }

  const theme = getTheme();
  const rows = pairs.map((pair) => ({
    Basename: theme.accent(pair.basename),
    Dir: formatDisplayPath(container, pair.dir),
    "MD mtime": new Date(pair.mdMtimeMs).toISOString()
  }));

  resources.logger.info(
    renderTable({
      theme,
      columns: [
        { name: "Basename", title: "Basename", alignment: "left", maxLen: 28 },
        { name: "Dir", title: "Dir", alignment: "left", maxLen: 64 },
        { name: "MD mtime", title: ".md mtime", alignment: "left", maxLen: 24 }
      ],
      rows
    })
  );
}

function resolveHarnessFlags(
  program: Command,
  commandYes: boolean | undefined
): ReturnType<typeof resolveCommandFlags> {
  const flags = resolveCommandFlags(program);
  return {
    ...flags,
    assumeYes: flags.assumeYes || Boolean(commandYes)
  };
}

async function resolveDiscoveredHarness(
  container: CliContainer,
  dir: string | undefined,
  assumeYes: boolean
): Promise<HarnessPairWithLocation> {
  const pairs = await discoverProjectThenUserHarnesses(container, dir);

  if (pairs.length === 0) {
    throw new ValidationError(
      `No harness pairs found in ${formatSearchedRoots(container, dir)}. Pass a path (poe-code harness run path/to/harness.md), search another directory with --dir <path>, or scaffold a pair with poe-code harness new <kind> <basename>.`
    );
  }

  if (pairs.length === 1) {
    return pairs[0]!;
  }

  if (assumeYes) {
    throw new ValidationError("Multiple harness pairs found; ambiguous, pass a path.");
  }

  if (process.stdin.isTTY !== true) {
    throw new ValidationError(
      "Multiple harness pairs found; pass a path or --yes when running without an interactive TTY."
    );
  }

  const selected = await select({
    message: "Select harness",
    options: pairs.map((pair) => ({
      label: `${pair.basename} (${formatDisplayPath(container, pair.dir)})`,
      value: pair.mdPath
    }))
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    throw new OperationCancelledError();
  }

  const pair = pairs.find((entry) => entry.mdPath === selected);
  if (!pair) {
    throw new ValidationError("Selected harness was not found.");
  }
  return pair;
}

function harnessDiscoveryRoots(container: CliContainer, dir: string | undefined): string[] {
  const roots = [
    path.join(container.env.cwd, ".poe-code", "harnesses"),
    path.join(container.env.homeDir, ".poe-code", "harnesses")
  ];
  return dir === undefined ? roots : [path.resolve(container.env.cwd, dir), ...roots];
}

function formatSearchedRoots(container: CliContainer, dir: string | undefined): string {
  return harnessDiscoveryRoots(container, dir)
    .map((root) => formatDisplayPath(container, root))
    .join(", ");
}

function builtinKinds(): string[] {
  return listBuiltinTemplates().map((template) => template.kind);
}

// `harness new --dir <path>` writes `<path>/<basename>.md`, so each root can hold pairs
// directly as well as in the `<root>/<basename>/<basename>.md` layout discoverHarnesses scans.
async function discoverPairsDirectlyIn(
  container: CliContainer,
  root: string
): Promise<HarnessPair[]> {
  let entries: string[];
  try {
    entries = await container.fs.readdir(root);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR")) {
      return [];
    }
    throw error;
  }

  const pairs: HarnessPair[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
    try {
      pairs.push(
        await resolvePair(path.join(root, entry), container.fs as Parameters<typeof resolvePair>[1])
      );
    } catch (error) {
      if (error instanceof MissingPairError) {
        continue;
      }
      throw error;
    }
  }
  return pairs;
}

async function discoverProjectThenUserHarnesses(
  container: CliContainer,
  dir: string | undefined
): Promise<HarnessPairWithLocation[]> {
  const discovered: HarnessPairWithLocation[] = [];

  for (const root of harnessDiscoveryRoots(container, dir)) {
    const pairs = [
      ...(await discoverHarnesses(root, container.fs as Parameters<typeof discoverHarnesses>[1])),
      ...(await discoverPairsDirectlyIn(container, root))
    ];
    for (const pair of pairs) {
      const stat = await container.fs.stat(pair.mdPath);
      discovered.push({
        ...pair,
        dir: path.dirname(pair.mdPath),
        mdMtimeMs: stat.mtimeMs
      });
    }
  }

  return discovered;
}

async function resolveOutputDir(defaultDir: string, assumeYes: boolean): Promise<string> {
  if (assumeYes) {
    return defaultDir;
  }

  if (process.stdin.isTTY !== true) {
    throw new ValidationError(
      "Harness directory selection requires --dir or --yes when running without an interactive TTY."
    );
  }

  const answer = await promptText({
    message: "Harness directory",
    initialValue: defaultDir
  });

  if (isCancel(answer)) {
    cancel("Operation cancelled.");
    throw new OperationCancelledError();
  }

  const dir = answer.trim();
  if (dir.length === 0) {
    throw new ValidationError("Harness directory is required.");
  }
  return dir;
}

async function assertFilesDoNotExist(container: CliContainer, filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    if (await pathExists(container, filePath)) {
      throw new ValidationError(
        `Refusing to overwrite existing file: ${formatDisplayPath(container, filePath)}`
      );
    }
  }
}

// undefined is the default: SafeJS exposes no filesystem unless --fs asked for one. An
// enabled module with no root of its own is confined to the harness directory, which is
// only known once the pair is loaded, so the root is resolved per run rather than here.
function resolveHarnessFsOptions(
  container: CliContainer,
  options: HarnessRunOptions
): HarnessFsOptions | undefined {
  if (options.fs !== true) {
    if (options.fsRoot === undefined) {
      return undefined;
    }

    throw new ValidationError(
      "--fs-root requires --fs. Pass --fs to give the harness a filesystem confined to that root, or drop --fs-root."
    );
  }

  if (options.fsRoot === undefined) {
    return {};
  }

  // An unset shell variable expands to an empty argument and path.resolve reads that as the
  // cwd, so a blank root would silently confine the harness to the whole project instead of
  // the directory the caller meant to name.
  if (options.fsRoot.trim().length === 0) {
    throw new ValidationError(
      "--fs-root needs a directory path. Pass --fs-root <path> to confine the harness to that directory, or drop --fs-root to confine it to the harness directory."
    );
  }

  return { root: path.resolve(container.env.cwd, options.fsRoot) };
}

function resolveFsRoot(fsOptions: HarnessFsOptions, harnessDir: string): string {
  return fsOptions.root ?? harnessDir;
}

function createHarnessModules(
  container: CliContainer,
  logger: ReturnType<typeof createExecutionResources>["logger"],
  frontmatter: Record<string, unknown>,
  meta: HarnessImportMeta,
  onSpawnFailure: (error: string) => void,
  fsOptions: HarnessFsOptions | undefined,
  mcpOptions: McpModuleOptions | undefined,
  envOptions: EnvModuleOptions | undefined
): ModuleRegistry {
  const harnessMeta = {
    kind: meta.kind,
    version: meta.version,
    filepath: meta.filename
  };
  const agent = makeAgentModule(
    async (input) => {
      const startedAt = Date.now();
      const { result } = sdkSpawn(input.agent, {
        prompt: input.prompt,
        cwd: input.cwd ?? meta.dirname,
        model: input.model,
        mode: input.mode,
        mcpServers: input.mcp,
        signal: input.signal,
        activityTimeoutMs: input.timeoutMs
      });
      const resolved = await result;
      return {
        exitCode: resolved.exitCode,
        stdout: resolved.stdout,
        stderr: resolved.stderr,
        summary: resolved.stdout || resolved.stderr,
        durationMs: Date.now() - startedAt,
        ...(resolved.usage ? { usage: resolved.usage } : {})
      };
    },
    {
      defaultRetry: {
        maxAttempts: 5,
        backoffMs: 1_000,
        isErrorRetryable: isHarnessSpawnErrorRetryable,
        isRetryable: isHarnessSpawnResultRetryable
      },
      onEvent: (event) => logHarnessSpawnEvent(logger, event, onSpawnFailure)
    }
  );
  const fail = makeFailModule().default;
  const git = makeGitModule(meta.dirname);
  const harness = makeHarnessModule(frontmatter, harnessMeta);
  const log = makeLogModule();
  const metric = makeMetricModule(async (scriptName) => {
    const result = await container.commandRunner("npm", ["run", scriptName], {
      cwd: meta.dirname
    });
    if (result.exitCode !== 0) {
      throw new Error(`Metric script "${scriptName}" failed with exit code ${result.exitCode}.`);
    }
    return result.stdout;
  });

  return {
    agent: toModuleExports(agent),
    ...(mcpOptions === undefined ? {} : { mcp: toModuleExports(makeMcpModule(mcpOptions)) }),
    ...(envOptions === undefined
      ? {}
      : {
          env: toModuleExports(
            makeEnvModule({ ...envOptions, values: envOptions.values ?? container.env.variables })
          )
        }),
    fail: toModuleExports(new Map([["default", fail]])),
    ...(fsOptions === undefined
      ? {}
      : {
          fs: toModuleExports(
            makeFsModule(
              fsOptions.adapter === undefined
                ? { root: resolveFsRoot(fsOptions, meta.dirname) }
                : fsOptions
            )
          )
        }),
    git: toModuleExports(git),
    harness: toModuleExports(harness),
    log: toModuleExports(log),
    metric: toModuleExports(metric)
  };
}

function logHarnessSpawnEvent(
  logger: ReturnType<typeof createExecutionResources>["logger"],
  event: AgentSpawnEvent,
  onSpawnFailure: (error: string) => void
): void {
  const label = `Spawn #${event.spawnId} ${event.agent} — ${event.task}`;

  if (event.type === "spawn.started") {
    const attempt = event.attempt === 1 ? "" : ` attempt ${event.attempt}/${event.maxAttempts}`;
    logger.info(`${label}${attempt} started`);
    return;
  }

  if (event.type === "spawn.retry") {
    logger.warn(
      `${label} failed (attempt ${event.attempt}/${event.maxAttempts}): ${formatSpawnLifecycleError(event.error)}\nRetrying in ${formatRetryDelay(event.delayMs)}`
    );
    return;
  }

  if (event.type === "spawn.succeeded") {
    const attempt = event.attempt === 1 ? "" : ` on attempt ${event.attempt}/${event.maxAttempts}`;
    logger.success(`${label} completed${attempt} (${formatDuration(event.durationMs)})`);
    return;
  }

  if (event.type === "spawn.cancelled") {
    logger.warn(`${label} cancelled (${formatDuration(event.durationMs)}): ${event.reason}`);
    return;
  }

  if (!event.checked) {
    logger.warn(
      `${label} returned an unsuccessful result after ${event.attempt} ${event.attempt === 1 ? "attempt" : "attempts"} (${formatDuration(event.durationMs)})\n${formatSpawnLifecycleError(event.error)}`
    );
    return;
  }

  onSpawnFailure(event.error);
  logger.error(
    `${label} failed after ${event.attempt} ${event.attempt === 1 ? "attempt" : "attempts"} (${formatDuration(event.durationMs)})\n${formatSpawnLifecycleError(event.error)}`
  );
}

function formatSpawnLifecycleError(error: string): string {
  const prefix = "Agent spawn failed with exit code ";
  if (!error.startsWith(prefix)) {
    return error;
  }
  const separator = error.indexOf(": ", prefix.length);
  if (separator < 0) {
    return error;
  }
  const exitCode = error.slice(prefix.length, separator);
  const detail = error.slice(separator + 2);
  return `${detail} (exit ${exitCode})`;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

function formatRetryDelay(delayMs: number): string {
  return delayMs < 1_000 ? `${delayMs}ms` : `${delayMs / 1_000}s`;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs}ms` : `${(durationMs / 1_000).toFixed(1)}s`;
}

function formatTotalCostLine(result: unknown): string | undefined {
  const costUsd = readResultCostUsd(result);
  if (costUsd === undefined) {
    return undefined;
  }

  return `Total cost: $${costUsd.toFixed(2)}`;
}

function readResultCostUsd(result: unknown): number | undefined {
  if (typeof result !== "object" || result === null || !("usage" in result)) {
    return undefined;
  }

  const usage = result.usage;
  if (typeof usage !== "object" || usage === null || !("costUsd" in usage)) {
    return undefined;
  }

  return typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd)
    ? usage.costUsd
    : undefined;
}

function toModuleExports(moduleExports: ModuleExports): ModuleExports {
  if (moduleExports instanceof Map) {
    return moduleExports;
  }
  return new Map(Object.entries(moduleExports));
}

function formatDisplayPath(container: CliContainer, filePath: string): string {
  const relative = path.relative(container.env.cwd, filePath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : filePath.replace(container.env.homeDir, "~");
}
