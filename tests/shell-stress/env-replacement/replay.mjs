import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { nativeCases, hostCases } from './cases.mjs';
import { owned, root, env, snapshot, save, sha256, runChild } from './harness.mjs';
const frozen = JSON.parse(await readFile(resolve(owned, 'native-frozen.json')));
assert.equal(sha256(await readFile(resolve(owned, 'cases.mjs'))), frozen.casesHash);
const manifests = {}; const rows = []; const directory = await mkdtemp(resolve(owned, '.replay-'));
const store = manifest => { const canonical = Object.fromEntries(Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right))); const hash = sha256(JSON.stringify(canonical)); manifests[hash] = canonical; return hash; };
const started = new Date().toISOString();
try {
  for (const fixture of [...nativeCases, ...hostCases]) {
    const before = await snapshot(); const trace = resolve(directory, `${fixture.id}.jsonl`);
    const run = await runChild(process.execPath, ['--import', 'tsx', resolve(owned, 'product.mjs'), fixture.id], { env: { ...env, CURRENT_SHELL_IMPORT_TRACE: trace }, deadline: 8000 });
    const after = await snapshot(); const loadedRows = (await readFile(trace, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    const loaded = Object.fromEntries(loadedRows.map(row => [relative(root, row.path), row.hash]));
    const mismatches = loadedRows.filter(row => before[relative(root, row.path)] !== row.hash || after[relative(root, row.path)] !== row.hash);
    let actual; try { actual = JSON.parse(Buffer.from(run.stdout, 'base64').toString()).observation; } catch { actual = { protocolError: true }; }
    const valid = run.status === 0 && !run.timedOut && !run.overflow && !run.groupAlive && !!loaded['src/shell/runtime.ts'] && mismatches.length === 0;
    const profiles = fixture.kind ? [] : frozen.profiles.map(profile => ({ role: profile.role, pass: isDeepStrictEqual(actual, profile.rows.find(row => row.id === fixture.id).tuple) }));
    const passed = valid && (fixture.kind ? actual.passed === true : profiles[0].pass);
    rows.push({ id: fixture.id, cohort: fixture.kind ? 'host' : 'native', passed, valid, profiles, before: store(before), after: store(after), loaded: store(loaded), mismatches, runtimeHash: loaded['src/shell/runtime.ts'], run, actual });
    console.log(`${passed ? 'PASS' : 'RED'} ${fixture.id}${valid ? '' : ' INVALID'}`);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
const report = { started, finished: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), freeze: '134b460', casesHash: frozen.casesHash, nativeHash: sha256(await readFile(resolve(owned, 'native-frozen.json'))), manifests, rows, summary: Object.fromEntries(['native', 'host'].map(cohort => [cohort, { total: rows.filter(row => row.cohort === cohort).length, passed: rows.filter(row => row.cohort === cohort && row.passed).length, invalid: rows.filter(row => row.cohort === cohort && !row.valid).length }])) };
save(process.argv[2] ?? 'pre-ready-red.json', report); console.log(JSON.stringify(report.summary));
if (rows.some(row => !row.passed)) process.exitCode = 1;
