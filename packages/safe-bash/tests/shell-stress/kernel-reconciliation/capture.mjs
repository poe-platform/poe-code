import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { nativeCases, hostCases } from '../expanded-gaps/cases.mjs';
import { env } from '../expanded-gaps/harness.mjs';
import { runChild, environment } from '../current-shell/support.mjs';
import { owned, root, save, sha256, inventory, sourceStamp, localPath, alive } from './support.mjs';

const started = new Date().toISOString();
const initial = await sourceStamp();
assert.equal(initial.valid, true, 'Committed shell anchor must match before any run');
const frozen36 = JSON.parse(await readFile('tests/shell-stress/expanded-gaps/native-frozen.json'));
const frozen57 = JSON.parse(await readFile('tests/shell-stress/invocation-modes/native-corrected-evidence.json'));
const pinned = {
  'tests/shell-stress/expanded-gaps/cases.mjs': '11a4928d6cf4c64de20752e2b918bafa511789fabf048221dc841ed2638f52fd',
  'tests/shell-stress/expanded-gaps/native-frozen.json': '9afb51e0eed4f9fe1a61c52a146066edf11a6cc53408dd0b442186bbcd25a302',
  'tests/shell-stress/invocation-modes/cases.ts': 'fdc22c27541f4f29334274e35238c22fa4645730dbe5239134a585ee8e03f83c',
  'tests/shell-stress/invocation-modes/native-corrected-evidence.json': '86e6be4ec1ad22f3c5956ed0b37d8091653c4858fbf143f35b2e80eae4b67e45',
};
for (const [path, hash] of Object.entries(pinned)) assert.equal(sha256(await readFile(path)), hash, path);
const manifests = {};
const store = value => {
  const sorted = Object.fromEntries(Object.entries(value).sort());
  const digest = sha256(JSON.stringify(sorted));
  manifests[digest] = sorted;
  return digest;
};
const phases = [];
const scratch = await mkdtemp(resolve(tmpdir(), 'safe-bash-kernel-reconciliation-'));
const pids = new Set();
async function phase(id, args, options = {}) {
  const before = await inventory();
  const stampBefore = await sourceStamp();
  assert.equal(stampBefore.valid, true, 'Shell changed before phase');
  const trace = resolve(scratch, id + '.jsonl');
  const run = await runChild(process.execPath, ['--import', resolve('tests/shell-stress/expanded-gaps/acceptance-trace.mjs'), ...args], {
    env: { ...(options.native ? { ...environment, PATH: process.env.PATH } : options.env ?? environment), GAPS_ACCEPTANCE_TRACE: trace }, deadline: options.deadline ?? 12000,
  });
  const after = await inventory();
  const stampAfter = await sourceStamp();
  const loads = (await readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const loaded = Object.fromEntries(loads.map(row => [localPath(row.path), row.hash]));
  const byPid = {};
  for (const load of loads) {
    pids.add(load.pid);
    (byPid[load.pid] ??= {})[localPath(load.path)] = load.hash;
  }
  pids.add(run.pid);
  const mismatch = loads.filter(row => before[localPath(row.path)] !== row.hash || after[localPath(row.path)] !== row.hash);
  const drift = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
  const importedDrift = drift.filter(path => path in loaded);
  const fixedDrift = Object.keys(pinned).filter(path => after[path] !== pinned[path]);
  const valid = !run.timedOut && !run.overflow && !run.groupAlive && stampAfter.valid && mismatch.length === 0 && fixedDrift.length === 0 && (options.native || !!loaded['src/shell/runtime.ts']);
  const record = { id, run, before: store(before), after: store(after), loaded: store(loaded), byPid: Object.fromEntries(Object.entries(byPid).map(([pid, paths]) => [pid, store(paths)])), sourceBefore: stampBefore, sourceAfter: stampAfter, drift, importedDrift, mismatch, fixedDrift, valid };
  phases.push(record);
  console.log(`${id}: exit=${run.status} guard=${valid} imports=${Object.keys(loaded).filter(path => path.startsWith('src/')).length}`);
  return record;
}
const invocationTuple = row => ({ status: row.exitCode ?? row.result?.code, stdoutHex: row.stdoutHex ?? row.result?.stdoutHex, stderrHex: row.stderrHex ?? row.result?.stderrHex, effects: row.effects });
const summary = {};
const product36 = [];
const productHost = [];
let observations72 = [];
let comparison57 = [];
let nativeDrift36 = [];
let nativeDrift57 = [];
try {
  await phase('native36', ['--import', 'tsx', `${owned}/native36.mjs`], { native: true, deadline: 120000 });
  await phase('native57', ['--import', 'tsx', `${owned}/native57.ts`], { native: true, deadline: 120000 });
  const fresh36 = JSON.parse(await readFile(`${owned}/native36-current.json`));
  const fresh57 = JSON.parse(await readFile(`${owned}/native57-current.json`));
  nativeDrift36 = fresh36.profiles.map(profile => ({ role: profile.role, total: profile.rows.length, hashMatches: profile.hash === frozen36.profiles.find(old => old.role === profile.role).hash, drift: profile.rows.filter(row => !isDeepStrictEqual(row.tuple, frozen36.profiles.find(old => old.role === profile.role).rows.find(old => old.id === row.id).tuple)).map(row => row.id) }));
  nativeDrift57 = fresh57.profiles.map(profile => {
    const prior = frozen57.profiles.find(old => old.id === profile.id);
    return { role: profile.id, total: profile.rows.length, hashMatches: profile.interpreterHash === prior.interpreterHash, drift: profile.rows.filter(row => !isDeepStrictEqual(invocationTuple(row), invocationTuple(prior.rows.find(old => old.id === row.id)))).map(row => row.id), fixtureOrSourceDrift: profile.rows.filter(row => {
      const previous = prior.rows.find(old => old.id === row.id);
      return row.sourceHash !== previous.sourceHash || row.inputHex !== previous.inputHex || !isDeepStrictEqual(row.renderedFixtures, previous.renderedFixtures);
    }).map(row => row.id) };
  });
  for (const profile of fresh36.profiles) for (const row of [...profile.rows, ...profile.controls]) pids.add(row.run.pid);
  for (const profile of fresh57.profiles) { pids.add(profile.version.pid); for (const row of profile.rows) pids.add(row.result.pid); }
  for (const fixture of [...nativeCases, ...hostCases]) {
    const record = await phase(fixture.id, ['--import', 'tsx', 'tests/shell-stress/expanded-gaps/product.mjs', fixture.id], { env });
    let protocol;
    try { protocol = JSON.parse(Buffer.from(record.run.stdout, 'base64').toString()); } catch { protocol = { protocolError: true }; }
    const actual = protocol.observation;
    const row = { id: fixture.id, phase: record.id, valid: record.valid && record.run.status === 0, protocol, actual };
    if (fixture.kind) productHost.push({ ...row, passed: actual?.passed === true });
    else product36.push({ ...row, profiles: frozen36.profiles.map(profile => ({ role: profile.role, passed: isDeepStrictEqual(actual, profile.rows.find(old => old.id === fixture.id).tuple), freshPassed: isDeepStrictEqual(actual, fresh36.profiles.find(fresh => fresh.role === profile.role).rows.find(old => old.id === fixture.id).tuple) })) });
  }
  const holdout = await phase('corrected72', ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', 'tests/shell-stress/invocation-modes/holdout.test.ts'], { deadline: 120000 });
  const tap = Buffer.from(holdout.run.stdout, 'base64').toString();
  save('corrected72.tap', tap);
  for (const line of tap.split('\n')) {
    if (!line.startsWith('# {"id":')) continue;
    const hex = line.match(/"stdoutHex":"([a-f0-9]*)"/u)?.[1];
    assert.notEqual(hex, undefined, 'Retained child.stdoutHex protocol');
    observations72.push(JSON.parse(Buffer.from(hex, 'hex').toString()));
    const pid = line.match(/"pid":(\d+)/u)?.[1];
    if (pid) pids.add(Number(pid));
  }
  assert.equal(observations72.length, 72, 'Whole corrected72 observations retained');
  comparison57 = frozen57.profiles[0].rows.map(fixture => {
    const actual = observations72.find(row => row.id === fixture.id);
    assert.ok(actual, fixture.id);
    return { id: fixture.id, actual: invocationTuple(actual), profiles: frozen57.profiles.map(profile => ({ role: profile.id, expected: invocationTuple(profile.rows.find(row => row.id === fixture.id)), passed: isDeepStrictEqual(invocationTuple(actual), invocationTuple(profile.rows.find(row => row.id === fixture.id))), freshPassed: isDeepStrictEqual(invocationTuple(actual), invocationTuple(fresh57.profiles.find(fresh => fresh.id === profile.id).rows.find(row => row.id === fixture.id))) })) };
  });
  summary.native36 = nativeDrift36;
  summary.native57 = nativeDrift57;
  summary.product36 = frozen36.profiles.map(profile => ({ role: profile.role, total: product36.length, passed: product36.filter(row => row.profiles.find(item => item.role === profile.role).passed).length, invalid: product36.filter(row => !row.valid).length }));
  summary.host10 = { total: productHost.length, passed: productHost.filter(row => row.passed).length, invalid: productHost.filter(row => !row.valid).length };
  summary.corrected72 = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => [name, Number(tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN)]));
  summary.raw57 = frozen57.profiles.map(profile => ({ role: profile.id, total: comparison57.length, passed: comparison57.filter(row => row.profiles.find(item => item.role === profile.id).passed).length }));
} finally {
  await rm(scratch, { recursive: true, force: true });
  const final = await sourceStamp();
  const children = [...pids].filter(Boolean).sort((left, right) => left - right).map(pid => ({ pid, groupAlive: alive(pid) }));
  save('baseline-recovered.json', { started, finished: new Date().toISOString(), initial, final, pinned, manifests, phases, nativeDrift36, nativeDrift57, product36, productHost, observations72, comparison57, summary, children });
  console.log(JSON.stringify({ summary, guards: phases.filter(row => row.valid).length, phases: phases.length, alive: children.filter(row => row.groupAlive) }, null, 2));
}
