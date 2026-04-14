import { runPreflight, formatPreflightResults } from '@poe-code/e2e-test-runner';


export async function setup(): Promise<void> {
  const { passed, results, environment } = await runPreflight();
  console.error(formatPreflightResults(results, environment));

  if (!passed) {
    throw new Error('Preflight checks failed');
  }
}
