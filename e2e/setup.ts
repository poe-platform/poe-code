import { formatPreflightResults, runPreflight } from "../packages/e2e-test-runner/src/preflight.js";

export async function setup(): Promise<void> {
  const { passed, results, environment } = await runPreflight();
  console.error(formatPreflightResults(results, environment));

  if (!passed) {
    throw new Error("Preflight checks failed");
  }
}
