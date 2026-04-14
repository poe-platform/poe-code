import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreflight, formatPreflightResults } from '@poe-code/e2e-test-runner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function setup(): Promise<void> {
  const { passed, results } = await runPreflight({
    prebuildWorkspaceDir: path.resolve(__dirname, '..'),
  });
  console.error(formatPreflightResults(results));

  if (!passed) {
    throw new Error('Preflight checks failed');
  }
}
