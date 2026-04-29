import { readFile } from "node:fs/promises";

import { extractBlock } from "../loader/extract-block.js";
import { splitFrontmatter } from "../loader/frontmatter.js";
import { lint, type Diagnostic, type LintOptions } from "../lint.js";
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
  const markdown = await readFile(filepath, "utf8");
  const normalizedMarkdown = stripByteOrderMark(markdown);
  const { frontmatter, body } = splitFrontmatter(normalizedMarkdown);
  const { source, lineOffset } = extractBlock(body);
  const absoluteLineOffset =
    countLineBreaks(normalizedMarkdown.slice(0, normalizedMarkdown.length - body.length)) + lineOffset;
  const executableSource = createLineOffsetSource(source, absoluteLineOffset);
  const meta = {
    filepath,
    kind: frontmatter.kind,
    version: frontmatter.version
  };
  const modules = options.modulesFor(frontmatter, meta);
  const diagnostics = lint(executableSource, {
    filename: filepath,
    modules: createLintModules(modules)
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

function createLintModules(modules: ModuleRegistry): NonNullable<LintOptions["modules"]> {
  const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);

  return new Map(
    entries.map(([moduleName, moduleExports]) => [moduleName, listModuleExports(moduleExports)] as const)
  );
}

function listModuleExports(moduleExports: ModuleExports): string[] {
  const exportNames = moduleExports instanceof Map ? [...moduleExports.keys()] : Object.keys(moduleExports);
  return exportNames.filter((exportName) => exportName.length > 0).sort((left, right) => left.localeCompare(right));
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
    .map((diagnostic) => `${diagnostic.filename}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code} ${diagnostic.message}`)
    .join("\n");
}
