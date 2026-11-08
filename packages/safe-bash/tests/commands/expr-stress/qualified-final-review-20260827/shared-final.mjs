import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { owned, work, inventory, save, command } from './prepare.mjs';
const source = join(work, 'shared-qualified');
const before = inventory(source);
const { paths } = JSON.parse(readFileSync(join(owned, 'shared-qualified-summary.json')));
const scratch = mkdtempSync(join(tmpdir(), 'expr-qualified-final-review-20260827-native-final-'));
try {
  const result = command('shared-legacy276-final', process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...paths.filter(path => path.endsWith('.test.ts'))], { cwd: source, env: { ...process.env, TMPDIR: scratch, TSX_DISABLE_CACHE: '1' } });
  assert.deepEqual(inventory(source), before);
  assert.deepEqual(readdirSync(scratch), []);
  save('shared-final-summary.json', { status: result.status, counts: Object.fromEntries([...result.stdout.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])])), scratch, fixtureRootsRemoved: true, sourceAddedEntryPostcheck: true, qualification: 'Exact same candidate eleven-file tests, no assertions/inputs changed. Native scratch outside repository restores original rg fixture profile. TSX_DISABLE_CACHE=1 changes development-tool caching only so empty scratch postcondition can be checked; previous 276/276 plus wrapper cache assertion failure retained.' });
  console.log(result.stdout.slice(-250));
} finally { rmSync(scratch, { recursive: true }); save('shared-final-temp-cleanup.json', { scratch, removed: !existsSync(scratch) }); }
