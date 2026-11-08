import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const root = '/tmp/conditional-author-dEbqvd';
const outer = '/tmp/strict-extension-launch-aUwe2j';
const prep = '/tmp/strict-extension-prep-8wtcJy';
const destination = path.join(own, 'results-v1-stop');
const logRoot = fs.mkdtempSync('/tmp/strict-extension-publication-');
const log = fs.openSync(path.join(logRoot, 'publication.jsonl'), 'wx');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const records = [];
let total = 0;
try {
  fs.writeSync(log, JSON.stringify({ role: 'DATA_PUBLICATION_ONLY', started: new Date().toISOString(), productExecutions: 0 }) + '\n');
  assert.deepEqual(process.argv.slice(2), ['--publish-preserved-stop']);
  assert.ok(!fs.existsSync(destination));
  fs.mkdirSync(destination);
  function copy(file, relative) {
    assert.ok(!relative.split('/').includes('AGENTS.md'));
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.ok(stat.size <= 16 * 1024 * 1024);
    total += stat.size;
    assert.ok(total < 32 * 1024 * 1024);
    const bytes = fs.readFileSync(file), target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: 'wx' });
    assert.equal(sha(fs.readFileSync(target)), sha(bytes));
    records.push({ source: file, path: relative, bytes: bytes.length, sha256: sha(bytes) });
  }
  for (const [directory, prefix] of [[root, 'raw'], [outer, 'outer'], [prep, 'prep']]) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      if (fs.lstatSync(file).isFile()) copy(file, prefix + '/' + name);
    }
  }
  const result = JSON.parse(fs.readFileSync(path.join(root, 'RESULT.json')));
  const rows = fs.readFileSync(path.join(root, 'source-extension.stdout'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const terminal = JSON.parse(fs.readFileSync(path.join(outer, 'TERMINAL.json')));
  assert.equal(result.status, 'FAILED_OR_INCOMPLETE');
  assert.equal(rows.length, 32); assert.ok(rows.every(row => row.pass));
  assert.equal(result.children.at(-1).code, 78); assert.equal(terminal.code, 1);
  assert.match(fs.readFileSync(path.join(root, 'source-extension.stderr'), 'utf8'), /CASE_DEADLINE X10-parameter-isolation-caller/);
  assert.equal(result.package.members.length, 954);
  assert.equal(sha(fs.readFileSync(path.join(root, result.package.file))), result.package.sha256);
  const retained = result.cohorts.map(row => ({ label: row.label, pass: row.pass, fail: row.fail }));
  const inputChecks = result.source.inputs.map(row => {
    const file = path.join(root, 'source', row.path), actual = sha(fs.readFileSync(file));
    assert.equal(actual, row.sha256);
    return { path: row.path, sha256: actual };
  });
  const memberChecks = result.package.members.map(row => {
    const actual = sha(fs.readFileSync(path.join(root, 'source', row.path)));
    assert.equal(actual, row.sha256);
    return { path: row.path, bytes: row.bytes, mode: row.mode, sha256: actual };
  });
  const summary = {
    role: 'AUTHOR_STOP_NO_ACCEPTANCE_NO_RETRY', date: '2026-08-29',
    sourceCommit: '9bb91c370a0672687399c0a9da4ce1b161f79615',
    computedTree: result.source.computedTree,
    sourceManifestSha256: sha(fs.readFileSync(path.join(own, 'SOURCE.json'))),
    preseal: 'f5895188',
    package: { file: result.package.file, bytes: result.package.bytes, sha256: result.package.sha256, members: result.package.members.length },
    build: result.children.find(row => row.label === 'production-build-once').code,
    retained, extension: { completed: 32, pass: 32, ordinaryFailureRows: 0, deadline: 'X10-parameter-isolation-caller', deadlineChildExit: 78, deadlineCount: 1, summaryNotEmitted: true, rows: rows.map(row => ({ id: row.id, created: row.created, disposed: row.disposed, cleanupFailure: row.cleanupFailure })) },
    aggregate: { exit: terminal.code, observedCompletedPassRows: 197, notFull630: true, safetyStop: true },
    unexecuted: ['source-arrays12', 'all installed and physically moved semantic consumers', 'all6 consumer type groups/24 negative diagnostics', 'all6 loaded mutants/6 restores', 'both binding refusals'],
    nativeExecutions: 0, privateExecutions: 0, openDesignIds: ['U27', 'S-U27-INPUT-UNIT-v1', 'S-U28-PRESENCE-v1', 'S-U31-STDIN-v1', 'E23-source-discard'],
    cleanup: { ...result.cleanup, outerClosed: terminal.closed, outerSignals: terminal.signals, completedExtensionShells: rows.reduce((count, row) => count + row.created, 0), completedExtensionDisposals: rows.reduce((count, row) => count + row.disposed, 0), x10Cleanup: 'UNOBSERVED_AT_FORCED_PROCESS_EXIT', noGlobalResourceCleanClaim: true },
    measurements: { elapsedMs: result.elapsedMs, runnerCaptureBytes: result.captureBytes, runnerScratchBytes: result.actualScratchBytes, publicationBytes: total },
    censusQualification: 'Measured7 runner child processes +1 outer runner;4 fixed-loader reservations,0 observed RegexWorker births. Administrative/development/publication tools separate; preseal reserve is not a measured global OS census.',
    sourceInspectionAfterStop: { inputs: inputChecks.length, members: memberChecks.length, allHashesMatch: true, runtimeContinuation: false },
    retainedRoots: [root, outer, prep],
    sourceFinding: 'X10 returns from guard after registering cleanup that awaits gate; per-dispatch finally awaits scope.close before subsequent diagnostic command. gate release is reached only after diagnostic entered. This is a source-proven fixture wait cycle; no per-substep telemetry proves the actual suspended X10 await.'
  };
  for (const [name, data] of [['SUMMARY.json', summary], ['SOURCE-POST-STOP.json', inputChecks], ['PACKAGE-MEMBERS.json', memberChecks], ['RAW-MANIFEST.json', records]]) {
    const bytes = Buffer.from(JSON.stringify(data, null, 2) + '\n');
    assert.ok(total + bytes.length < 32 * 1024 * 1024); total += bytes.length;
    fs.writeFileSync(path.join(destination, name), bytes, { flag: 'wx' });
  }
  fs.writeSync(log, JSON.stringify({ finished: new Date().toISOString(), total, files: records.length + 4, productExecutions: 0 }) + '\n');
  console.log(JSON.stringify({ destination, files: records.length + 4, total, summary: { completedPassRows: 197, deadline: 1, exit: 1 }, logRoot }));
} catch (error) {
  fs.writeSync(log, JSON.stringify({ failed: String(error), stack: error?.stack }) + '\n');
  throw error;
} finally { fs.closeSync(log); }
