import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { artifact, directory, root, digest, sourceSnapshot, bytesResult } from './common.mjs';
import { loadFrozen } from './evidence.mjs';
import { compare } from './harness.mjs';

const { values } = parseArgs({ options: {
  check: { type: 'boolean' }, worker: { type: 'boolean' }, advisory: { type: 'boolean' }, 'post-handoff': { type: 'boolean' },
  entry: { type: 'string' }, report: { type: 'string' }, 'structured-sha256': { type: 'string' }, 'product-sha256': { type: 'string' },
} });
const evidence = loadFrozen();
if (values.check) {
  assert.ok(!values.advisory && !values['post-handoff'] && !values.worker);
  console.log(JSON.stringify({ phase: 'PREP integrity only; no virtual import/execution', manifestSha256: evidence.manifestSha256,
    counts: evidence.counts, historicalFiles: Object.keys(evidence.manifest.historicalFiles).length }, null, 2));
} else {
  assert.notEqual(Boolean(values.advisory), Boolean(values['post-handoff']), 'choose --advisory or --post-handoff');
  assert.match(values.report ?? '', /^[a-z0-9][a-z0-9-]*$/u, 'unique report basename required');
  assert.equal(existsSync(join(directory, `${values.report}.json`)), false, 'never overwrite report');
  const entry = resolve(root, values.entry ?? 'src/index.ts');
  assert.ok(entry.startsWith(`${root}/`), 'entry must stay in repository');
  if (values['post-handoff']) {
    assert.match(values['structured-sha256'] ?? '', /^[a-f0-9]{64}$/u);
    assert.match(values['product-sha256'] ?? '', /^[a-f0-9]{64}$/u);
    assert.ok(values.entry && entry.endsWith('.js'), 'post-handoff requires explicit compiled public entry');
  }
  if (!values.worker) {
    const command = [process.execPath, '--unhandled-rejections=strict', '--import', 'tsx', ...process.argv.slice(1), '--worker'];
    const startedAt = new Date().toISOString();
    const result = spawnSync(command[0], command.slice(1), { cwd: root, env: process.env, shell: false, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || result.signal || !existsSync(join(directory, `${values.report}.json`))) {
      artifact(`${values.report}-watchdog.json`, { startedAt, endedAt: new Date().toISOString(), command, watchdogMs: 180000,
        status: result.status, signal: result.signal, error: result.error?.message, stderrHex: result.stderr?.toString('hex'),
        validity: 'INVALID: worker did not produce a complete report; no partial pass credit' });
    }
    process.exitCode = result.error || result.signal ? 2 : result.status ?? 2;
  } else {
    function entrySnapshot() {
      const files = {};
      function walk(path) {
        for (const child of readdirSync(path, { withFileTypes: true })) {
          const full = join(path, child.name);
          if (child.isDirectory()) walk(full);
          else if (child.isFile()) files[relative(root, full)] = digest(readFileSync(full));
          else throw new Error(`nonregular entry dependency: ${full}`);
        }
      }
      walk(dirname(entry));
      return { path: relative(root, entry), files, sha256: digest(Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([path, hash]) => `${path}\0${hash}\n`).join('')) };
    }
    const startedAt = new Date().toISOString();
    const before = sourceSnapshot();
    if (values['structured-sha256']) assert.equal(before.structuredSha256, values['structured-sha256']);
    if (values['product-sha256']) assert.equal(before.productSha256, values['product-sha256']);
    const entryBefore = entrySnapshot();
    const api = await import(pathToFileURL(entry).href);
    const { createExecutor } = await import('./harness.mjs');
    const execute = await createExecutor(api);
    const historicalExecute = entry === resolve(root, 'src/index.ts')
      ? await (await import('../jq-42-independent-review/harness.ts')).loadPublicHarness()
      : execute;
    const boundaries = [{ phase: 'after-public-import', source: sourceSnapshot(), entry: entrySnapshot().sha256 }];
    const results = [];
    for (const [cohortName, vectors] of Object.entries(evidence.cohorts)) {
      for (const vector of vectors) for (const route of ['direct', 'shell']) for (const transport of vector.schedules) {
        const row = { cohort: cohortName, historicalCohort: vector.cohort, id: vector.id, route, transport, expected: bytesResult(vector.expected),
          original42: evidence.main.original.has(`${vector.cohort}:${vector.id}`) };
        try {
          const observed = await (cohortName === 'main' ? historicalExecute : execute)(vector, route, transport);
          results.push({ ...row, ...observed, ...compare(vector, route, observed) });
        } catch (error) {
          results.push({ ...row, pass: false, error: error?.stack ?? String(error) });
        }
      }
      boundaries.push({ phase: `after-${cohortName}`, source: sourceSnapshot(), entry: entrySnapshot().sha256 });
    }
    const after = sourceSnapshot();
    const entryAfter = entrySnapshot();
    const stable = [after, ...boundaries.map(item => item.source)].every(snapshot => snapshot.productSha256 === before.productSha256 && JSON.stringify(snapshot.tooling) === JSON.stringify(before.tooling))
      && [entryAfter.sha256, ...boundaries.map(item => item.entry)].every(hash => hash === entryBefore.sha256);
    let immutableAfter = true;
    let immutableError;
    try { loadFrozen(); } catch (error) { immutableAfter = false; immutableError = error.message; }
    const summarize = rows => {
      const ids = new Set(rows.map(row => `${row.cohort}:${row.id}`));
      const failedIds = new Set(rows.filter(row => !row.pass).map(row => `${row.cohort}:${row.id}`));
      return { vectors: ids.size, vectorsPassingAll: ids.size - failedIds.size, executions: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length };
    };
    const summary = Object.fromEntries(Object.keys(evidence.cohorts).map(name => [name, summarize(results.filter(row => row.cohort === name))]));
    summary.original42IncludedInMain = summarize(results.filter(row => row.original42));
    const legacyClassification = Object.fromEntries(['exact', 'diagnosticOnly', 'statusOrStdout', 'harnessError'].map(category => [category, []]));
    for (const vector of evidence.cohorts.legacy) {
      const rows = results.filter(row => row.cohort === 'legacy' && row.id === vector.id);
      const category = rows.every(row => row.pass) ? 'exact' : rows.some(row => row.error) ? 'harnessError'
        : rows.every(row => row.differingFields.every(field => field === 'stderrHex')) ? 'diagnosticOnly' : 'statusOrStdout';
      legacyClassification[category].push(vector.id);
    }
    const report = { phase: values.advisory ? 'MOVING-SOURCE ADVISORY ONLY; NOT FINAL' : 'post-handoff compiled blackbox observation; independent reviewer adjudicates',
      startedAt, endedAt: new Date().toISOString(), manifestSha256: evidence.manifestSha256, before, after, entryBefore, entryAfter, boundaries,
      stable, immutableAfter, immutableError, summary, legacyClassification, results,
      limits: 'No skips, stderr normalization, rebaseline or source fixes. Hash equality cannot exclude ABA edits. Compiled tree hashes do not prove build provenance; reviewer must independently inspect build log and source correspondence. Historical canonical 22 are inventoried, not rewritten or approved. Host sink/binary/budget gates remain separate and must be rerun unchanged.' };
    artifact(`${values.report}.json`, report);
    console.log(JSON.stringify({ phase: report.phase, stable, immutableAfter, summary, legacyClassification: Object.fromEntries(Object.entries(legacyClassification).map(([name, ids]) => [name, ids.length])) }, null, 2));
    process.exitCode = !stable || !immutableAfter ? 2 : results.some(row => !row.pass) ? 1 : 0;
  }
}
