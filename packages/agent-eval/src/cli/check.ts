import { UserError } from "toolcraft";
import {
  color,
  getTheme,
  renderTable,
  withOutputFormat,
  type RenderTableOptions,
  type TableColumn
} from "toolcraft-design";
import { evalCheck, type CheckResult } from "../check/check.js";
import { openSource } from "../source/open.js";
import { listEvals } from "../source/registry.js";
import { resolveEvalCliTarget } from "./target.js";

export interface CheckCliInput {
  evalId?: string;
  sourceDir?: string;
}

const columns: TableColumn[] = [
  { name: "status", title: "Status", alignment: "left", maxLen: 8 },
  { name: "case", title: "Case", alignment: "left", maxLen: 40 },
  { name: "time", title: "Time", alignment: "right", maxLen: 8 },
  { name: "message", title: "Message", alignment: "left", maxLen: 60 }
];

export async function runCheckCli(input: CheckCliInput): Promise<number> {
  const target = resolveEvalCliTarget(input);
  const source = await openSource(target.sourceDir);
  const evalId = target.evalId ?? (await resolveDefaultEvalId(source.rootDir));
  const result = await evalCheck({ sourceDir: source.rootDir, evalId });

  process.stdout.write(`${renderCheckResultTable(result)}\n`);
  return result.tests.passed === result.tests.total ? 0 : 1;
}

export function renderCheckResultTable(result: CheckResult): string {
  const rows = result.tests.cases.map((testCase) => ({
    status: testCase.passed ? color.green("✓") : color.red("X"),
    case: testCase.name,
    time: formatDuration(testCase.durationMs),
    message: testCase.message ?? ""
  }));
  const table = withOutputFormat("terminal", () =>
    renderTable({
      theme: getTheme(),
      columns,
      rows
    } satisfies RenderTableOptions)
  );
  const summary =
    result.tests.passed === result.tests.total
      ? color.green(summaryText(result))
      : color.red(summaryText(result));

  return `${table}\n${summary}`;
}

async function resolveDefaultEvalId(sourceDir: string): Promise<string> {
  const source = { rootDir: sourceDir };
  const evalIds = await listEvals(source);
  if (evalIds.length === 1) {
    return evalIds[0] as string;
  }

  throw new UserError(
    [
      "Multiple evals found. Pass an eval id to check.",
      `Available eval ids: ${evalIds.length === 0 ? "(none)" : evalIds.join(", ")}`
    ].join("\n")
  );
}

function summaryText(result: CheckResult): string {
  return `${result.tests.passed}/${result.tests.total} cases passed in ${formatDuration(
    result.durationMs
  )}`;
}

function formatDuration(durationMs: number): string {
  if (Math.abs(durationMs) >= 1000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  return `${Math.round(durationMs)}ms`;
}
