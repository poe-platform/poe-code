import type { EvalResult, ExecFn, ExperimentCallbackResult, MetricDef } from "../types.js";

interface MetricExecutionResult {
  exitCode: number;
  result: EvalResult;
}

function parseScore(stdout: string): number | null {
  const scoreLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!scoreLine) {
    return null;
  }

  const score = Number(scoreLine);

  return Number.isFinite(score) ? score : null;
}

const DEFAULT_METRIC_TIMEOUT_MS = 180_000;

async function runMetric(
  script: string,
  cwd: string,
  exec: ExecFn,
  timeoutMs?: number
): Promise<MetricExecutionResult> {
  const timeout = timeoutMs ?? DEFAULT_METRIC_TIMEOUT_MS;
  const { stdout, stderr, exitCode } = await exec(script, {
    cwd,
    timeout
  });
  const score = parseScore(stdout);
  const timedOut = exitCode !== 0 && score === null && stdout.length === 0 && stderr.length === 0;
  const timeoutHint = timedOut
    ? `\nMetric timed out after ${timeout / 1000}s. Increase timeout via metric_timeout in experiment frontmatter.`
    : "";

  return {
    exitCode,
    result: {
      score,
      passed: exitCode === 0 && score !== null,
      output: `${stdout}${stderr}${timeoutHint}`
    }
  };
}

export async function evaluate(
  script: string,
  cwd: string,
  exec: ExecFn,
  timeoutMs?: number
): Promise<EvalResult> {
  const { result } = await runMetric(script, cwd, exec, timeoutMs);

  return result;
}

export async function evaluateChain(
  metrics: MetricDef[],
  cwd: string,
  exec: ExecFn,
  onMetricResult?: (metric: MetricDef, result: EvalResult) => ExperimentCallbackResult,
  timeoutMs?: number
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const metric of metrics) {
    const { exitCode, result } = await runMetric(metric.script, cwd, exec, timeoutMs);
    results.push(result);
    await onMetricResult?.(metric, result);

    if (exitCode !== 0) {
      break;
    }
  }

  return results;
}
