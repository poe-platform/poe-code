import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { owned, work, inventory, save, command } from './prepare.mjs';
const source = join(work, 'shared-qualified');
const before = inventory(source);
const { paths } = JSON.parse(readFileSync(join(owned, 'shared-qualified-summary.json')));
const scratch = mkdtempSync(join(tmpdir(), 'expr-qualified-final-review-20260827-native-'));
try {
  const result = command('shared-legacy276-outside-git-rerun', process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...paths.filter(path => path.endsWith('.test.ts'))], { cwd: source, env: { ...process.env, TMPDIR: scratch } });
  assert.deepEqual(inventory(source), before);
  assert.deepEqual(readdirSync(scratch), []);
  save('shared-outside-git-summary.json', { status: result.status, counts: Object.fromEntries([...result.stdout.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])])), scratch, fixtureRootsRemoved: true, sourceAddedEntryPostcheck: true, qualification: 'Same committed eleven-file cohort and assertions. Previous 275/276 had native fixtures placed under the repository via TMPDIR, so rg discovered ancestor .git and changed default ignore policy. This separate explicit scratch binding restores outside-repository native fixture semantics, not a product or expectation fix.' });
  console.log(result.stdout.slice(-300));
} finally { rmSync(scratch, { recursive: true }); save('shared-native-temp-cleanup.json', { scratch, removed: !existsSync(scratch) }); }
