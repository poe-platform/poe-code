import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { base, git, hash, save } from './replay.mjs';

const gate = JSON.parse(readFileSync(`${base}/final-gate.json`, 'utf8'));
const directory = resolve(base, '.scratch/final-corrected');
const source = 'tests/commands/stream-next-stress/independent.review.ts';
const scoped = 'tests/commands/stream-next-stress/tsconfig.scoped.json';
execFileSync('/usr/bin/tar', ['-xf', '-', '-C', directory], { input: git('archive', gate.revision, source, scoped) });
const text = readFileSync(resolve(directory, source), 'utf8');
assert(text.includes('const expected: Actual ='));
const configs = ['tsconfig.json', scoped].map(path => {
  const absolute = resolve(directory, path);
  const configuration = ts.readConfigFile(absolute, ts.sys.readFile);
  assert.equal(configuration.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, resolve(absolute, '..'));
  assert(parsed.fileNames.includes(resolve(directory, source)), path);
  return { path, sha256: hash(readFileSync(absolute)), includesReviewerSource: true };
});
const args = [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '-p', resolve(directory, scoped)];
const result = spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 });
save(`${base}/final-ts7053-wiring.json`, { revision: gate.revision, priorFix: 'cf1d1f0a5eb3e63022132b3414dc6b8b9624b760', priorProof: '83124c351cf9d16e78fcf8706c39360d6fd20981', source, sourceSha256: hash(text), configs, args, status: result.status, stdout: result.stdout, stderr: result.stderr, signal: result.signal, error: result.error?.message, scope: 'Final existing type wiring and scoped noEmit only; no suite edits, runtime suite execution or root dist output' });
assert.equal(result.status, 0, result.stdout + result.stderr);
console.log('TS7053 wiring: included in root/scoped configuration, explicit Actual annotation, scoped noEmit passes');
