import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreflight, formatPreflightResults } from '@poe-code/e2e-docker-test-runner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { passed, results } = await runPreflight({
  prebuildWorkspaceDir: path.resolve(__dirname, '..'),
  verbose: process.env.E2E_VERBOSE === '1',
});
console.error(formatPreflightResults(results));

if (!passed) {
  throw new Error('Preflight checks failed');
}
