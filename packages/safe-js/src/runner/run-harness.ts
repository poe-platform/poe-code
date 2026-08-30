import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import { supportsSpawnMode } from "@poe-code/agent-spawn/configs";
import { SPAWN_MODES, type SpawnMode } from "@poe-code/agent-spawn/types";
import { hasOwnErrorCode } from "../error-codes.js";
import { countLineBreaks, extractBlock, maskSource } from "../loader/extract-block.js";
import { splitFrontmatter } from "../loader/frontmatter.js";
import { lint, type Diagnostic } from "../lint.js";
import { createLintModulesFromRuntimeRegistry } from "../lint/runtime-modules.js";
import type { ModuleExports, ModuleRegistry } from "../modules/registry.js";
import type { OtelSink } from "../observability/otel.js";
import { parseModule } from "../parse/parser.js";
import { run, type RunOptions, type RunResult } from "../run.js";
import type { SnapshotBackend } from "../snapshot/backend.js";

type HarnessMeta = {
  filepath: string;
  kind: unknown;
  version: unknown;
};

export type RunHarnessOptions = {
  budget?: RunOptions["budget"];
  modulesFor: (frontmatter: Record<string, unknown>, meta: HarnessMeta) => ModuleRegistry;
  otelSink?: OtelSink;
  signal?: AbortSignal;
  snapshotBackend?: SnapshotBackend;
  snapshotIntervalMs?: number;
  snapshotPath?: string;
};

export type RunHarnessExecutionErrorResult = {
  aborted?: true;
  error: unknown;
  ok: false;
};

export type RunHarnessResult = RunResult | RunHarnessExecutionErrorResult;

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function createHarnessMeta(filepath: string, frontmatter: Record<string, unknown>): HarnessMeta {
  return {
    filepath,
    kind: getOwnEntry(frontmatter, "kind"),
    version: getOwnEntry(frontmatter, "version")
  };
}

function assertFrontmatterAgentModes(frontmatter: Record<string, unknown>): void {
  const agents = getOwnEntry(frontmatter, "agents");
  if (typeof agents !== "object" || agents === null || Array.isArray(agents)) {
    return;
  }

  for (const [name, definition] of Object.entries(agents)) {
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
      continue;
    }

    const record = definition as Record<string, unknown>;
    const agent = getOwnEntry(record, "agent");
    const mode = getOwnEntry(record, "mode");
    if (typeof agent !== "string" || typeof mode !== "string") {
      continue;
    }

    // Malformed mode strings are reported by the agent module's own validation.
    if (!SPAWN_MODES.includes(mode as SpawnMode)) {
      continue;
    }

    if (!supportsSpawnMode(agent, mode as SpawnMode)) {
      throw new Error(`Harness agent "${name}": agent "${agent}" does not support mode "${mode}".`);
    }
  }
}

export class LintError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    super(formatLintErrorMessage(diagnostics));
    this.name = "LintError";
    this.diagnostics = diagnostics;
  }
}

export async function runHarness(
  filepath: string,
  options: RunHarnessOptions
): Promise<RunHarnessResult> {
  const rawSource = await readHarnessFile(filepath);
  const { executableSource, frontmatter, isRawScript } = loadExecutableSource(filepath, rawSource);
  assertFrontmatterAgentModes(frontmatter);
  const meta = createHarnessMeta(filepath, frontmatter);
  const modules = excludeHarnessModule(options.modulesFor(frontmatter, meta), isRawScript);
  const diagnostics = lint(executableSource, {
    filename: filepath,
    modules: createLintModulesFromRuntimeRegistry(modules)
  });
  const lintErrors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");

  if (lintErrors.length > 0) {
    throw new LintError(lintErrors);
  }

  return runHarnessSource(executableSource, {
    budget: options.budget,
    entryPointArgs: hasDefaultExport(executableSource, filepath) ? [] : undefined,
    filename: filepath,
    modules,
    otelSink: options.otelSink,
    signal: options.signal,
    snapshotBackend: options.snapshotBackend,
    snapshotIntervalMs: options.snapshotIntervalMs,
    snapshotPath: options.snapshotPath
  });
}

export async function runHarnessPair(
  filepath: string,
  options: RunHarnessOptions
): Promise<RunHarnessResult> {
  const pair = resolveHarnessPair(filepath);
  const [rawMarkdown, rawScript] = await Promise.all([
    readHarnessFile(pair.markdownPath),
    readHarnessFile(pair.scriptPath)
  ]);
  const { frontmatter, body } = splitFrontmatter(stripByteOrderMark(rawMarkdown));
  assertFrontmatterAgentModes(frontmatter);
  const executableSource = stripByteOrderMark(rawScript);
  const meta = createHarnessMeta(pair.markdownPath, frontmatter);
  const modules = options.modulesFor(frontmatter, meta);
  const diagnostics = lint(executableSource, {
    allowedExportNames: ["schema"],
    defaultExport: {
      parameters: ["frontmatter"],
      required: true
    },
    filename: pair.scriptPath,
    frontmatterFields: Object.keys(frontmatter),
    modules: createLintModulesFromRuntimeRegistry(modules)
  });
  const lintErrors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");

  if (lintErrors.length > 0) {
    throw new LintError(lintErrors);
  }

  return runHarnessSource(executableSource, {
    budget: options.budget,
    entryPointArgs: [frontmatter],
    filename: pair.scriptPath,
    importMeta: {
      body,
      filepath: pair.markdownPath,
      kind: meta.kind,
      version: meta.version
    },
    modules,
    otelSink: options.otelSink,
    signal: options.signal,
    snapshotBackend: options.snapshotBackend,
    snapshotIntervalMs: options.snapshotIntervalMs,
    snapshotPath: options.snapshotPath
  });
}

async function readHarnessFile(filepath: string): Promise<string> {
  try {
    const stats = await stat(filepath);
    if (!stats.isFile()) {
      throw new Error(`Harness path must point to a file: ${filepath}`);
    }

    return await readFile(filepath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR")) {
      throw new Error(`Harness file not found: ${filepath}`);
    }

    throw error;
  }
}

function loadExecutableSource(
  filepath: string,
  source: string
): {
  executableSource: string;
  frontmatter: Record<string, unknown>;
  isRawScript: boolean;
} {
  if (isRawScriptPath(filepath)) {
    const executableSource = stripByteOrderMark(source);
    if (executableSource.length === 0) {
      throw new Error(`No code block found in empty harness file: ${filepath}`);
    }

    return {
      executableSource,
      frontmatter: {},
      isRawScript: true
    };
  }

  const { frontmatter, body } = splitFrontmatter(source);
  if (source.length === 0 || body.trim().length === 0) {
    throw new Error(`No code block found in empty harness file: ${filepath}`);
  }

  const bodyStartOffset = source.length - body.length;
  const { source: executableBlock, startOffset } = extractBlock(
    body,
    countLineBreaks(source, 0, bodyStartOffset) + 1
  );
  return {
    executableSource:
      maskSource(source.slice(0, bodyStartOffset + startOffset)) + stripHashbang(executableBlock),
    frontmatter,
    isRawScript: false
  };
}

function resolveHarnessPair(filepath: string): { markdownPath: string; scriptPath: string } {
  const extension = extname(filepath);
  const basename = extension.length === 0 ? filepath : filepath.slice(0, -extension.length);

  if (isRawScriptExtension(extension)) {
    return {
      markdownPath: `${basename}.md`,
      scriptPath: filepath
    };
  }

  return {
    markdownPath: filepath,
    scriptPath: `${basename}.ajs`
  };
}

function isRawScriptPath(filepath: string): boolean {
  return isRawScriptExtension(extname(filepath));
}

function isRawScriptExtension(extension: string): boolean {
  return extension === ".safejs" || extension === ".ajs";
}

async function runHarnessSource(
  executableSource: string,
  options: Parameters<typeof run>[1]
): Promise<RunHarnessResult> {
  try {
    return await run(executableSource, options);
  } catch (error) {
    if (isSetupError(error)) {
      throw error;
    }

    return {
      ...(isAbortError(error) ? { aborted: true as const } : {}),
      error,
      ok: false
    };
  }
}

function isSetupError(error: unknown): boolean {
  return error instanceof Error && error.name === "ParseError";
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError";
  }

  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "name") &&
    (error as { name?: unknown }).name === "AbortError"
  );
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

  const rawModules: Record<string, ModuleExports> = {};

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

function stripHashbang(source: string): string {
  if (!source.startsWith("#!")) {
    return source;
  }

  let end = 2;
  while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end += 1;
  return `${" ".repeat(end)}${source.slice(end)}`;
}

function formatLintErrorMessage(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "Script lint failed.";
  }

  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.filename}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code} ${diagnostic.message}`
    )
    .join("\n");
}
