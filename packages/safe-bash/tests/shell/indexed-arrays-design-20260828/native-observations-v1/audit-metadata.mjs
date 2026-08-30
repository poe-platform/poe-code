import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = '/Users/kjopek/Workspace/safe-bash';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };
const seal = readJson(path.join(directory, 'SEAL.json'));
const completion = readJson(path.join(seal.output, 'COMPLETION.json'));
const relative = filename => path.relative(workspace, filename);
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: workspace, maxBuffer: 2000000, timeout: 10000 });
const fileRecord = filename => {
  const stat = fs.lstatSync(filename);
  requireCondition(stat.isFile() && !stat.isSymbolicLink(), `not regular: ${filename}`);
  const bytes = fs.readFileSync(filename);
  return { path: relative(filename), bytes: bytes.length, sha256: hash(bytes) };
};
requireCondition(process.argv[2] === 'capture-index', 'metadata-only capture-index required; no oracle mode');
requireCondition(completion.status === 'OBSERVED_NOT_SCORED' && completion.failures.length === 0, 'incomplete observation');
const expectedCapture = completion.receiptsBeforeCompletion.map(item => path.basename(item.path)).concat('COMPLETION.json').sort();
requireCondition(JSON.stringify(fs.readdirSync(seal.output).sort()) === JSON.stringify(expectedCapture), 'capture new-entry drift');
for (const entry of completion.receiptsBeforeCompletion) {
  const actual = fileRecord(entry.path);
  requireCondition(actual.sha256 === entry.sha256 && actual.bytes === entry.bytes, `capture drift: ${entry.path}`);
}
const oldEntries = seal.authentication.protectedCensus;
for (const entry of oldEntries) {
  const stat = fs.lstatSync(entry.path);
  requireCondition(!stat.isSymbolicLink() && stat.dev === entry.dev && stat.ino === entry.ino && (stat.mode & 0o777) === entry.mode, `old identity drift: ${entry.path}`);
  if (entry.kind === 'file') {
    const actual = fileRecord(entry.path);
    requireCondition(actual.sha256 === entry.sha256 && actual.bytes === entry.bytes, `old hash drift: ${entry.path}`);
  } else {
    const expectedNames = oldEntries.filter(child => path.dirname(child.path) === entry.path).map(child => path.basename(child.path)).sort();
    const actualNames = fs.readdirSync(entry.path).filter(name => !(entry.path === path.join(workspace, 'tests/shell/indexed-arrays-design-20260828') && ['native-observations-v1', 'addendum-v2'].includes(name))).sort();
    requireCondition(JSON.stringify(actualNames) === JSON.stringify(expectedNames), `old new-entry drift: ${entry.path}`);
  }
}
for (const entry of [seal.authentication.binary, seal.authentication.manual]) {
  const actual = fileRecord(entry.path);
  requireCondition(actual.sha256 === entry.sha256 && actual.bytes === entry.bytes, `native artifact drift: ${entry.path}`);
}
for (const entry of seal.authentication.sources) {
  const bytes = git('show', `${entry.revision}:${entry.path}`);
  requireCondition(bytes.length === entry.bytes && hash(bytes) === entry.sha256, `accepted source drift: ${entry.path}`);
}
const rows = seal.authentication.rows.map(row => {
  const result = readJson(path.join(seal.output, `${row.id}-RESULT.json`));
  const invocation = seal.argv.find(entry => entry.id === row.id);
  requireCondition(JSON.stringify(result.argv) === JSON.stringify(invocation.argv) && JSON.stringify(result.env) === JSON.stringify(seal.env), `invocation drift: ${row.id}`);
  requireCondition(result.scriptSha256 === invocation.scriptSha256 && hash(row.script) === invocation.scriptSha256, `script drift: ${row.id}`);
  requireCondition(result.spawnSucceeded && result.childReaped && result.groupAbsent && result.observedClosureByDeadline && !result.errors.length && !result.stopReasons.length && !result.groupSignals.length, `closure failure: ${row.id}`);
  for (const stream of ['stdout', 'stderr']) {
    const actual = fileRecord(path.join(seal.output, `${row.id}-${stream}.bin`));
    requireCondition(actual.sha256 === result[stream].sha256 && actual.bytes === result[stream].bytes, `stream drift: ${row.id}/${stream}`);
  }
  return { id: row.id, scriptSha256: result.scriptSha256, scriptBytes: Buffer.byteLength(row.script),
    argvJsonSha256: hash(JSON.stringify(result.argv)), envJsonSha256: hash(JSON.stringify(result.env)),
    exit: result.exitCode, signal: result.signal, stdoutBytes: result.stdout.bytes, stderrBytes: result.stderr.bytes,
    elapsedMs: result.elapsedMs, pid: result.pid, pgid: result.pgid, childReaped: result.childReaped,
    groupAbsentAtClosure: result.groupAbsent, groupSignals: result.groupSignals, newEntries: result.newEntries };
});
const sum = field => rows.reduce((total, row) => total + row[field], 0);
requireCondition(rows.length === 16 && sum('scriptBytes') === 1783 && sum('stdoutBytes') + sum('stderrBytes') === completion.aggregateBytes, 'aggregate mismatch');
requireCondition(completion.cleanup.rootAbsent && completion.cleanup.after.length === 0 && !fs.existsSync(seal.fixture), 'fixture cleanup mismatch');
const records = fs.readdirSync(seal.output).sort().map(name => fileRecord(path.join(seal.output, name)));
const output = {
  schema: 'indexed-array-observation-evidence-index-v1', createdAt: new Date().toISOString(),
  qualification: 'Metadata audit only; no Bash process, product import, test, native retry, process probe or current-HEAD certification',
  sealCommit: completion.sealRevision, manifestSha256: completion.manifestSha256,
  sourceComposition: { base: '5137a74ec855a32d8a8860eb66b62eb44d11e290', cd: '4641075df5355a91c83bf5b2cc3a88dfaf1f5153', let: 'c26892c3a1a419311c9cf46a6c2976e696e00624', runtimeSha256: 'eb4588578001136b8ac011c1c458079b0c8a9f07e653938836d342dff052e193' },
  hashEncoding: 'SHA256 UTF8 JSON.stringify(value), insertion order as sealed, no trailing newline; raw files hash their exact bytes',
  bindings: ['supervisor.mjs', 'CONFIG.json', 'AUTHORIZATION.md', 'SEAL.json', 'ADMITTED.json', 'README.md', 'audit-metadata.mjs'].map(name => fileRecord(path.join(directory, name))),
  capture: { path: relative(seal.output), files: records.length, bytes: records.reduce((total, record) => total + record.bytes, 0), entries: records },
  rows, totals: { launched: rows.length, exit0: rows.filter(row => row.exit === 0).length, exit127: rows.filter(row => row.exit === 127).length,
    stdoutBytes: sum('stdoutBytes'), stderrBytes: sum('stderrBytes'), combinedBytes: completion.aggregateBytes,
    activeMs: completion.activeMs, maxRowMs: Math.max(...rows.map(row => row.elapsedMs)),
    fixtureEffectFiles: completion.fixtureEffects.length, fixtureEffectBytes: completion.fixtureEffects.reduce((total, entry) => total + entry.bytes, 0),
    fixturePeakEntries: completion.cleanup.before.length, cleanupRootAbsent: true, sentSignals: 0, nativeContextsDeclaredUpperBound: 18 },
  driftChecks: { oldFiles: oldEntries.filter(entry => entry.kind === 'file').length, newEntryCensus: true, captureNewEntryCensus: true, sourceBlobs: seal.authentication.sources.length, binaryManualHashes: true, outcome: 'NO_DRIFT' },
  tests: 0, productCalls: 0, productImports: 0, nativeExpectedValues: null, passDenominator: null,
};
const destination = path.join(directory, 'EVIDENCE.json');
const descriptor = fs.openSync(destination, 'wx', 0o600);
try { fs.writeFileSync(descriptor, `${JSON.stringify(output, null, 2)}\n`); fs.fsyncSync(descriptor); }
finally { fs.closeSync(descriptor); }
console.log(JSON.stringify({ output: relative(destination), sha256: hash(fs.readFileSync(destination)), totals: output.totals, driftChecks: output.driftChecks }));
