import { runPreflight, formatPreflightResults, hasCriticalFailure } from '@poe-code/e2e-docker-test-runner';

export async function setup(): Promise<void> {
  const { passed, results } = await runPreflight();
  console.error(formatPreflightResults(results));

  if (!passed) {
    if (hasCriticalFailure(results)) {
      throw new Error('Preflight checks failed');
    }
    console.error('\nSkipping e2e tests: non-critical preflight checks failed.\n');
    process.exit(0);
  }
}
