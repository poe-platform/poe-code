export type NpmRunner = (scriptName: string) => Promise<string>;

export function makeMetricModule(npmRunner: NpmRunner): {
  run(name: string): Promise<number>;
} {
  return {
    async run(name) {
      const metricName = readNonEmptyString(name, "Metric name");
      const scriptName = `metric:${metricName}`;
      const stdout = await npmRunner(scriptName);
      const score = parseMetricScore(stdout, scriptName);

      return score;
    }
  };
}

function parseMetricScore(stdout: unknown, scriptName: string): number {
  if (typeof stdout !== "string") {
    throw new Error(`Metric runner for "${scriptName}" must resolve to a stdout string.`);
  }

  const scoreLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);

  if (scoreLine === undefined) {
    throw new Error(`Metric script "${scriptName}" must print a numeric score.`);
  }

  const score = Number(scoreLine);

  if (!Number.isFinite(score)) {
    throw new Error(`Metric script "${scriptName}" must print a numeric score.`);
  }

  return score;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}
