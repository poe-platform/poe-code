import path from "node:path";
import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  discoverHarnesses,
  listBuiltinTemplates,
  runHarnessPair,
  type HarnessImportMeta,
  type HarnessPair
} from "@poe-code/agent-harness";
import {
  makeAgentModule,
  makeFailModule,
  makeGitModule,
  makeHarnessModule,
  makeLogModule,
  makeMetricModule,
  restore,
  type Diagnostic
} from "@poe-code/agent-script";
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
import { ValidationError } from "../errors.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";

type HarnessRunOptions = {
  agent?: string;
  fix?: boolean;
  mode?: string;
  model?: string;
  resume?: boolean;
  snapshotPath?: string;
  yes?: boolean;
};

type HarnessNewOptions = {
  dir?: string;
  yes?: boolean;
};

type ModuleExports = ReadonlyMap<string, unknown> | Record<string, unknown>;
type ModuleRegistry = ReadonlyMap<string, ModuleExports> | Record<string, ModuleExports>;

type HarnessPairWithLocation = HarnessPair & {
  dir: string;
  mdMtimeMs: number;
};

export function registerHarnessCommand(program: Command, container: CliContainer): void {
  const harness = program.command("harness").description("Run and manage agent harness pairs.");

  harness
    .command("run")
    .description("Run a harness pair.")
    .argument("[md-path]", "Path to the harness .md file")
    .option("--fix", "Apply supported lint fixes to the harness .ajs file before running.")
    .option("--snapshot-path <path>", "File to write/read harness snapshots.")
    .option("--resume", "Resume from the snapshot file when it exists.")
    .option(
      "--agent <name>",
      "Override the agent id from the harness frontmatter agent block."
    )
    .option(
      "--model <name>",
      "Override the model from the harness frontmatter agent block."
    )
    .option(
      "--mode <mode>",
      "Override the mode from the harness frontmatter agent block (read|edit|yolo)."
    )
    .option("-y, --yes", "Accept defaults without prompting.")
    .action(async (mdPath: string | undefined, options: HarnessRunOptions) => {
      await executeHarnessRun(program, container, mdPath, options);
    });

  harness
    .command("new")
    .description("Scaffold a harness pair from a built-in template.")
    .argument("<kind>", "Built-in template kind")
    .argument("<basename>", "New harness basename")
    .option("--dir <path>", "Output directory for the harness pair")
    .option("-y, --yes", "Accept defaults without prompting.")
    .action(async (kind: string, basename: string, options: HarnessNewOptions) => {
      await executeHarnessNew(program, container, kind, basename, options);
    });

  harness
    .command("list")
    .description("List discovered harness pairs.")
    .action(async () => {
      await executeHarnessList(program, container);
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
  const selectedPath = mdPath
    ? path.resolve(container.env.cwd, mdPath)
    : (await resolveDiscoveredHarness(container, flags.assumeYes)).mdPath;
  if (flags.dryRun) {
    resources.logger.dryRun(
      `Dry run: would run ${formatDisplayPath(container, selectedPath)} without executing its script or applying fixes.`
    );
    return;
  }
  const snapshotPath = resolveRunSnapshotPath(container, selectedPath, options.snapshotPath);
  const snapshotPathIsDefault = options.snapshotPath === undefined;
  await prepareHarnessSnapshot(container, selectedPath, snapshotPath, Boolean(options.resume));

  resources.logger.intro("harness run");

  const baseMessage = `Running ${formatDisplayPath(container, selectedPath)}`;
  const progress = createSnapshotProgressReader(container, snapshotPath);
  const lintDiagnostics: Diagnostic[] = [];
  const frontmatterOverrides = buildAgentFrontmatterOverrides(options);
  const result = await withSpinner({
    message: () => formatRunMessage(baseMessage, progress.current()),
    fn: () =>
      runHarnessPair(selectedPath, {
        modulesFor: (frontmatter, meta) => createHarnessModules(container, frontmatter, meta),
        onDiagnostics: (diagnostics) => {
          lintDiagnostics.push(...diagnostics);
        },
        fix: Boolean(options.fix),
        resume: Boolean(options.resume),
        snapshotPath,
        ...(snapshotPathIsDefault ? { snapshotPathIsDefault: true } : {}),
        ...(frontmatterOverrides === undefined ? {} : { frontmatterOverrides })
      }),
    stopMessage: () => `Ran ${formatDisplayPath(container, selectedPath)}`
  });

  logNonErrorLintDiagnostics(resources.logger, lintDiagnostics);
  resources.logger.info(JSON.stringify(result, null, 2));
  const costLine = formatTotalCostLine(result);
  if (costLine !== undefined) {
    resources.logger.info(costLine);
  }
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
    throw new ValidationError(`Unknown harness template "${kind}".`);
  }

  if (basename.length === 0 || basename === "." || basename === ".." || path.basename(basename) !== basename) {
    throw new ValidationError(`Invalid harness basename "${basename}". Use a single directory name.`);
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

async function executeHarnessList(program: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "harness:list");

  resources.logger.intro("harness list");

  const pairs = await discoverProjectThenUserHarnesses(container);
  if (pairs.length === 0) {
    resources.logger.info("No harness pairs found.");
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
  assumeYes: boolean
): Promise<HarnessPairWithLocation> {
  const pairs = await discoverProjectThenUserHarnesses(container);

  if (pairs.length === 0) {
    throw new ValidationError("No harness pairs found.");
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
    throw new ValidationError("Operation cancelled.");
  }

  const pair = pairs.find((entry) => entry.mdPath === selected);
  if (!pair) {
    throw new ValidationError("Selected harness was not found.");
  }
  return pair;
}

async function discoverProjectThenUserHarnesses(
  container: CliContainer
): Promise<HarnessPairWithLocation[]> {
  const roots = [
    path.join(container.env.cwd, ".poe-code", "harnesses"),
    path.join(container.env.homeDir, ".poe-code", "harnesses")
  ];
  const discovered: HarnessPairWithLocation[] = [];

  for (const root of roots) {
    const pairs = await discoverHarnesses(
      root,
      container.fs as Parameters<typeof discoverHarnesses>[1]
    );
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
    throw new ValidationError("Operation cancelled.");
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

function createHarnessModules(
  container: CliContainer,
  frontmatter: Record<string, unknown>,
  meta: HarnessImportMeta
): ModuleRegistry {
  const harnessMeta = {
    kind: meta.kind,
    version: meta.version,
    filepath: meta.filename
  };
  const agent = makeAgentModule(async (input) => {
    const { result } = sdkSpawn(input.agent, {
      prompt: input.prompt,
      cwd: input.cwd ?? meta.dirname,
      model: input.model,
      mode: input.mode,
      mcpServers: input.mcp,
      signal: input.signal
    });
    const resolved = await result;
    return {
      exitCode: resolved.exitCode,
      stdout: resolved.stdout,
      stderr: resolved.stderr,
      summary: resolved.stdout || resolved.stderr,
      durationMs: 0,
      ...(resolved.usage ? { usage: resolved.usage } : {})
    };
  });
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
    fail: toModuleExports(new Map([["default", fail]])),
    git: toModuleExports(git),
    harness: toModuleExports(harness),
    log: toModuleExports(log),
    metric: toModuleExports(metric)
  };
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
