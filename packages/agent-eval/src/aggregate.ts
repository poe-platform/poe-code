import type {
  AggregatedCell,
  EvalRunResult,
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
    tests: {
      passRateMean: passRateStats.mean,
      passRateMin: passRateStats.min,
      passRateMax: passRateStats.max
    },
    correctness: stats(runs.map((run) => run.correctness)),
    scoring: {
      tests: countComponents(runs.map((run) => run.scoring.tests)),
      judge: countComponents(runs.map((run) => run.scoring.judge))
    }
  };

  if (runs.every((run) => run.judge?.mean !== undefined)) {
    aggregate.judge = {
      mean: stats(runs.map((run) => run.judge?.mean as number))
    };
  }

  return aggregate;
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
