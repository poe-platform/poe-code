import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runChild, environment } from '../current-shell/support.mjs';
import { save, sha256, inventory, sourceStamp, alive } from './acceptance-support.mjs';

const current = JSON.parse(await readFile('tests/shell-stress/kernel-reconciliation/acceptance-f1bb98b.json'));
assert.equal(current.phases.length, 49);
assert.ok(current.phases.every(phase => phase.valid), 'Do not proceed after an invalid source/import capture');
const manifests = {};
const store = value => {
  const sorted = Object.fromEntries(Object.entries(value).sort());
  const digest = sha256(JSON.stringify(sorted));
  manifests[digest] = sorted;
  return digest;
};
const scratch = await mkdtemp(resolve(tmpdir(), 'safe-bash-kernel-compiler-'));
const phases = [];
const pids = new Set();
const snapshot = async paths => Object.fromEntries(await Promise.all([...new Set(paths)].sort().map(async path => [path, await readFile(path).then(sha256).catch(() => null)])));
const pathsFrom = run => Buffer.from(run.stdout, 'base64').toString().split('\n').filter(path => path.startsWith('/') && /\.[cm]?tsx?$/.test(path));
try {
  for (const [id, config] of [['global', 'tsconfig.json'], ['build', 'tsconfig.build.json'], ['benchmark', 'benchmarks/tsconfig.json']]) {
    const started = new Date().toISOString();
    const sourceBefore = await sourceStamp();
    assert.equal(sourceBefore.valid, true);
    const inventoryBefore = await inventory();
    const args = ['node_modules/typescript/bin/tsc', '-p', config, '--noEmit'];
    const enumeration = await runChild(process.execPath, [...args, '--listFilesOnly'], { env: environment, deadline: 60000 });
    pids.add(enumeration.pid);
    const listed = pathsFrom(enumeration);
    const files = [...listed, 'tsconfig.json', 'tsconfig.build.json', 'benchmarks/tsconfig.json', 'package.json', 'node_modules/typescript/package.json', 'node_modules/typescript/lib/_tsc.js'];
    const before = await snapshot(files);
    const trace = resolve(scratch, id + '.jsonl');
    const run = await runChild(process.execPath, ['--import', resolve('tests/shell-stress/expanded-gaps/acceptance-trace.mjs'), ...args, '--listFiles'], { env: { ...environment, GAPS_ACCEPTANCE_TRACE: trace }, deadline: 90000 });
    pids.add(run.pid);
    const actual = pathsFrom(run);
    const after = await snapshot([...files, ...actual]);
    const inventoryAfter = await inventory();
    const sourceAfter = await sourceStamp();
    const loads = (await readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const drift = [...new Set([...Object.keys(inventoryBefore), ...Object.keys(inventoryAfter)])].filter(path => inventoryBefore[path] !== inventoryAfter[path]);
    const fixedDrift = files.filter(path => before[path] !== after[path]);
    const unlisted = actual.filter(path => !listed.includes(path));
    const missing = listed.filter(path => !actual.includes(path));
    const text = Buffer.from(run.stdout, 'base64').toString();
    const diagnostics = text.split('\n').filter(line => line && !actual.includes(line));
    const valid = sourceAfter.valid && enumeration.status === 0 && !enumeration.timedOut && !enumeration.overflow && !run.timedOut && !run.overflow && !run.groupAlive && fixedDrift.length === 0 && unlisted.length === 0 && missing.length === 0;
    phases.push({ id, config, argv: [process.execPath, ...args, '--listFiles'], started, finished: new Date().toISOString(), sourceBefore, sourceAfter, enumeration, run, before: store(before), after: store(after), inventoryBefore: store(inventoryBefore), inventoryAfter: store(inventoryAfter), listedCount: listed.length, actualCount: actual.length, fixedDrift, unlisted, missing, inventoryDrift: drift, actualRuntimeImports: loads, diagnostics, valid });
    console.log(JSON.stringify({ id, status: run.status, inputs: actual.length, diagnostics, fixedDrift, unlisted, missing, inventoryDrift: drift, valid }));
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
  save('acceptance-compilers-f1bb98b.json', { manifests, phases, children: [...pids].filter(Boolean).map(pid => ({ pid, groupAlive: alive(pid) })), interpretation: 'tsc lists compiler-read inputs; no runtime product module is executed by TypeScript. Listed exact input sets are hashed before/after, configs pinned, source anchor checked. These are noEmit phases, not emitting builds or full test-suite runs.' });
}
