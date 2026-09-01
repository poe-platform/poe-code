#!/usr/bin/env node
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path, { dirname, extname } from "node:path";
import { formatWithOptions } from "node:util";
import { fileURLToPath } from "node:url";

import { hasOwnErrorCode } from "./error-codes.js";
import { formatInterpreterError } from "./error/format.js";
import { replaceErrorStack } from "./error/shape.js";
import { Budget, SandboxError } from "./interp/budget.js";
import { countLineBreaks, extractBlock, maskSource } from "./loader/extract-block.js";
import { splitFrontmatter } from "./loader/frontmatter.js";
import { lint, type Diagnostic, type Fix } from "./lint.js";
import { createLintModulesFromRuntimeRegistry } from "./lint/runtime-modules.js";
import { makeAgentModule } from "./modules/agent.js";
import { makeEnvModule, parseEnvConfig, type EnvModuleOptions } from "./modules/env.js";
import { makeFailModule } from "./modules/fail.js";
import { makeFsModule, type FsModuleOptions } from "./modules/fs.js";
import { parseFsConfig, resolveFsConfig } from "./modules/fs-config.js";
import { makeMcpModule } from "./modules/mcp.js";
import { parseMcpConfig, type McpModuleOptions } from "./modules/mcp-transport.js";
import { makeHarnessModule } from "./modules/harness.js";
import { makeLogModule, type LogModuleEntry } from "./modules/log.js";
import { makeMetricModule } from "./modules/metric.js";
import {
  createBrokenPipeState,
  createSafeOutputStream,
  withBrokenPipeGuard,
  type BrokenPipeState,
  type OutputStream
} from "./output-stream.js";
import type { ModuleExports, ModuleRegistry } from "./modules/registry.js";
import { parseModule } from "./parse/parser.js";
import { restore, type SafeJSSnapshot } from "./restore.js";
import { run, type RunResult } from "./run.js";
import { dump, dumpCurrent } from "./snapshot/dump.js";
import { migrateSnapshotFile, type SnapshotMigrationFileOptions } from "./migration-file.js";

type CliStream = OutputStream;

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
  env?: EnvModuleOptions;
  mcp?: McpModuleOptions;
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
  fs: boolean;
  fsRoot?: string;
  fsConfig?: string;
  envConfig?: string;
  mcpConfig?: string;
  dataSize?: number;
  maxSteps?: number;
  restorePath?: string;
  snapshotPath?: string;
};

type LoadedSource = {
  sourceOffset: number;
  fixRanges?: readonly Fix["range"][];
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
  const brokenPipe = createBrokenPipeState();
  const stdout = createSafeOutputStream(options.stdout ?? process.stdout, brokenPipe);
  const stderr = createSafeOutputStream(options.stderr ?? process.stderr, brokenPipe);

  return withBrokenPipeGuard(
    [options.stdout ?? process.stdout, options.stderr ?? process.stderr],
    brokenPipe,
    async () => {
      try {
        if (argv.includes("--help") || argv.includes("-h")) {
          stdout.write(`${createUsage()}\n`);
          return 0;
        }

        if (argv[0] === "migrate") {
          const result = await migrateSnapshotFile({
            ...parseMigrationArgs(argv.slice(1)),
            cwd: options.cwd ?? readCurrentWorkingDirectory()
          });
          stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return 0;
        }
        const parsed = parseArgs(argv);
        if (parsed.filepath === undefined) {
          stderr.write(`${createUsage()}\n`);
          return brokenPipe.closed ? 0 : EXIT_RUNTIME;
        }

        const cwd = options.cwd ?? readCurrentWorkingDirectory();
        const filepath = path.resolve(cwd, parsed.filepath);
        const configuredFs =
          parsed.fsConfig === undefined
            ? undefined
            : await resolveFsConfig(
                parseFsConfig(
                  await (options.readFile ?? readFile)(path.resolve(cwd, parsed.fsConfig), "utf8")
                )
              );
        await assertHarnessFile({
          displayPath: parsed.filepath,
          filepath,
          statFile: options.stat ?? stat
        });

        return await runScriptFile(filepath, parsed, {
          cwd,
          configuredFs,
          env: options.env,
          mcp: options.mcp,
          modulesFor: options.modulesFor,
          process: options.process ?? process,
          readFile: options.readFile ?? readFile,
          brokenPipe,
          stderr,
          stdout,
          writeFile: options.writeFile ?? writeFile
        });
      } catch (error) {
        if (brokenPipe.closed) {
          return 0;
        }
        stderr.write(`${readErrorMessage(error)}\n`);
        return brokenPipe.closed
          ? 0
          : error instanceof CliExitError
            ? error.exitCode
            : exitCodeForError(error);
      }
    }
  );
}

function readCurrentWorkingDirectory(): string {
  try {
    return process.cwd();
  } catch (error) {
    throw new Error(`Unable to resolve current working directory: ${readErrorMessage(error)}`);
  }
}

function parseMigrationArgs(argv: readonly string[]): SnapshotMigrationFileOptions {
  const result: SnapshotMigrationFileOptions = { snapshotPath: "", sourcePath: "" };
  const paths = new Map<string, "sourcePath" | "targetSourcePath" | "planPath" | "outputPath">([
    ["--from", "sourcePath"],
    ["--to", "targetSourcePath"],
    ["--plan", "planPath"],
    ["--output", "outputPath"]
  ]);
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("-")) {
      if (result.snapshotPath.length > 0)
        throw new TypeError("Migration accepts exactly one snapshot path.");
      result.snapshotPath = argument;
      continue;
    }
    if (seen.has(argument)) throw new TypeError(`Duplicate migration option: ${argument}`);
    seen.add(argument);
    if (argument === "--inspect") {
      result.inspect = true;
      continue;
    }
    if (argument === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    const key = paths.get(argument);
    if (key === undefined) throw new TypeError(`Unknown migration option: ${argument}`);
    const value = argv[++index];
    if (value === undefined || value.startsWith("--"))
      throw new TypeError(`${argument} requires a path.`);
    result[key] = value;
  }
  return result;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    fix: false,
    fs: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--fix") {
      parsed.fix = true;
      continue;
    }

    if (arg === "--fs") {
      parsed.fs = true;
      continue;
    }

    if (arg === "--fs-root") {
      parsed.fsRoot = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--fs-config") {
      if (parsed.fsConfig !== undefined) {
        throw new CliExitError("--fs-config may be specified only once.", EXIT_RUNTIME);
      }
      const value = readFlagValue(argv, index, arg);
      if (value.trim().length === 0 || value.startsWith("--")) {
        throw new CliExitError("--fs-config needs a JSON file path.", EXIT_RUNTIME);
      }
      parsed.fsConfig = value;
      index += 1;
      continue;
    }

    if (arg === "--mcp-config") {
      parsed.mcpConfig = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--env-config") {
      parsed.envConfig = readFlagValue(argv, index, arg);
      index += 1;
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

  if (parsed.fsConfig !== undefined && (parsed.fs || parsed.fsRoot !== undefined)) {
    throw new CliExitError("--fs-config cannot be combined with --fs or --fs-root.", EXIT_RUNTIME);
  }

  if (!parsed.fs && parsed.fsRoot !== undefined) {
    throw new CliExitError(
      "--fs-root requires --fs. Pass --fs to give the script a filesystem confined to that root, or drop --fs-root.",
      EXIT_RUNTIME
    );
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
    configuredFs: FsModuleOptions | undefined;
    env: EnvModuleOptions | undefined;
    mcp: McpModuleOptions | undefined;
    modulesFor: RunCliOptions["modulesFor"];
    brokenPipe: BrokenPipeState;
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
    fs: parsed.fs
      ? { root: path.resolve(options.cwd, parsed.fsRoot ?? dirname(filepath)) }
      : undefined,
    modulesFor: options.modulesFor,
    stderr: options.stderr,
    stdout: options.stdout
  });
  if (options.configuredFs !== undefined) {
    const registry = new Map(
      runtime.registry instanceof Map ? runtime.registry : Object.entries(runtime.registry)
    );
    if (registry.has("fs")) throw new TypeError("fs is already registered by modulesFor.");
    registry.set("fs", toModuleExports(makeFsModule(options.configuredFs)));
    runtime.registry = registry;
  }
  let env = options.env;
  if (parsed.envConfig !== undefined) {
    if (env !== undefined)
      throw new TypeError("Pass environment options or --env-config, not both.");
    const configPath = path.resolve(options.cwd, parsed.envConfig);
    env = parseEnvConfig(await options.readFile(configPath, "utf8"));
  }
  if (env !== undefined) {
    const registry = new Map(
      runtime.registry instanceof Map ? runtime.registry : Object.entries(runtime.registry)
    );
    if (registry.has("env"))
      throw new TypeError("Environment is already registered by modulesFor.");
    registry.set("env", makeEnvModule(env));
    runtime.registry = registry;
  }
  let mcp = options.mcp;
  if (parsed.mcpConfig !== undefined) {
    if (mcp !== undefined) throw new TypeError("Pass MCP options or --mcp-config, not both.");
    const configPath = path.resolve(options.cwd, parsed.mcpConfig);
    mcp = parseMcpConfig(await options.readFile(configPath, "utf8"), dirname(configPath));
  }
  if (mcp !== undefined) {
    const registry = new Map(
      runtime.registry instanceof Map ? runtime.registry : Object.entries(runtime.registry)
    );
    if (registry.has("mcp")) throw new TypeError("MCP is already registered by modulesFor.");
    registry.set("mcp", makeMcpModule(mcp));
    runtime.registry = registry;
  }
  const modules = excludeHarnessModule(runtime.registry, loaded.isRawScript);
  let executableSource = loaded.executableSource;
  const lintResult = parsed.fix
    ? lint(executableSource, {
        allowedExportNames: ["schema"],
        filename: filepath,
        fix: true,
        fixRanges: loaded.fixRanges,
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
        replaceExecutableSource(loaded.rawSource, loaded, lintResult.fixes),
        {
          encoding: "utf8"
        }
      );
    }
  }

  const lintErrors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (lintErrors.length > 0) {
    options.stderr.write(`Lint failed:\n${formatDiagnostics(lintErrors)}\n`);
    if (options.brokenPipe.closed) {
      return 0;
    }
    return lintErrors.some((diagnostic) => diagnostic.code === "AS001") ? EXIT_PARSE : EXIT_RUNTIME;
  }

  const lintWarnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  if (lintWarnings.length > 0) {
    options.stderr.write(`Lint warnings:\n${formatDiagnostics(lintWarnings)}\n`);
    if (options.brokenPipe.closed) {
      return 0;
    }
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

    if (options.brokenPipe.closed) {
      return 0;
    }

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
      if (options.brokenPipe.closed) {
        return 0;
      }
      return interrupted ? EXIT_SIGINT : exitCodeForError(result.error);
    }

    options.stdout.write(`${JSON.stringify({ ok: true, returnValue: result.returnValue })}\n`);
    return options.brokenPipe.closed ? 0 : interrupted ? EXIT_SIGINT : 0;
  } catch (error) {
    await signalSnapshotWrite;
    if (parsed.snapshotPath !== undefined && runPromise !== undefined) {
      try {
        await writeSnapshot(
          parsed.snapshotPath,
          await dump(runPromise, { onFailure: "checkpoint" }),
          options
        );
      } catch (snapshotError) {
        options.stderr.write(
          `Failed to write recovery snapshot at ${parsed.snapshotPath}: ${readErrorMessage(snapshotError)}. Any existing snapshot may be stale.\n`
        );
      }
    }
    if (options.brokenPipe.closed) {
      return 0;
    }
    options.stderr.write(
      `${formatInterpreterError(error, {
        filename: filepath,
        source: executableSource
      })}\n`
    );
    return options.brokenPipe.closed ? 0 : interrupted ? EXIT_SIGINT : exitCodeForError(error);
  } finally {
    options.process.off("SIGINT", onSigint);
  }
}

function loadExecutableSource(filepath: string, rawSource: string): LoadedSource {
  const source = stripByteOrderMark(rawSource);
  const byteOrderMarkLength = rawSource.length - source.length;

  if (isRawScriptExtension(extname(filepath))) {
    return {
      sourceOffset: byteOrderMarkLength,
      executableSource: source,
      frontmatter: {},
      isRawScript: true,
      rawSource
    };
  }

  const { frontmatter, body } = splitFrontmatter(source);
  const bodyStartOffset = rawSource.length - body.length;
  const executableBlock = extractBlock(body, countLineBreaks(rawSource, 0, bodyStartOffset) + 1);

  return {
    sourceOffset: 0,
    fixRanges: executableBlock.ranges.map(([start, end]) => [
      bodyStartOffset + start,
      bodyStartOffset + end
    ]),
    executableSource:
      maskSource(rawSource.slice(0, bodyStartOffset + executableBlock.startOffset)) +
      executableBlock.source,
    frontmatter,
    isRawScript: false,
    rawSource
  };
}

function isRawScriptExtension(extension: string): boolean {
  return extension === ".safejs" || extension === ".ajs";
}

function replaceExecutableSource(
  source: string,
  loaded: LoadedSource,
  fixes: readonly Fix[]
): string {
  return fixes.reduce(
    (result, fix) =>
      `${result.slice(0, loaded.sourceOffset + fix.range[0])}${fix.replacement}${result.slice(loaded.sourceOffset + fix.range[1])}`,
    source
  );
}

function createRuntime(
  frontmatter: Record<string, unknown>,
  meta: HarnessMeta,
  options: {
    fs: FsModuleOptions | undefined;
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
      // The one module here that is not a stub, so it is registered only when asked for.
      ...(options.fs === undefined ? {} : { fs: toModuleExports(makeFsModule(options.fs)) }),
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
): Promise<SafeJSSnapshot | undefined> {
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
    return JSON.parse(rawSnapshot) as SafeJSSnapshot;
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
    "Usage: poe-safe-js [options] <script.md|script.safejs|script.ajs>",
    "       poe-safe-js migrate <checkpoint.json> --from <original.ajs> --inspect",
    "       poe-safe-js migrate <checkpoint.json> --from <original.ajs> --to <continuation.ajs>",
    "                         --plan <migration.json> --output <new-checkpoint.json> [--dry-run]",
    "",
    "Compatibility alias: poe-safejs",
    "",
    "Options:",
    "  --fix                 apply lint fixes before running",
    "  --fs                  register the fs module: a real filesystem, unlike the agent",
    "                        and metric stubs this runner bundles",
    "  --fs-root <path>      directory --fs confines the script to (default: the script's",
    "                        directory)",
    "  --fs-config <path>    configure shared filesystem access from JSON (Node only)",
    "  --mcp-config <path>   register named MCP servers from an explicit JSON config",
    "  --env-config <path>   grant environment reads from an explicit JSON config",
    "  --snapshot <path>     write success/failure state; best-effort snapshot on SIGINT",
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

async function isDirectExecution(entryPoint: string | undefined): Promise<boolean> {
  if (typeof entryPoint !== "string" || entryPoint.length === 0) {
    return false;
  }

  try {
    const [resolvedEntryPoint, resolvedModule] = await Promise.all([
      realpath(path.resolve(entryPoint)),
      realpath(fileURLToPath(import.meta.url))
    ]);
    return resolvedEntryPoint === resolvedModule;
  } catch {
    return false;
  }
}

if (await isDirectExecution(process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
