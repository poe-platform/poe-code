import type { EvalResult, ExecFn, MetricDef } from "../types.js";

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

  return Number.isNaN(score) ? null : score;
}

async function runMetric(metric: string, cwd: string, exec: ExecFn): Promise<MetricExecutionResult> {
  const { stdout, stderr, exitCode } = await exec(`npm run metric:${metric}`, { cwd });
  const score = parseScore(stdout);

  return {
    exitCode,
    result: {
      score,
      passed: exitCode === 0 && score !== null,
      output: `${stdout}${stderr}`
    }
  };
}

export async function evaluate(metric: string, cwd: string, exec: ExecFn): Promise<EvalResult> {
  const { result } = await runMetric(metric, cwd, exec);

  return result;
}

export async function evaluateChain(
  metrics: MetricDef[],
  cwd: string,
  exec: ExecFn
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const metric of metrics) {
    const { exitCode, result } = await runMetric(metric.name, cwd, exec);
    results.push(result);

    if (exitCode !== 0) {
      break;
    }
  }

  return results;
}
