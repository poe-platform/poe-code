import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { cases as nulCases, names } from './nul-cases.mjs';
import { owned, root, primary, env, save, sha256, inventory, runChild } from './support.mjs';
const sourceCommit = 'f7000b05b15fa34371226b35cf537d3f73bbf004';
const oldPath = 'benchmarks/shell-stress/diagnostic-profiles/native-baseline.json';
const oldBytes = await readFile(oldPath); const old = JSON.parse(oldBytes.toString());
const anchors = Object.fromEntries(Object.keys(await inventory()).filter(path => path.startsWith('src/shell/')).map(path => [path, sha256(execFileSync('git', ['show', `${sourceCommit}:${path}`]))]));
async function checkAnchors() { for (const [path, hash] of Object.entries(anchors)) assert.equal(sha256(await readFile(path)), hash, `Committed shell changed: ${path}`); }
await checkAnchors();
const frozenInputs = { [oldPath]: sha256(oldBytes) };
for (const path of ['tests/shell-stress/cases.ts', 'tests/shell-stress/helpers.ts', 'tests/shell-stress/differential.test.ts', 'tests/shell-stress/current-gaps/cases.ts', 'tests/shell-stress/current-gaps/reference.ts', 'tests/shell-stress/current-gaps/compatibility.test.ts', 'tests/shell-stress/diagnostic-profiles/profile.ts', 'tests/shell-stress/diagnostic-profiles/compatibility.test.ts', 'tests/shell/diagnostic-limits.json']) frozenInputs[path] = sha256(await readFile(path));
const profiles = [old.profiles.find(profile => profile.name === 'primary-5.3'), old.profiles.find(profile => profile.name === 'historical-3.2')];
for (const profile of profiles) assert.equal(sha256(await readFile(profile.executable)), profile.sha256);
const oldNine = ['move-output-really-closes-source', 'move-input-really-closes-source', 'prevalidation-prior-output-and-file', 'fatal-parameter-preserves-only-earlier-effects', 'nested-substitution-syntax-error-does-not-prevent-earlier-effects', 'fatal-parameter-expansion-prevents-following-file-effect', 'fatal-arithmetic-expansion-prevents-following-file-effect', 'fatal-expansion-in-substitution-stops-substitution-only', 'command-substitution-removes-nul-bytes'];
save('frozen-cases.json', { sourceCommit, anchors, frozenInputs, profiles, oldNine, original88: old.captures[0].rows.map(({ cohort, fixture }) => ({ cohort, fixture })), nulCases, names, nulHash: sha256(await readFile(resolve(owned, 'nul-cases.mjs'))), rules: 'All original bytes/fixtures/assertions unchanged. Historical original helper unchanged; modern original-helper launch globally replaces /bin/bash executable only. -c source name shell-stress unchanged. Profile cohort uses shell. No output, diagnostic, effect, order or path normalization. NUL names each apply to both WHOLE eight-case profiles. First-read custom tests/resources runner NOT executed.' });
const temporary = await mkdtemp(resolve(tmpdir(), 'safe-bash-diagnostic-recheck-'));
const manifests = {}; const records = []; const pids = new Set(); const started = new Date().toISOString();
const store = values => { const sorted = Object.fromEntries(Object.entries(values).sort()); const hash = sha256(JSON.stringify(sorted)); manifests[hash] = sorted; return hash; };
function observations(processes) {
  const recentNative = new Map(); const rows = [];
  for (const child of processes) {
    if (profiles.some(profile => profile.executable === child.executable) && child.args.includes('-c')) recentNative.set(child.parent, child);
    if (child.executable !== process.execPath || !child.stdin) continue;
    let request; try { request = JSON.parse(Buffer.from(child.stdin, 'base64').toString()); } catch { continue; }
    if (request.kind !== 'script') continue;
    const native = recentNative.get(child.parent); assert.ok(native, request.fixture.name);
    assert.equal(native.args[native.args.indexOf('-c') + 1], request.fixture.script);
    const actual = JSON.parse(Buffer.from(child.stdout, 'base64').toString());
    const expected = { stdout: Buffer.from(native.stdout, 'base64').toString(), stderr: Buffer.from(native.stderr, 'base64').toString(), stdoutBase64: native.stdout, stderrBase64: native.stderr, exitCode: native.status, files: native.files };
    const profile = profiles.find(profile => profile.executable === native.executable); const sourceName = native.args[native.args.indexOf('-c') + 2];
    const prior = old.captures.find(capture => capture.profile === profile.name && capture.argv0 === sourceName && capture.repetition === 1).rows.find(row => isDeepStrictEqual(row.fixture, request.fixture));
    assert.ok(prior, request.fixture.name);
    rows.push({ fixture: request.fixture, nativePid: native.pid, virtualPid: child.pid, profile: profile.name, sourceName, native: expected, actual, exact: isDeepStrictEqual(expected, actual), nativeFrozenEqual: isDeepStrictEqual(expected, prior.observation), oldNine: oldNine.includes(request.fixture.name) });
  }
  assert.equal(rows.length, 88); return rows;
}
try {
  const testArgs = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1'];
  for (const [label, profileName, override, files] of [
    ['original-historical', 'historical-3.2', undefined, ['tests/shell-stress/differential.test.ts', 'tests/shell-stress/current-gaps/compatibility.test.ts']],
    ['original-primary', 'primary-5.3', primary, ['tests/shell-stress/differential.test.ts', 'tests/shell-stress/current-gaps/compatibility.test.ts']],
    ['profile-primary', 'primary-5.3', undefined, ['tests/shell-stress/diagnostic-profiles/compatibility.test.ts']],
    ['profile-historical', 'historical-3.2', undefined, ['tests/shell-stress/diagnostic-profiles/compatibility.test.ts']],
  ]) {
    await checkAnchors(); const before = await inventory(); const trace = resolve(temporary, label + '.jsonl');
    const childEnv = { ...env, DIAGNOSTIC_RECHECK_TRACE: trace, VIRTUAL_BASH_DIAGNOSTIC_PROFILE: profileName, ...(override ? { DIAGNOSTIC_NATIVE_OVERRIDE: override } : {}) };
    const args = ['--import', resolve(owned, 'trace.mjs'), ...testArgs, ...files];
    const run = await runChild(process.execPath, args, { env: childEnv, deadline: 120000 }); pids.add(run.pid);
    const after = await inventory(); const events = (await readFile(trace, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    const loads = events.filter(event => event.type === 'load'); const processes = events.filter(event => event.type === 'process');
    for (const event of events) if (event.pid) pids.add(event.pid);
    const loaded = Object.fromEntries(loads.map(row => [relative(root, row.path), row.hash]));
    const mismatches = loads.filter(row => before[relative(root, row.path)] !== row.hash || after[relative(root, row.path)] !== row.hash);
    const sourceDrift = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => path.startsWith('src/') && before[path] !== after[path]);
    const byPid = {};
    for (const load of loads) (byPid[load.pid] ??= {})[relative(root, load.path)] = load.hash;
    const rows = observations(processes); const text = Buffer.from(run.stdout, 'base64').toString(); const counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
    const guarded = !mismatches.length && Object.keys(loaded).some(path => path === 'src/shell/runtime.ts') && !run.timedOut && !run.overflow && !run.groupAlive;
    records.push({ label, profileName, args, env: childEnv, run, counts, before: store(before), after: store(after), loaded: store(loaded), perPidLoads: Object.fromEntries(Object.entries(byPid).map(([pid, map]) => [pid, store(map)])), mismatches, sourceDrift, unimportedDrift: sourceDrift.filter(path => !loaded[path]), guarded, processes, rows });
    console.log(JSON.stringify({ label, counts, exact: rows.filter(row => row.exact).length, total: rows.length, nativeDrift: rows.filter(row => !row.nativeFrozenEqual).length, guarded, sourceDrift })); await checkAnchors();
  }
  save('original-baseline.json', { started, finished: new Date().toISOString(), sourceCommit, anchors, frozenInputs, manifests, records });
  const nulRows = []; const nativeCaptures = [];
  for (const profile of profiles) for (const name of names) for (const fixture of nulCases) {
    const directory = await mkdtemp(resolve(temporary, 'nul-native-')); const nativeEnv = { ...env, HOME: directory, TMPDIR: directory };
    try {
      const args = ['--noprofile', '--norc', '-c', fixture.script, name];
      const run = await runChild(profile.executable, args, { cwd: directory, env: nativeEnv, deadline: 2000 }); pids.add(run.pid);
      assert.deepEqual(await readdir(directory), []);
      nativeCaptures.push({ profile: profile.name, name, fixture: fixture.name, executable: profile.executable, argv0: profile.executable, args, env: nativeEnv, cwd: directory, run, files: {} });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  save('nul-native-frozen.json', { sourceCommit, profiles, casesHash: sha256(await readFile(resolve(owned, 'nul-cases.mjs'))), nativeCaptures });
  for (const name of names) for (const fixture of nulCases) {
    await checkAnchors(); const before = await inventory(); const trace = resolve(temporary, `nul-${name}-${fixture.name}.jsonl`);
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    const script = name === 'shell' ? fixture.script : `bash -c ${quote(fixture.script)} ${quote(name)}`;
    const request = { kind: 'script', fixture: { name: fixture.name, script } };
    const args = ['--import', resolve(owned, 'trace.mjs'), '--import', 'tsx', 'tests/shell-stress/virtual-child.ts'];
    const run = await runChild(process.execPath, args, { env: { ...env, DIAGNOSTIC_RECHECK_TRACE: trace }, stdin: JSON.stringify(request), deadline: 6000 }); pids.add(run.pid);
    const after = await inventory(); const events = (await readFile(trace, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)); const loads = events.filter(event => event.type === 'load');
    const loaded = Object.fromEntries(loads.map(row => [relative(root, row.path), row.hash])); const mismatches = loads.filter(row => before[relative(root, row.path)] !== row.hash || after[relative(root, row.path)] !== row.hash);
    const actual = JSON.parse(Buffer.from(run.stdout, 'base64').toString());
    const comparisons = nativeCaptures.filter(row => row.fixture === fixture.name && row.name === name).map(row => ({ profile: row.profile, exact: row.run.stdout === actual.stdoutBase64 && row.run.stderr === actual.stderrBase64 && row.run.status === actual.exitCode && isDeepStrictEqual(row.files, actual.files), warningLines: [...Buffer.from(row.run.stderr, 'base64').toString().matchAll(/line (\d+): warning:/gu)].map(match => Number(match[1])) }));
    nulRows.push({ fixture: fixture.name, name, request, args, run, actual, comparisons, warningLines: [...actual.stderr.matchAll(/line (\d+): warning:/gu)].map(match => Number(match[1])), before: store(before), after: store(after), loaded: store(loaded), mismatches, guarded: !!loaded['src/shell/runtime.ts'] && !mismatches.length && run.status === 0 && !run.timedOut && !run.overflow && !run.groupAlive });
  }
  const alive = []; for (const pid of pids) for (const target of [pid, -pid]) { try { process.kill(target, 0); alive.push(target); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  await checkAnchors(); for (const [path, hash] of Object.entries(frozenInputs)) assert.equal(sha256(await readFile(path)), hash, path);
  save('nul-baseline.json', { sourceCommit, anchors, manifests, rows: nulRows, checkedPids: pids.size, alive, sourceEnd: await inventory() });
  console.log(JSON.stringify({ nul: nulRows.map(row => ({ id: row.fixture, name: row.name, lines: row.warningLines, comparisons: row.comparisons, guarded: row.guarded })), checkedPids: pids.size, alive }));
} finally { await rm(temporary, { recursive: true, force: true }); }
