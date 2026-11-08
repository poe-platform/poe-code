import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const own = dirname(fileURLToPath(import.meta.url)), state = JSON.parse(readFileSync(JSON.parse(readFileSync('/tmp/owned-output-independent-current.json')).state)), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = join(state.work, 'mutants'); mkdirSync(root); const rows = [];
const definitions = [
  ['late-acquisition', 'A03', 'dist/contracts/output.js', 'released ??= admitted.then', 'released ??= (resource ? admitted : Promise.resolve()).then', 'close must await admitted acquisition'],
  ['untracked-child', 'G01', 'dist/contracts/output.js', 'createOutputOperation({ signal, registerCleanup }, destination)', 'createOutputOperation({ signal }, destination)', 'pendingOnRight'],
  ['bypass-accounting', 'B01', 'dist/contracts/output.js', 'capability ?? destination', 'destination', 'legacyWrites'],
  ['late-write', 'A06', 'dist/contracts/output.js', 'async write(chunk) {\n                assertOpen();', 'async write(chunk) {', 'lateWrites'],
  ['falsy-rejection', 'E02', 'dist/shell/shell.js', 'if (failed)\n            throw failure;', 'if (failed && failure)\n            throw failure;', 'exactExecutionReasons'],
  ['redirect-zero', 'N04', 'dist/commands/network/curl.js', 'redirects++ >= args.maxRedirects', 'redirects++ >= Math.max(1, args.maxRedirects)', 'authorizationCalls'],
  ['credential-forward', 'N06', 'dist/commands/network/curl.js', 'credentialsInScope = false', 'credentialsInScope = true', 'crossOriginSecretHeaders'],
];
for (const [id, test, path, before, after, failure] of definitions) {
  const consumer = join(root, id); cpSync(state.consumer, consumer, { recursive: true });
  for (const name of ['core-cases.mjs', 'network-cases.mjs', 'run-case.mjs', 'audit-loader.mjs']) cpSync(join(own, name), join(consumer, name));
  const file = join(consumer, 'node_modules/virtual-bash', path), original = readFileSync(file, 'utf8'); assert.equal(original.split(before).length, 2, id + ' exact anchor');
  const run = (label, installed) => {
    const binding = join(consumer, label + '-state.json'); writeFileSync(binding, JSON.stringify({ ...state, consumer, installed }));
    const result = spawnSync(state.node, ['--experimental-loader', join(consumer, 'audit-loader.mjs'), join(consumer, 'run-case.mjs'), test], { cwd: consumer, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, REVIEW_STATE: binding, REVIEW_TRACE: join(consumer, label + '.trace') } });
    writeFileSync(join(consumer, label + '.stdout'), result.stdout ?? ''); writeFileSync(join(consumer, label + '.stderr'), result.stderr ?? ''); return result;
  };
  const baseline = run('baseline', state.installed); assert.equal(baseline.status, 0, id + ' baseline');
  const mutated = original.replace(before, after); writeFileSync(file, mutated); assert.equal(spawnSync(state.node, ['--check', file]).status, 0, 'mutant must parse');
  const result = run('mutated', { ...state.installed, [path]: hash(mutated) }); assert.equal(result.signal, null, id + ' must settle without supervisor kill'); assert.equal(result.status, 1, id + ' must fail'); assert(result.stdout.includes(failure), id + ' intended assertion');
  rows.push({ id, test, path, originalSHA256: hash(original), mutatedSHA256: hash(mutated), before, after, baseline: baseline.status, mutant: result.status, assertion: JSON.parse(result.stdout).error }); console.log(id, 'DETECTED');
}
writeFileSync(join(root, 'REPORT.json'), JSON.stringify({ candidate: state.candidate, packageSHA256: state.packageSHA256, rows }, null, 2)); console.log('MUTANTS', root);
