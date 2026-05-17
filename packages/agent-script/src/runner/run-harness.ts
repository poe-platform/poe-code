import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { extractBlock } from "../loader/extract-block.js";
import { splitFrontmatter } from "../loader/frontmatter.js";
import { lint, type Diagnostic } from "../lint.js";
import { createLintModulesFromRuntimeRegistry } from "../lint/runtime-modules.js";
import type { ModuleExports, ModuleRegistry } from "../modules/registry.js";
import { run, type RunResult } from "../run.js";

type HarnessMeta = {
  filepath: string;
  kind: unknown;
  version: unknown;
};

export type RunHarnessOptions = {
  modulesFor: (frontmatter: Record<string, unknown>, meta: HarnessMeta) => ModuleRegistry;
  signal?: AbortSignal;
  snapshotPath?: string;
};

export class LintError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    super(formatLintErrorMessage(diagnostics));
    this.name = "LintError";
    this.diagnostics = diagnostics;
  }
}

export async function runHarness(filepath: string, options: RunHarnessOptions): Promise<RunResult> {
  const rawSource = stripByteOrderMark(await readFile(filepath, "utf8"));
  const { executableSource, frontmatter, isRawScript } = loadExecutableSource(filepath, rawSource);
  const meta = {
    filepath,
    kind: frontmatter.kind,
    version: frontmatter.version
  };
  const modules = excludeHarnessModule(options.modulesFor(frontmatter, meta), isRawScript);
  const diagnostics = lint(executableSource, {
    filename: filepath,
    modules: createLintModulesFromRuntimeRegistry(modules)
  });
  const lintErrors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");

  if (lintErrors.length > 0) {
    throw new LintError(lintErrors);
  }

  return run(executableSource, {
    modules,
    signal: options.signal,
    snapshotPath: options.snapshotPath
  });
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
    return {
      executableSource: source,
      frontmatter: {},
      isRawScript: true
    };
  }

  const { frontmatter, body } = splitFrontmatter(source);
  const { source: executableBlock, lineOffset } = extractBlock(body);
  const absoluteLineOffset =
    countLineBreaks(source.slice(0, source.length - body.length)) + lineOffset;

  return {
    executableSource: createLineOffsetSource(executableBlock, absoluteLineOffset),
    frontmatter,
    isRawScript: false
  };
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
