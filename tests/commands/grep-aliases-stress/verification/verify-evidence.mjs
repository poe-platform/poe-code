import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const prepared = dirname(root.replace(/\/$/, ''));
const output = process.argv[2];
assert.ok(output, 'A new isolated output directory is required');
mkdirSync(output, { recursive: false });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const load = path => JSON.parse(readFileSync(path, 'utf8'));
const report = { classification: 'static-evidence-integrity-not-candidate-tests', startedAt: new Date().toISOString(), checks: [], candidateRuns: 0, nativeReruns: 0, status: 'in-progress' };
const check = (name, action) => { action(); report.checks.push(name); };
function manifest(directory, relative = '') {
  return readdirSync(join(directory, relative)).sort().flatMap(name => {
    const path = join(relative, name); const metadata = lstatSync(join(directory, path));
    assert.equal(metadata.isSymbolicLink(), false, path);
    return metadata.isDirectory() ? manifest(directory, path) : [{ path, size: metadata.size, sha256: sha256(readFileSync(join(directory, path))) }];
  });
}
function sealed(directory, expected) {
  const text = readFileSync(join(directory, 'SHA256SUMS'), 'utf8'); assert.equal(sha256(text), expected);
  for (const line of text.trimEnd().split('\n')) { const [digest, path] = line.split('  '); assert.equal(sha256(readFileSync(join(directory, path))), digest, path); }
}
try {
  check('Original preparation payload and separate GNU pre-candidate seal unchanged', () => {
    sealed(prepared, '85589c8d87b556b77a174260d76250cba23d5516ecb7f6c4bf1f8b8e1967e61e');
    sealed(join(root, 'gnu'), '8663488dc2345294b82daa1ed48d72c262eff178da4b29d5dfaaed566370559b');
  });
  const corpus = load(join(prepared, 'data/corpus.json')); const native = load(join(root, 'gnu/captures.json')); const bsd = load(join(prepared, 'data/native-goldens.json'));
  check('Same 26 GNU inputs, two raw agreeing captures, exact file effects and retained warnings', () => {
    assert.equal(corpus.cases.length, 26); assert.equal(native.records.length, 26); assert.equal(native.nativeChildCount, 55); assert.deepEqual(native.stderrTransformations, []);
    for (const row of corpus.cases) {
      const captured = native.records.find(record => record.id === row.id); assert.ok(captured); assert.equal(captured.runs.length, 2);
      const fixture = corpus.fixtures[row.stdin]; const stdin = Buffer.from(fixture.hex ?? fixture.utf8, fixture.hex === undefined ? 'utf8' : 'hex').toString('hex');
      for (const run of captured.runs) { assert.equal(run.stdinHex, stdin); assert.deepEqual(run.args, row.args); assert.equal(run.signal, null); assert.equal(run.launchError, null); assert.deepEqual(run.filesAfterHex, captured.filesBeforeHex); assert.ok(Buffer.from(run.stderrHex, 'hex').toString().startsWith(`${row.command}: warning: ${row.command} is obsolescent;`)); }
      for (const field of ['stdoutHex', 'stderrHex', 'status']) assert.equal(captured.runs[0][field], captured.runs[1][field]);
    }
  });
  check('GNU executable/wrapper and primary archive pins still authenticated without execution', () => {
    for (const [name, digest] of Object.entries(native.pins)) assert.equal(sha256(readFileSync(join(native.nativeDirectory, name))), digest);
    assert.equal(sha256(readFileSync('/private/tmp/safe-bash-gnu-grep-3.12.MJXqupXn/download/grep-3.12.tar.xz')), native.archiveSha256);
  });
  const summary = load(join(root, 'summary.json')); const attempts = [];
  check('All seven original attempt receipts, harness snapshots, strict types and failures retained', () => {
    for (const item of summary.attempts) {
      const base = join(root, 'attempts', item.name); const receipt = load(join(base, 'receipt.json')); const result = load(join(base, 'results.json')); const comparison = load(join(base, 'comparison.json'));
      const input = receipt.inputs.find(entry => entry.source.endsWith('/holdouts.mts')); assert.ok(input);
      assert.equal(sha256(readFileSync(join(base, 'harness-source.txt'))), input.sha256);
      assert.equal(receipt.commands.find(command => command.name === 'strict-types').status, 0);
      assert.equal(receipt.commands.find(command => command.name === 'candidate-tests').status, 1);
      assert.equal(receipt.forcedCleanup, false); assert.equal(receipt.archiveAndProductUnchangedAfter, true);
      assert.equal(result.outcomes.length, item.subcases); assert.equal(result.outcomes.filter(row => row.status === 'pass').length, item.pass); assert.equal(result.outcomes.filter(row => row.status === 'fail').length, item.fail);
      for (const [name, original] of [['receipt.json', 'receipt.json'], ['results.json', 'results/results.json'], ['comparison.json', 'results/comparison.json'], ['harness-source.txt', 'holdouts.mts']]) assert.deepEqual(readFileSync(join(base, name)), readFileSync(join(receipt.attempt, original)), `${item.name}/${name}`);
      attempts.push({ item, receipt, result, comparison });
    }
    assert.equal(attempts.length, 7);
  });
  check('Each actual worker create has exactly one exit; no active workers, late unhandled errors or verifier terminations', () => {
    let created = 0; let exited = 0;
    for (const { result } of attempts) {
      const births = result.workerEvents.filter(event => event.event === 'create').map(event => event.threadId).sort((left, right) => left - right);
      const exits = result.workerEvents.filter(event => event.event === 'exit').map(event => event.threadId).sort((left, right) => left - right);
      assert.equal(new Set(births).size, births.length); assert.deepEqual(exits, births); assert.equal(result.activeWorkers, 0); assert.equal(result.lateErrorCount, 0); assert.equal(result.forcedWorkerTerminationByVerifier, 0);
      created += births.length; exited += exits.length;
    }
    assert.equal(created, 571); assert.equal(exited, 571);
  });
  check('Final original 38 groups present, qualified native rows pass, two exact shared failure identities remain', () => {
    const final = attempts.at(-1).result;
    assert.equal(final.outcomes.length, 77); assert.equal(final.outcomes.filter(row => row.status === 'pass').length, 75);
    assert.deepEqual(final.outcomes.filter(row => row.status === 'fail').map(row => row.id).sort(), ['ROOT-CONTROL', 'S07']);
    assert.deepEqual([...new Set(final.outcomes.filter(row => /^[NS]\d\d$/.test(row.id)).map(row => row.id))].sort(), [...Array.from({ length: 26 }, (_, index) => `N${String(index + 1).padStart(2, '0')}`), ...Array.from({ length: 12 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`)].sort());
    assert.equal(final.outcomes.filter(row => row.id.startsWith('N') && row.status === 'pass').length, 26);
    assert.equal(final.outcomes.filter(row => row.id.startsWith('A') && row.status === 'pass').length, 9);
  });
  check('Raw native exact and explicit payload-projection counts independently recomputed', () => {
    for (const { result, comparison } of attempts) {
      let bsdExact = 0; let gnuExact = 0; let payload = 0;
      for (const actual of result.candidateRows) {
        const bsdRow = bsd.rows.find(row => row.id === actual.id); const gnuRow = native.records.find(row => row.id === actual.id).runs[0];
        const effects = reference => { try { assert.deepEqual(reference.filesAfterHex, actual.filesAfterHex); return true; } catch { return false; } };
        const projected = reference => reference.stdoutHex === actual.stdoutHex && reference.status === actual.status && effects(reference);
        if (projected(bsdRow) && bsdRow.stderrHex === actual.stderrHex) bsdExact += 1;
        if (projected(gnuRow)) { payload += 1; if (gnuRow.stderrHex === actual.stderrHex) gnuExact += 1; }
      }
      assert.equal(bsdExact, comparison.bsdExact); assert.equal(gnuExact, comparison.gnuExact); assert.equal(payload, comparison.gnuPayloadProjectionOnly); assert.equal(comparison.stderrStripped, false);
      assert.equal(bsdExact, 16); assert.equal(gnuExact, 0); assert.equal(payload, 26);
    }
  });
  check('Both immutable source archives and complete physically moved package inventories unchanged', () => {
    for (const name of ['c9-01', 'fixed-01']) {
      const pack = load(join(root, 'attempts', `pack-${name}.json`));
      assert.equal(sha256(readFileSync(join(pack.destination, 'candidate.tar'))), pack.archiveSha256);
      for (const entry of pack.sourceManifest) assert.equal(sha256(readFileSync(join(pack.destination, 'source', entry.path))), entry.sha256);
      assert.deepEqual(manifest(join(pack.consumer, 'node_modules/virtual-bash')), pack.packageManifest);
      assert.equal(sha256(readFileSync(pack.fullOriginalReceipt.retainedPath)), pack.fullOriginalReceipt.sha256);
      assert.deepEqual(pack.runtimeDependencies, {}); assert.equal(pack.aliasPublicSubpathExists, false);
    }
  });
  check('Read-only reused installed development packages remain byte-identical to locked-cache validation', () => {
    const pack = load(join(root, 'attempts/pack-fixed-01.json'));
    for (const dependency of pack.dependencies) assert.equal(sha256(JSON.stringify(manifest(dependency.installed))), dependency.installedManifestSha256, dependency.name);
  });
  check('Maintained strict consumer and harness bytes equal the final compiled standalone inputs', () => {
    const final = attempts.at(-1).receipt;
    for (const name of ['holdouts.mts', 'public-consumer.mts']) {
      const input = final.inputs.find(entry => entry.source.endsWith(`/${name}`)); assert.ok(input); assert.equal(sha256(readFileSync(join(root, name))), input.sha256);
    }
    assert.equal(summary.fixedSourceSha256, 'c2333d21c049651a3ef75f811f7c3f516a364d41fdbed2f3683388fba0adbcff');
  });
  check('All maintained JavaScript helpers pass Node syntax-only checks', () => {
    for (const name of ['gnu/capture-native.mjs', 'freeze-pack.mjs', 'run-standalone.mjs', 'verify-evidence.mjs']) {
      const result = spawnSync(process.execPath, ['--check', join(root, name)], { timeout: 5000, maxBuffer: 65536, killSignal: 'SIGKILL' });
      assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr?.toString());
    }
  });
  report.status = 'passed'; report.decision = 'HOLD'; report.checkCount = report.checks.length;
  report.canonicalInventory = { strictTypeScript: ['holdouts.mts', 'public-consumer.mts'], syntaxCheckedJavaScript: ['gnu/capture-native.mjs', 'freeze-pack.mjs', 'run-standalone.mjs', 'verify-evidence.mjs'], capturedSourceData: 'attempts/*/harness-source.txt: exact historical previously compiled source, not executable discovery inputs', testOrTypecheckExclusionsAdded: [] };
  report.nodeVersion = process.version; report.nodeExecutableSha256 = sha256(readFileSync(process.execPath));
  report.helperSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
} catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { report.endedAt = new Date().toISOString(); writeFileSync(join(output, 'integrity.json'), `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2)); }
