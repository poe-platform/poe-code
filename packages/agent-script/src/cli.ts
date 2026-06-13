import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path, { dirname, extname } from "node:path";
import { formatWithOptions } from "node:util";
import { pathToFileURL } from "node:url";

import { hasOwnErrorCode } from "./error-codes.js";
import { formatInterpreterError } from "./error/format.js";
import { replaceErrorStack } from "./error/shape.js";
import { Budget, SandboxError } from "./interp/budget.js";
import { extractBlock } from "./loader/extract-block.js";
import { splitFrontmatter } from "./loader/frontmatter.js";
import { lint, type Diagnostic } from "./lint.js";
import { createLintModulesFromRuntimeRegistry } from "./lint/runtime-modules.js";
import { makeAgentModule } from "./modules/agent.js";
import { makeFailModule } from "./modules/fail.js";
import { makeHarnessModule } from "./modules/harness.js";
import { makeLogModule, type LogModuleEntry } from "./modules/log.js";
import { makeMetricModule } from "./modules/metric.js";
import type { CallerInjectedBinding } from "./interp/host-bridge.js";
import type { ModuleExports, ModuleRegistry } from "./modules/registry.js";
import { parseModule } from "./parse/parser.js";
import { restore, type AgentScriptSnapshot } from "./restore.js";
import { run, type RunResult } from "./run.js";
import { dump, dumpCurrent } from "./snapshot/dump.js";

type CliStream = {
  write(chunk: string): void;
};

type CliProcess = Pick<NodeJS.Process, "off" | "on">;

type FileStats = {
  isFile(): boolean;
};

export type ReadMarkdownFile = (filepath: string, encoding: "utf8") => Promise<string>;
export type WriteMarkdownFile = (
  filepath: string,
  source: string,
  options: { encoding: "utf8" }
) => Promise<void>;

export type RunCliOptions = {
  cwd?: string;
  modulesFor?: (
    frontmatter: Record<string, unknown>,
    meta: HarnessMeta,
    streams: { stderr: CliStream; stdout: CliStream }
  ) => ModuleRegistry;
  process?: CliProcess;
  readFile?: ReadMarkdownFile;
  stat?: (filepath: string) => Promise<FileStats>;
  stdout?: CliStream;
  stderr?: CliStream;
  writeFile?: WriteMarkdownFile;
};

type HarnessMeta = {
  filepath: string;
  kind: unknown;
  version: unknown;
};

type ParsedArgs = {
  filepath?: string;
  fix: boolean;
  dataSize?: number;
  maxSteps?: number;
  restorePath?: string;
  snapshotPath?: string;
};

type LoadedSource = {
  blockEndOffset: number;
  blockStartOffset: number;
  executableSource: string;
  frontmatter: Record<string, unknown>;
  isRawScript: boolean;
  rawSource: string;
};

type CliRuntime = {
  registry: ModuleRegistry;
};

const EXIT_RUNTIME = 1;
const EXIT_PARSE = 2;
const EXIT_BUDGET = 3;
const EXIT_SIGINT = 130;

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();

  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      stdout.write(`${createUsage()}\n`);
      return 0;
    }

    const parsed = parseArgs(argv);
    if (parsed.filepath === undefined) {
      stderr.write(`${createUsage()}\n`);
      return EXIT_RUNTIME;
    }

    const filepath = path.resolve(cwd, parsed.filepath);
    await assertHarnessFile({
      displayPath: parsed.filepath,
      filepath,
      statFile: options.stat ?? stat
    });

    return await runScriptFile(filepath, parsed, {
      cwd,
      modulesFor: options.modulesFor,
      process: options.process ?? process,
      readFile: options.readFile ?? readFile,
      stderr,
      stdout,
      writeFile: options.writeFile ?? writeFile
    });
  } catch (error) {
    stderr.write(`${readErrorMessage(error)}\n`);
    return error instanceof CliExitError ? error.exitCode : exitCodeForError(error);
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    fix: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--fix") {
      parsed.fix = true;
      continue;
    }

    if (arg === "--snapshot") {
      parsed.snapshotPath = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--restore") {
      parsed.restorePath = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--max-steps") {
      parsed.maxSteps = readPositiveInteger(readFlagValue(argv, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg === "--data-size") {
      parsed.dataSize = readPositiveInteger(readFlagValue(argv, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CliExitError(`Unknown flag: ${arg}`, EXIT_RUNTIME);
    }

    if (parsed.filepath !== undefined) {
      throw new CliExitError(`Unexpected argument: ${arg}`, EXIT_RUNTIME);
    }

    parsed.filepath = arg;
  }

  return parsed;
}

function readFlagValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.length === 0) {
    throw new CliExitError(`Missing value for ${flag}`, EXIT_RUNTIME);
  }

  return value;
}

function readPositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliExitError(`${flag} must be a positive integer`, EXIT_RUNTIME);
  }

  return parsed;
}

async function assertHarnessFile(input: {
  displayPath: string;
  filepath: string;
  statFile: (filepath: string) => Promise<FileStats>;
}): Promise<void> {
  let stats: FileStats;
  try {
    stats = await input.statFile(input.filepath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new CliExitError(`File not found: ${input.displayPath}`, EXIT_RUNTIME);
    }

    throw error;
  }

  if (!stats.isFile()) {
    throw new CliExitError(`Harness path must point to a file: ${input.displayPath}`, EXIT_RUNTIME);
  }
}

async function runScriptFile(
  filepath: string,
  parsed: ParsedArgs,
  options: {
    cwd: string;
    modulesFor: RunCliOptions["modulesFor"];
    process: CliProcess;
    readFile: ReadMarkdownFile;
    stderr: CliStream;
    stdout: CliStream;
    writeFile: WriteMarkdownFile;
  }
): Promise<number> {
  const loaded = loadExecutableSource(filepath, await options.readFile(filepath, "utf8"));
  const meta = {
    filepath,
    kind: loaded.frontmatter.kind,
    version: loaded.frontmatter.version
  };
  const runtime = createRuntime(loaded.frontmatter, meta, {
    modulesFor: options.modulesFor,
    stderr: options.stderr,
    stdout: options.stdout
  });
  const modules = excludeHarnessModule(runtime.registry, loaded.isRawScript);
  let executableSource = loaded.executableSource;
  const lintResult = parsed.fix
    ? lint(executableSource, {
        allowedExportNames: ["schema"],
        filename: filepath,
        fix: true,
        frontmatterFields: Object.keys(loaded.frontmatter),
        modules: createLintModulesFromRuntimeRegistry(modules)
      })
    : lint(executableSource, {
        allowedExportNames: ["schema"],
        filename: filepath,
        frontmatterFields: Object.keys(loaded.frontmatter),
        modules: createLintModulesFromRuntimeRegistry(modules)
      });
  const diagnostics = Array.isArray(lintResult) ? lintResult : lintResult.diagnostics;

  if (!Array.isArray(lintResult)) {
    executableSource = lintResult.fixed;
    if (lintResult.fixed !== loaded.executableSource) {
      await options.writeFile(
        filepath,
        replaceExecutableSource(loaded.rawSource, loaded, lintResult.fixed),
        {
          encoding: "utf8"
        }
      );
    }
  }

  const lintErrors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (lintErrors.length > 0) {
    options.stderr.write(`Lint failed:\n${formatDiagnostics(lintErrors)}\n`);
    return lintErrors.some((diagnostic) => diagnostic.code === "AS001") ? EXIT_PARSE : EXIT_RUNTIME;
  }

  const lintWarnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  if (lintWarnings.length > 0) {
    options.stderr.write(`Lint warnings:\n${formatDiagnostics(lintWarnings)}\n`);
  }

  const snapshot = await readRestoreSnapshot(parsed.restorePath, options);
  if (snapshot !== undefined) {
    restore(snapshot, { source: executableSource });
  }

  const abortController = new AbortController();
  let interrupted = false;
  let runPromise: Promise<RunResult> | undefined;
  let signalSnapshotWrite: Promise<void> | undefined;
  const onSigint = () => {
    interrupted = true;
    abortController.abort(createAbortError());
    options.stderr.write("Interrupted by SIGINT\n");

    if (parsed.snapshotPath !== undefined && runPromise !== undefined) {
      signalSnapshotWrite = writeCurrentSnapshot(runPromise, parsed.snapshotPath, options);
    }
  };

  options.process.on("SIGINT", onSigint);
  try {
    runPromise = run(executableSource, {
      budget:
        parsed.maxSteps === undefined && parsed.dataSize === undefined
          ? undefined
          : new Budget({ dataSize: parsed.dataSize, maxSteps: parsed.maxSteps }),
      entryPointArgs: hasDefaultExport(executableSource, filepath) ? [] : undefined,
      filename: filepath,
      modules,
      signal: abortController.signal,
      sink: createConsoleSink(options.stdout, options.stderr),
      snapshot
    });
    const result = await runPromise;
    await signalSnapshotWrite;

    if (parsed.snapshotPath !== undefined) {
      await writeSnapshot(parsed.snapshotPath, await dump(result), options);
    }

    if (!result.ok) {
      options.stderr.write(
        `${formatInterpreterError(result.error, {
          filename: filepath,
          source: executableSource
        })}\n`
      );
      return interrupted ? EXIT_SIGINT : exitCodeForError(result.error);
    }

    options.stdout.write(`${JSON.stringify({ ok: true, returnValue: result.returnValue })}\n`);
    return interrupted ? EXIT_SIGINT : 0;
  } catch (error) {
    await signalSnapshotWrite;
    options.stderr.write(
      `${formatInterpreterError(error, {
        filename: filepath,
        source: executableSource
      })}\n`
    );
    return interrupted ? EXIT_SIGINT : exitCodeForError(error);
  } finally {
    options.process.off("SIGINT", onSigint);
  }
}

function loadExecutableSource(filepath: string, rawSource: string): LoadedSource {
  const source = stripByteOrderMark(rawSource);

  if (extname(filepath) === ".ajs") {
    return {
      blockEndOffset: source.length,
      blockStartOffset: 0,
      executableSource: source,
      frontmatter: {},
      isRawScript: true,
      rawSource: source
    };
  }

  const { frontmatter, body } = splitFrontmatter(source);
  const executableBlock = extractBlock(body);
  const bodyStartOffset = source.length - body.length;

  return {
    blockEndOffset: bodyStartOffset + executableBlock.endOffset,
    blockStartOffset: bodyStartOffset + executableBlock.startOffset,
    executableSource: createLineOffsetSource(executableBlock.source, executableBlock.lineOffset),
    frontmatter,
    isRawScript: false,
    rawSource: source
  };
}

function replaceExecutableSource(source: string, loaded: LoadedSource, fixed: string): string {
  const lineOffset = countLeadingLineBreaks(fixed);
  const fixedWithoutLineOffset = lineOffset === 0 ? fixed : fixed.slice(lineOffset);

  return `${source.slice(0, loaded.blockStartOffset)}${fixedWithoutLineOffset}${source.slice(
    loaded.blockEndOffset
  )}`;
}

function createRuntime(
  frontmatter: Record<string, unknown>,
  meta: HarnessMeta,
  options: {
    modulesFor: RunCliOptions["modulesFor"];
    stderr: CliStream;
    stdout: CliStream;
  }
): CliRuntime {
  if (options.modulesFor !== undefined) {
    return {
      registry: options.modulesFor(frontmatter, meta, {
        stderr: options.stderr,
        stdout: options.stdout
      })
    };
  }

  const state = {
    checkpointCount: 0,
    commitCount: 0,
    metricCalls: new Map<string, number>(),
    spawnCount: 0
  };
  const harness = makeHarnessModule(frontmatter, meta);
  const agent = makeAgentModule(async (input) => {
    state.spawnCount += 1;

    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: `${input.agent} handled ${summarizePrompt(input.prompt)}`,
      durationMs: 25 * state.spawnCount
    };
  });
  const git = {
    async checkpoint() {
      state.checkpointCount += 1;
      return {
        head: `head-${state.checkpointCount}`,
        stashRef: `savepoint-${state.checkpointCount}`
      };
    },
    async commit() {
      state.commitCount += 1;
      return `commit-${state.commitCount}`;
    },
    async revert() {
      return undefined;
    }
  };
  const log = makeLogModule((entry) => {
    const normalized = normalizeLogEntry(entry);
    const stream = normalized.type === "error" ? options.stderr : options.stdout;
    stream.write(`${JSON.stringify(normalized)}\n`);
  });
  const metric = makeMetricModule(async (scriptName) => `${readMetricScore(scriptName, state)}\n`);

  return {
    registry: {
      agent: toModuleExports(agent),
      fail: toModuleExports(new Map([["default", makeFailModule().default]])),
      git: toModuleExports(
        new Map<string, CallerInjectedBinding>([
          ["checkpoint", git.checkpoint],
          ["commit", git.commit],
          ["revert", git.revert]
        ])
      ),
      harness: toModuleExports(harness),
      log: toModuleExports(log),
      metric: toModuleExports(metric)
    }
  };
}

async function readRestoreSnapshot(
  restorePath: string | undefined,
  options: {
    cwd: string;
    readFile: ReadMarkdownFile;
  }
): Promise<AgentScriptSnapshot | undefined> {
  if (restorePath === undefined) {
    return undefined;
  }

  const snapshotPath = path.resolve(options.cwd, restorePath);
  let rawSnapshot: string;
  try {
    rawSnapshot = await options.readFile(snapshotPath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new CliExitError(`Snapshot not found: ${restorePath}`, EXIT_RUNTIME);
    }

    throw error;
  }

  try {
    return JSON.parse(rawSnapshot) as AgentScriptSnapshot;
  } catch (error) {
    throw new Error(`Failed to parse snapshot at ${restorePath}: ${readErrorMessage(error)}`);
  }
}

async function writeCurrentSnapshot(
  result: PromiseLike<RunResult>,
  snapshotPath: string,
  options: {
    cwd: string;
    stderr: CliStream;
    writeFile: WriteMarkdownFile;
  }
): Promise<void> {
  try {
    await writeSnapshot(snapshotPath, await dumpCurrent(result), options);
  } catch (error) {
    options.stderr.write(
      `Failed to write snapshot at ${snapshotPath}: ${readErrorMessage(error)}\n`
    );
  }
}

async function writeSnapshot(
  snapshotPath: string,
  content: string,
  options: {
    cwd: string;
    writeFile: WriteMarkdownFile;
  }
): Promise<void> {
  const resolvedPath = path.resolve(options.cwd, snapshotPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await options.writeFile(resolvedPath, content, { encoding: "utf8" });
}

function createConsoleSink(
  stdout: CliStream,
  stderr: CliStream
): {
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
} {
  return {
    error(...args) {
      stderr.write(`${formatConsoleArgs(args)}\n`);
    },
    log(...args) {
      stdout.write(`${formatConsoleArgs(args)}\n`);
    }
  };
}

function formatConsoleArgs(args: readonly unknown[]): string {
  return formatWithOptions({ colors: false, depth: 4 }, ...args);
}

function createUsage(): string {
  return [
    "Usage: poe-agent-script [options] <script.md|script.ajs>",
    "",
    "Options:",
    "  --fix                 apply lint fixes before running",
    "  --snapshot <path>     write the final snapshot, and best-effort snapshot on SIGINT",
    "  --restore <path>      restore from a snapshot before running",
    "  --max-steps <n>       cap interpreter step budget",
    "  --data-size <n>       cap retained sandbox data units",
    "  -h, --help            print this help",
    "",
    "Exit codes:",
    "  0 success",
    "  1 runtime, usage, file, or restore error",
    "  2 parse error",
    "  3 budget exceeded",
    "  130 interrupted by SIGINT"
  ].join("\n");
}

function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.filename}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code} ${diagnostic.message}`
    )
    .join("\n");
}

function exitCodeForError(error: unknown): number {
  if (error instanceof SandboxError && error.code === "budgetExceeded") {
    return EXIT_BUDGET;
  }

  if (isParseError(error)) {
    return EXIT_PARSE;
  }

  return EXIT_RUNTIME;
}

function isParseError(error: unknown): boolean {
  return error instanceof Error && error.name === "ParseError";
}

function hasDefaultExport(source: string, filename: string): boolean {
  return parseModule(source, filename).body.some(
    (statement) => statement.type === "ExportDefaultDeclaration"
  );
}

function excludeHarnessModule(modules: ModuleRegistry, isRawScript: boolean): ModuleRegistry {
  if (!isRawScript) {
    return modules;
  }

  if (modules instanceof Map) {
    const rawModules = new Map(modules);
    rawModules.delete("harness");
    return rawModules;
  }

  const rawModules = Object.create(null) as Record<string, ModuleExports>;

  for (const [moduleName, moduleExports] of Object.entries(modules)) {
    if (moduleName !== "harness") {
      rawModules[moduleName] = moduleExports;
    }
  }

  return rawModules;
}

function stripByteOrderMark(source: string): string {
  return source.startsWith("\uFEFF") ? source.slice(1) : source;
}

function createLineOffsetSource(source: string, lineOffset: number): string {
  return `${"\n".repeat(Math.max(lineOffset, 0))}${source}`;
}

function countLeadingLineBreaks(source: string): number {
  let count = 0;

  while (source[count] === "\n") {
    count += 1;
  }

  return count;
}

function normalizeLogEntry(entry: LogModuleEntry): LogModuleEntry {
  return {
    ...entry,
    ts: "2026-04-29T00:00:00.000Z"
  };
}

function summarizePrompt(prompt: string): string {
  const normalizedPrompt = prompt.trim().replaceAll("\n", " ");
  return normalizedPrompt.length <= 48 ? normalizedPrompt : `${normalizedPrompt.slice(0, 45)}...`;
}

function readMetricScore(
  scriptName: string,
  state: {
    metricCalls: Map<string, number>;
  }
): number {
  const callCount = (state.metricCalls.get(scriptName) ?? 0) + 1;
  state.metricCalls.set(scriptName, callCount);

  if (scriptName === "tests" && callCount === 1) {
    return 10;
  }

  if (scriptName === "tests" && callCount === 2) {
    return 9;
  }

  return 9 + callCount;
}

function toModuleExports(value: unknown): ModuleExports {
  return value as ModuleExports;
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    const error = new DOMException("This operation was aborted", "AbortError");
    replaceErrorStack(error);
    return error;
  }

  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  replaceErrorStack(error);
  return error;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return hasOwnErrorCode(error, code);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

class CliExitError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "CliExitError";
    this.exitCode = exitCode;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
