import nodeFs from "node:fs/promises";
import path from "node:path";
import { UserError } from "toolcraft";
import { color, getTheme, renderTable, withOutputFormat } from "toolcraft-design";

import { hasOwnErrorCode } from "../error-codes.js";
import { evalLint, type LintIssue, type LintResult } from "../lint/lint.js";
import { emptySourceMessage } from "../source/open.js";
import { listEvals } from "../source/registry.js";
import { resolveEvalCliTarget } from "./target.js";
import type { EvalFs } from "../types.js";
import type { RenderTableOptions, TableColumn } from "toolcraft-design";

export interface LintCliInput {
  evalId?: string;
  sourceDir?: string;
}

const columns: TableColumn[] = [
  { name: "code", title: "Code", alignment: "left", maxLen: 8 },
  { name: "path", title: "Path", alignment: "left", maxLen: 40 },
  { name: "message", title: "Message", alignment: "left", maxLen: 80 }
];

export async function runLintCli(input: LintCliInput): Promise<number> {
  const target = resolveEvalCliTarget(input);
  const sourceDir = target.sourceDir;
  const fs = nodeFs as unknown as EvalFs;
  await assertSourceDirectory(sourceDir, fs);

  const evalIds =
    target.evalId === undefined ? await resolveDefaultEvalIds(sourceDir, fs) : [target.evalId];
  const results = await Promise.all(
    evalIds.map((evalId) =>
      evalLint({
        sourceDir,
        evalId
      })
    )
  );

  process.stdout.write(`${renderLintResults(results, sourceDir)}\n`);
  return results.some((result) => result.issues.some((issue) => issue.severity === "error")) ? 1 : 0;
}

export function renderLintResults(results: readonly LintResult[], sourceDir?: string): string {
  return results.map((result) => renderLintResult(result, sourceDir)).join("\n\n");
}

function renderLintResult(result: LintResult, sourceDir: string | undefined): string {
  const lines = [color.bold(result.evalId)];
  const errors = result.issues.filter((issue) => issue.severity === "error");
  const warnings = result.issues.filter((issue) => issue.severity === "warning");

  if (errors.length === 0 && warnings.length === 0) {
    lines.push(color.green("No lint issues."));
    return lines.join("\n");
  }

  if (errors.length > 0) {
    lines.push(color.red("Errors"));
    lines.push(renderIssueTable(errors, sourceDir));
  }

  if (warnings.length > 0) {
    lines.push(color.yellow("Warnings"));
    lines.push(renderIssueTable(warnings, sourceDir));
  }

  return lines.join("\n");
}

function renderIssueTable(issues: readonly LintIssue[], sourceDir: string | undefined): string {
  return withOutputFormat("terminal", () =>
    renderTable({
      theme: getTheme(),
      columns,
      rows: issues.map((issue) => ({
        code: issue.severity === "error" ? color.red(issue.code) : color.yellow(issue.code),
        path: formatIssuePath(issue.path, sourceDir),
        message: issue.message
      }))
    } satisfies RenderTableOptions)
  );
}

function formatIssuePath(issuePath: string | undefined, sourceDir: string | undefined): string {
  if (issuePath === undefined || sourceDir === undefined) {
    return issuePath ?? "";
  }

  const relative = path.relative(sourceDir, issuePath);
  if (relative.length === 0) {
    return ".";
  }

  if (relative === ".." || relative.startsWith("../")) {
    return issuePath;
  }

  return relative;
}

async function resolveDefaultEvalIds(sourceDir: string, fs: EvalFs): Promise<readonly string[]> {
  const evalIds = await listEvals({ rootDir: sourceDir }, fs);
  if (evalIds.length === 0) {
    throw new UserError(emptySourceMessage(sourceDir));
  }

  return evalIds.length === 1 ? [evalIds[0] as string] : evalIds;
}

async function assertSourceDirectory(sourceDir: string, fs: EvalFs): Promise<void> {
  let stat: Awaited<ReturnType<EvalFs["stat"]>>;
  try {
    stat = await fs.stat(sourceDir);
  } catch (error) {
    if (isMissingPath(error)) {
      throw new UserError(`Eval source "${sourceDir}" does not exist or is not a directory.`);
    }
    throw error;
  }

  if (!stat.isDirectory()) {
    throw new UserError(`Eval source "${sourceDir}" is not a directory.`);
  }
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}
