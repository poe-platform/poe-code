import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(join(owned, 'controls.test.ts'), 'utf8');
const needle = 'assert.deepEqual(current, approvedCompilerConfiguration());';
assert.equal(source.split(needle).length, 2);
const temporary = mkdtempSync(join(owned, '.scratch-assertion-mutant-'));
const output = resolve(process.argv[2]);
assert.equal(existsSync(output), false);
try {
  const mutant = source.replace(needle, 'assert.deepEqual(current, current);')
    .replace('from "./helpers.js"', 'from "../helpers.js"')
    .replace('new URL("../qualified-current-release/consumers.mjs"', 'new URL("../../qualified-current-release/consumers.mjs"');
  writeFileSync(join(temporary, 'controls.ts'), mutant);
  const environment = { ...process.env }; delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', join(temporary, 'controls.ts')], { cwd: owned, env: environment, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(output, JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'), mutation: 'only policy comparison becomes self-comparison; two relative imports relocated for scratch', status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }, null, 2) + '\n', { flag: 'wx' });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /not ok \d+ - compiler-policy mutations cannot add exclusions or weaken current-source coverage/u);
  assert.match(result.stdout, /Missing expected exception.*unknown exclusion/u);
  assert.match(result.stdout, /# fail 1\b/u);
  assert.match(result.stdout, /# pass 7\b/u);
  console.log('self-comparison mutant detected: 7 pass / 1 required failure');
} finally {
  rmSync(temporary, { recursive: true, force: true });
  assert.equal(existsSync(temporary), false);
}
