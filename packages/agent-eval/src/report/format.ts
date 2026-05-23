import type { RenderTableOptions, TableColumn } from "@poe-code/design-system";
import type {
  AggregateStats,
  AggregatedCell,
  EvalRunResult,
  ScoringComponentCounts,
  ScoringComponentResult,
  Verdict
} from "../types.js";

type ReportColumnName =
  | "eval"
  | "plan"
  | "agent"
  | "model"
  | "iters"
  | "time"
  | "tokens"
  | "cost"
  | "tests"
  | "judge"
  | "components"
  | "correct"
  | "verdict";

export const reportColumns: TableColumn[] = [
  { name: "eval", title: "Eval", alignment: "left", maxLen: 16 },
  { name: "plan", title: "Plan", alignment: "left", maxLen: 14 },
  { name: "agent", title: "Agent", alignment: "left", maxLen: 12 },
  { name: "model", title: "Model", alignment: "left", maxLen: 18 },
  { name: "iters", title: "Iters", alignment: "right", maxLen: 11 },
  { name: "time", title: "Time", alignment: "right", maxLen: 13 },
  { name: "tokens", title: "Tokens", alignment: "right", maxLen: 13 },
  { name: "cost", title: "$", alignment: "right", maxLen: 11 },
  { name: "tests", title: "Tests", alignment: "right", maxLen: 11 },
  { name: "judge", title: "Judge", alignment: "right", maxLen: 11 },
  { name: "components", title: "Components", alignment: "left", maxLen: 48 },
  { name: "correct", title: "Correct", alignment: "right", maxLen: 11 },
  { name: "verdict", title: "Verdict", alignment: "left", maxLen: 48 }
];

export type ReportRow = Record<ReportColumnName, string>;

export function matrixRows(cells: readonly AggregatedCell[]): ReportRow[] {
  return cells.map((cell) => ({
    eval: cell.cell.eval,
    plan: cell.cell.planKind,
    agent: cell.cell.agent,
    model: cell.cell.model,
    iters: formatStats(cell.iterations),
    time: formatDurationStats(cell.durationMs),
    tokens: formatTokenStats(totalTokenStats(cell)),
    cost: formatCostStats(cell.usage.costUsd),
    tests: formatStats({
      mean: cell.tests.passRateMean,
      min: cell.tests.passRateMin,
      max: cell.tests.passRateMax
    }),
    judge: cell.judge === undefined ? "-" : formatStats(cell.judge.mean),
    components: `tests:${formatComponentCounts(cell.scoring.tests)} judge:${formatComponentCounts(cell.scoring.judge)}`,
    correct: formatStats(cell.correctness),
    verdict: matrixVerdict(cell)
  }));
}

export function runRows(runs: readonly EvalRunResult[]): ReportRow[] {
  return runs.map((run) => ({
    eval: run.eval,
    plan: run.planKind,
    agent: run.agent,
    model: run.model,
    iters: formatNumber(run.iterations),
    time: formatDurationValue(run.durationMs),
    tokens: formatTokenValue(run.usage.inputTokens + run.usage.outputTokens),
    cost: formatCostValue(run.usage.costUsd ?? 0),
    tests: `${run.tests.passed}/${run.tests.total}`,
    judge: run.judge === undefined ? "-" : formatNumber(run.judge.mean),
    components: `tests:${formatComponent(run.scoring.tests)} judge:${formatComponent(run.scoring.judge)}`,
    correct: formatNumber(run.correctness),
    verdict: run.verdict
  }));
}

export function tableOptions(
  rows: readonly ReportRow[],
  theme: RenderTableOptions["theme"]
): RenderTableOptions {
  return {
    theme,
    columns: reportColumns,
    rows: rows.map((row) => ({ ...row }))
  };
}

function formatStats(stats: AggregateStats): string {
  return `${formatNumber(stats.mean)} ±${formatNumber(halfRange(stats))}`;
}

function formatDurationStats(stats: AggregateStats): string {
  const unit = Math.abs(stats.mean) >= 60_000 ? "m" : "s";
  const mean = formatDurationValue(stats.mean, unit);
  const delta = formatDurationValue(halfRange(stats), unit);
  return `${mean} ±${delta}`;
}

function formatTokenStats(stats: AggregateStats): string {
  const unit = tokenUnit(stats.mean);
  const mean = formatTokenValue(stats.mean, unit);
  const delta = formatTokenValue(halfRange(stats), unit);
  return `${mean} ±${delta}`;
}

function formatCostStats(stats: AggregateStats): string {
  return `${formatCostValue(stats.mean)} ±${formatCostValue(halfRange(stats))}`;
}

function formatNumber(value: number): string {
  return value.toFixed(1);
}

function formatDurationValue(
  valueMs: number,
  unit: "m" | "s" = Math.abs(valueMs) >= 60_000 ? "m" : "s"
): string {
  const value = unit === "m" ? valueMs / 60_000 : valueMs / 1000;
  return `${formatNumber(value)}${unit}`;
}

function formatTokenValue(value: number, unit: "" | "k" | "M" = tokenUnit(value)): string {
  if (unit === "M") {
    return `${formatNumber(value / 1_000_000)}M`;
  }
  if (unit === "k") {
    return `${formatNumber(value / 1000)}k`;
  }
  return formatNumber(value);
}

function formatCostValue(value: number): string {
  return formatNumber(value);
}

function tokenUnit(value: number): "" | "k" | "M" {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return "M";
  }
  if (abs >= 1000) {
    return "k";
  }
  return "";
}

function halfRange(stats: AggregateStats): number {
  return (stats.max - stats.min) / 2;
}

function totalTokenStats(cell: AggregatedCell): AggregateStats {
  return {
    mean: cell.usage.inputTokens.mean + cell.usage.outputTokens.mean,
    min: cell.usage.inputTokens.min + cell.usage.outputTokens.min,
    max: cell.usage.inputTokens.max + cell.usage.outputTokens.max
  };
}

function matrixVerdict(cell: AggregatedCell): string {
  const displayed: Verdict[] = ["cheated", "budget_exceeded", "error", "fail", "pass"];
  const present = displayed.filter((verdict) => cell.verdicts[verdict] > 0);
  if (present.length === 1) {
    return present[0] as Verdict;
  }
  return present.map((verdict) => `${verdict}:${cell.verdicts[verdict]}`).join(" ");
}

function formatComponent(component: ScoringComponentResult): string {
  return `${component.configured ? "cfg" : "uncfg"}/${component.status}`;
}

function formatComponentCounts(counts: ScoringComponentCounts): string {
  const labels = [
    ["cfg", counts.configured],
    ["exec", counts.executed],
    ["skip", counts.skipped],
    ["fail", counts.failed],
    ["off", counts.disabled]
  ] as const;
  return labels
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}${count}`)
    .join("/");
}
