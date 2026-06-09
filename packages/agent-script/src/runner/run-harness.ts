import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import { extractBlock } from "../loader/extract-block.js";
import { splitFrontmatter } from "../loader/frontmatter.js";
import { lint, type Diagnostic } from "../lint.js";
import { createLintModulesFromRuntimeRegistry } from "../lint/runtime-modules.js";
import type { ModuleExports, ModuleRegistry } from "../modules/registry.js";
import type { OtelSink } from "../observability/otel.js";
import { run, type RunResult } from "../run.js";
import type { SnapshotBackend } from "../snapshot/backend.js";

type HarnessMeta = {
  filepath: string;
  kind: unknown;
  version: unknown;
};

export type RunHarnessOptions = {
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
  const rawSource = stripByteOrderMark(await readHarnessFile(filepath));
  const { executableSource, frontmatter, isRawScript } = loadExecutableSource(filepath, rawSource);
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
  const executableSource = stripByteOrderMark(rawScript);
  const meta = createHarnessMeta(pair.markdownPath, frontmatter);
  const modules = options.modulesFor(frontmatter, meta);
  const diagnostics = lint(executableSource, {
    allowedExportNames: ["schema"],
    filename: pair.scriptPath,
    frontmatterFields: Object.keys(frontmatter),
    modules: createLintModulesFromRuntimeRegistry(modules)
  });
  const lintErrors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");

  if (lintErrors.length > 0) {
    throw new LintError(lintErrors);
  }

  return runHarnessSource(executableSource, {
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
  const stats = await stat(filepath);
  if (!stats.isFile()) {
    throw new Error(`Harness path must point to a file: ${filepath}`);
  }

  return readFile(filepath, "utf8");
}

function loadExecutableSource(
  filepath: string,
  source: string
): {
  executableSource: string;
  frontmatter: Record<string, unknown>;
  isRawScript: boolean;
} {
  if (extname(filepath) === ".ajs") {
    if (source.length === 0) {
      throw new Error(`No code block found in empty harness file: ${filepath}`);
    }

    return {
      executableSource: source,
      frontmatter: {},
      isRawScript: true
    };
  }

  const { frontmatter, body } = splitFrontmatter(source);
  if (source.length === 0 || body.trim().length === 0) {
    throw new Error(`No code block found in empty harness file: ${filepath}`);
  }

  const { source: executableBlock, lineOffset } = extractBlock(body);
  const absoluteLineOffset =
    countLineBreaks(source.slice(0, source.length - body.length)) + lineOffset;

  return {
    executableSource: createLineOffsetSource(executableBlock, absoluteLineOffset),
    frontmatter,
    isRawScript: false
  };
}

function resolveHarnessPair(filepath: string): { markdownPath: string; scriptPath: string } {
  const extension = extname(filepath);
  const basename = extension.length === 0 ? filepath : filepath.slice(0, -extension.length);

  if (extension === ".ajs") {
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

function countLineBreaks(source: string): number {
  let count = 0;

  for (const character of source) {
    if (character === "\n") {
      count += 1;
    }
  }

  return count;
}

function createLineOffsetSource(source: string, lineOffset: number): string {
  return `${"\n".repeat(Math.max(lineOffset, 0))}${source}`;
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
