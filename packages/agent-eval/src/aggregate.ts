import type {
  AggregatedCell,
  EvalRunResult,
  MetricResult,
  ResultComparison,
  ResultComparisonDelta,
  ScoringComponentCounts,
  ScoringComponentResult,
  Verdict
} from "./types.js";

export interface AggregateStats {
  mean: number;
  min: number;
  max: number;
}

type CellKey = keyof AggregatedCell["cell"];

const cellKeys: readonly CellKey[] = ["eval", "agent", "model", "planKind"];
const verdicts: readonly Verdict[] = ["pass", "fail", "error", "cheated", "budget_exceeded"];

function stats(values: readonly number[]): AggregateStats {
  let sum = 0;
  let min = values[0] as number;
  let max = values[0] as number;

  for (const value of values) {
    sum += value;
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  return {
    mean: sum / values.length,
    min,
    max
  };
}

function passRate(run: EvalRunResult): number {
  if (run.tests.total === 0) {
    return 0;
  }

  return run.tests.passed / run.tests.total;
}

function assertSameCell(first: EvalRunResult, runs: readonly EvalRunResult[]): void {
  for (const run of runs.slice(1)) {
    for (const key of cellKeys) {
      if (run[key] !== first[key]) {
        throw new Error(`Cannot aggregate runs with different ${key} values`);
      }
    }
  }
}

export function aggregateRuns(runs: readonly EvalRunResult[]): AggregatedCell {
  const first = runs[0];
  if (!first) {
    throw new Error("Cannot aggregate zero runs");
  }

  assertSameCell(first, runs);

  const passRateStats = stats(runs.map(passRate));

  const aggregate: AggregatedCell = {
    cell: {
      eval: first.eval,
      agent: first.agent,
      model: first.model,
      planKind: first.planKind
    },
    repeats: runs.length,
    runIds: runs.map((run) => run.runId),
    cheated_any: runs.some((run) => run.cheated === true),
    verdicts: countVerdicts(runs),
    iterations: stats(runs.map((run) => run.iterations)),
    durationMs: stats(runs.map((run) => run.durationMs)),
    usage: {
      inputTokens: stats(runs.map((run) => run.usage.inputTokens)),
      outputTokens: stats(runs.map((run) => run.usage.outputTokens)),
      cachedTokens: stats(runs.map((run) => run.usage.cachedTokens ?? 0)),
      costUsd: stats(runs.map((run) => run.usage.costUsd ?? 0))
    },
    totals: {
      durationMs: total(runs.map((run) => run.durationMs)),
      inputTokens: total(runs.map((run) => run.usage.inputTokens)),
      outputTokens: total(runs.map((run) => run.usage.outputTokens)),
      cachedTokens: total(runs.map((run) => run.usage.cachedTokens ?? 0)),
      ...(hasRecordedCost(runs)
        ? { costUsd: total(runs.map((run) => run.usage.costUsd as number)) }
        : {})
    },
    tests: {
      passRateMean: passRateStats.mean,
      passRateMin: passRateStats.min,
      passRateMax: passRateStats.max
    },
    correctness: stats(runs.map((run) => run.correctness)),
    scoring: {
      tests: countComponents(runs.map((run) => run.scoring.tests)),
      judge: countComponents(runs.map((run) => run.scoring.judge))
    },
    integrity: {
      cheatViolations: total(runs.map((run) => run.cheatReport.violations.length)),
      uninspectableActions: total(runs.map((run) => run.cheatReport.uninspectable?.length ?? 0)),
      tracesAvailable: runs.filter((run) => run.trace?.available === true).length,
      executionErrors: runs.filter((run) => run.error !== undefined).length
    }
  };

  const metrics = aggregateMetrics(runs);
  if (metrics !== undefined) {
    aggregate.metrics = metrics;
  }

  if (runs.every((run) => run.judge?.mean !== undefined)) {
    aggregate.judge = {
      mean: stats(runs.map((run) => run.judge?.mean as number))
    };
  }

  return aggregate;
}

export function compareResultCollections(
  baselineRuns: readonly EvalRunResult[],
  currentRuns: readonly EvalRunResult[]
): ResultComparison[] {
  const baseline = groupRuns(baselineRuns);
  const current = groupRuns(currentRuns);
  const comparisons: ResultComparison[] = [];

  for (const [key, currentCellRuns] of current) {
    const baselineCellRuns = baseline.get(key);
    if (baselineCellRuns === undefined) {
      continue;
    }
    const baselineCell = aggregateRuns(baselineCellRuns);
    const currentCell = aggregateRuns(currentCellRuns);
    const deltas = compareCells(baselineCell, currentCell, baselineCellRuns, currentCellRuns);
    comparisons.push({
      cell: currentCell.cell,
      deltas,
      regressions: deltas.filter((delta) => delta.regression).length
    });
  }

  return comparisons;
}

function countVerdicts(runs: readonly EvalRunResult[]): Record<Verdict, number> {
  return Object.fromEntries(
    verdicts.map((verdict) => [verdict, runs.filter((run) => run.verdict === verdict).length])
  ) as Record<Verdict, number>;
}

function countComponents(components: readonly ScoringComponentResult[]): ScoringComponentCounts {
  return {
    configured: components.filter((component) => component.configured).length,
    executed: components.filter((component) => component.status === "executed").length,
    skipped: components.filter((component) => component.status === "skipped").length,
    failed: components.filter((component) => component.status === "failed").length,
    disabled: components.filter((component) => component.status === "disabled").length
  };
}

function aggregateMetrics(
  runs: readonly EvalRunResult[]
): NonNullable<AggregatedCell["metrics"]> | undefined {
  const metrics = runs.flatMap((run) => run.metrics ?? []);
  if (metrics.length === 0) {
    return undefined;
  }
  const byId = new Map<string, MetricResult[]>();
  for (const metric of metrics) {
    const existing = byId.get(metric.id) ?? [];
    existing.push(metric);
    byId.set(metric.id, existing);
  }
  return Object.fromEntries(
    [...byId.entries()].map(([id, values]) => {
      const executed = values.filter((value) => value.status === "executed");
      return [
        id,
        {
          ...(executed.length === 0 ? {} : { score: stats(executed.map((value) => value.score)) }),
          passed: executed.filter((value) => value.passed).length,
          failed: executed.filter((value) => !value.passed).length,
          statuses: countComponents(values.map(metricAsComponent))
        }
      ];
    })
  );
}

function metricAsComponent(metric: MetricResult): ScoringComponentResult {
  return {
    configured: true,
    required: metric.required,
    configuredWeight: metric.weight,
    effectiveWeight: metric.weight,
    status: metric.status
  };
}

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function groupRuns(runs: readonly EvalRunResult[]): Map<string, EvalRunResult[]> {
  const grouped = new Map<string, EvalRunResult[]>();
  for (const run of runs) {
    const key = JSON.stringify(cellKeys.map((cellKey) => run[cellKey]));
    const cellRuns = grouped.get(key) ?? [];
    cellRuns.push(run);
    grouped.set(key, cellRuns);
  }
  return grouped;
}

function compareCells(
  baseline: AggregatedCell,
  current: AggregatedCell,
  baselineRuns: readonly EvalRunResult[],
  currentRuns: readonly EvalRunResult[]
): ResultComparisonDelta[] {
  const deltas: ResultComparisonDelta[] = [
    delta("oracle_correctness", baseline.correctness.mean, current.correctness.mean, "higher"),
    delta("duration_ms", baseline.durationMs.mean, current.durationMs.mean, "lower"),
    delta("tokens", totalTokens(baseline), totalTokens(current), "lower")
  ];
  if (hasRecordedCost(baselineRuns) && hasRecordedCost(currentRuns)) {
    deltas.push(
      delta("cost_usd", baseline.usage.costUsd.mean, current.usage.costUsd.mean, "lower")
    );
  }
  for (const [id, metric] of Object.entries(current.metrics ?? {})) {
    const baselineMetric = baseline.metrics?.[id];
    if (baselineMetric?.score !== undefined && metric.score !== undefined) {
      deltas.push(delta(`metric:${id}`, baselineMetric.score.mean, metric.score.mean, "higher"));
    }
  }
  return deltas;
}

function hasRecordedCost(runs: readonly EvalRunResult[]): boolean {
  return runs.every((run) => run.usage.costUsd !== undefined);
}

function totalTokens(cell: AggregatedCell): number {
  return cell.usage.inputTokens.mean + cell.usage.outputTokens.mean;
}

function delta(
  dimension: ResultComparisonDelta["dimension"],
  baseline: number,
  current: number,
  preferred: "higher" | "lower"
): ResultComparisonDelta {
  const difference = current - baseline;
  return {
    dimension,
    baseline,
    current,
    delta: difference,
    regression: preferred === "higher" ? difference < 0 : difference > 0
  };
}
