import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const own = dirname(fileURLToPath(import.meta.url)), location = JSON.parse(readFileSync('/tmp/owned-output-independent-current.json'));
const state = JSON.parse(readFileSync(location.state)), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = join(state.work, 'execution-' + Date.now()); mkdirSync(output);
for (const name of ['core-cases.mjs', 'run-case.mjs', 'audit-loader.mjs', ...(readdirSync(own).includes('network-cases.mjs') ? ['network-cases.mjs'] : [])]) cpSync(join(own, name), join(state.consumer, name));
const all = JSON.parse(readFileSync(join(state.consumer, 'CASES.json'))).cases;
assert.equal(hash(readFileSync(join(state.consumer, 'CASES.json'))), state.frozenCasesSHA256);
const selected = process.argv.slice(2), rows = [];
for (const fixture of all.filter(row => !selected.length || selected.includes(row.id))) {
  const trace = join(output, fixture.id + '.trace');
  const result = spawnSync(state.node, ['--experimental-loader', join(state.consumer, 'audit-loader.mjs'), join(state.consumer, 'run-case.mjs'), fixture.id], { cwd: state.consumer, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, REVIEW_STATE: location.state, REVIEW_TRACE: trace } });
  writeFileSync(join(output, fixture.id + '.stdout'), result.stdout ?? ''); writeFileSync(join(output, fixture.id + '.stderr'), result.stderr ?? '');
  let observation; try { observation = JSON.parse(result.stdout); } catch {}
  const row = { id: fixture.id, exitCode: result.status, signal: result.signal, error: result.error?.message, result: observation }; rows.push(row); console.log(fixture.id, result.status, observation?.error?.split('\n')[0] ?? result.stderr?.slice(-120));
}
function inventory(directory) { return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  if (entry.isDirectory()) { const children = inventory(join(directory, entry.name)); assert(Object.keys(children).length > 0, 'unexpected empty protected directory'); return Object.entries(children).map(([name, digest]) => [entry.name + '/' + name, digest]); }
  assert(entry.isFile(), 'unexpected protected symlink or special entry'); return [[entry.name, hash(readFileSync(join(directory, entry.name)))]];
})); }
assert.deepEqual(inventory(join(state.consumer, 'node_modules/virtual-bash')), state.installed);
for (const [path, digest] of Object.entries(state.inputs)) assert.equal(hash(readFileSync(join(state.product, path))), digest, path);
for (const prefix of ['src/', 'scripts/']) assert.deepEqual(inventory(join(state.product, prefix)), Object.fromEntries(Object.entries(state.inputs).filter(([path]) => path.startsWith(prefix)).map(([path, digest]) => [path.slice(prefix.length), digest])));
writeFileSync(join(output, 'REPORT.json'), JSON.stringify({ candidate: state.candidate, packageSHA256: state.packageSHA256, frozenCasesSHA256: state.frozenCasesSHA256, packageUnchanged: true, sourceUnchanged: true, rows }, null, 2) + '\n');
console.log('REPORT', output); if (rows.some(row => row.exitCode !== 0)) process.exitCode = 1;
