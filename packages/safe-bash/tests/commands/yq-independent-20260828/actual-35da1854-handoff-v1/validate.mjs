import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repository = '/Users/kjopek/Workspace/safe-bash';
const scope = join(repository, 'tests/commands/yq-independent-20260828/actual-35da1854-handoff-v1');
const output = join(scope, 'evidence');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (name) => JSON.parse(readFileSync(join(output, name)));
const inputs = read('INDEX.json');
const decoded = new Map();
const authenticated = new Map();
let pointerChecks = 0;

function authenticate(commit, path, descriptor, livePath) {
  const key = `${commit}:${path}`;
  if (authenticated.has(key)) return authenticated.get(key);
  const bytes = execFileSync('/usr/bin/git', ['show', key], { cwd: repository, timeout: 60000, maxBuffer: 134217728 });
  assert.equal(hash(bytes), descriptor[0], key);
  assert.equal(bytes.length, descriptor[1], key);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), descriptor[3], key);
  if (livePath) {
    const stat = lstatSync(livePath);
    assert(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.mode & 0o7777, descriptor[2], livePath);
    assert.deepEqual(readFileSync(livePath), bytes, livePath);
  }
  authenticated.set(key, bytes);
  return bytes;
}

function artifactBytes(id) {
  const entry = inputs.artifacts[id];
  assert(entry, `unknown artifact ${id}`);
  const root = inputs.roots[entry.root];
  return authenticate(root?.commit ?? entry.commit, root ? `${root.path}/${entry.path}` : entry.path, entry.descriptor, root ? join(repository, root.path, entry.path) : null);
}

function captureBytes(id, file) {
  const entry = inputs.captures[id];
  assert(entry?.files[file], `${id}/${file}`);
  const root = inputs.roots[entry.root];
  const path = `${root.path}/${entry.path}/${file}`;
  return authenticate(root.commit, path, entry.files[file], join(repository, path));
}

function resolve(reference) {
  const key = reference.artifact ? `artifact:${reference.artifact}` : `capture:${reference.capture}:${reference.file}`;
  if (!decoded.has(key)) {
    const bytes = reference.artifact ? artifactBytes(reference.artifact) : captureBytes(reference.capture, reference.file);
    decoded.set(key, reference.pointer ? JSON.parse(bytes) : bytes);
  }
  let value = decoded.get(key);
  if (reference.pointer && Buffer.isBuffer(value)) {
    value = JSON.parse(value);
    decoded.set(key, value);
  }
  if (!reference.pointer) return value;
  for (const segment of reference.pointer.split('/').slice(1)) {
    const part = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    assert(value !== null && typeof value === 'object' && Object.hasOwn(value, part), `${key}#${reference.pointer}`);
    value = value[part];
  }
  pointerChecks++;
  return value;
}

function inspect(value) {
  if (!value || typeof value !== 'object') return;
  if ((value.artifact || (value.capture && value.file)) && typeof value.pointer === 'string') resolve(value);
  for (const nested of Object.values(value)) inspect(nested);
}

function main() {
  assert.equal(process.cwd(), repository);
  for (const id of Object.keys(inputs.artifacts)) artifactBytes(id);
  for (const [id, entry] of Object.entries(inputs.captures)) {
    for (const file of Object.keys(entry.files)) captureBytes(id, file);
    const root = inputs.roots[entry.root];
    authenticate(root.commit, `${root.path}/${entry.parentSummary.path}`, entry.parentSummary.descriptor, join(repository, root.path, entry.parentSummary.path));
  }
  const generated = readdirSync(output).filter((name) => name.endsWith('.json'));
  for (const name of generated) inspect(read(name));
  const extraction = read('EXTRACTION-RESULT.json');
  for (const file of extraction.files) {
    const bytes = readFileSync(join(scope, file.path));
    assert.equal(hash(bytes), file.sha256, file.path);
    assert.equal(bytes.length, file.bytes, file.path);
  }
  const actual = read('ACTUAL-JOBS.json');
  const planned = read('PLANNED-STATUS.json');
  const mapped = read('ID-MAP-194.json');
  const source = read('SOURCE-COVERAGE.json');
  const run = read('RUN-SUMMARY.json');
  const provenance = read('PROVENANCE.json');
  assert.equal(actual.length, 166);
  assert.equal(new Set(actual.map((row) => row.capture)).size, 166);
  assert.equal(new Set(actual.map((row) => row.originalId)).size, 132);
  assert.equal(planned.length, 301);
  assert.equal(planned.filter((row) => row.state === 'UNRUN').length, 134);
  const classifications = {};
  for (const row of actual) {
    const declared = resolve(row.declaredJob);
    const receipt = JSON.parse(captureBytes(row.capture, 'receipt.json'));
    const verdict = JSON.parse(captureBytes(row.capture, 'verdict.json'));
    assert.deepEqual(row.argv, declared.argv);
    assert.equal(row.originalId, declared.recordId);
    assert.equal(row.role, declared.role);
    assert.equal(row.fragmentation, declared.id.split('--')[1]);
    assert.equal(row.assertions.rawVerdict, verdict.outcome);
    assert.equal(row.observed.status, receipt.capture.status);
    for (const stream of ['stdout', 'stderr']) {
      const bytes = Buffer.from(receipt.capture[`${stream}Hex`], 'hex');
      assert.deepEqual(captureBytes(row.capture, `command-${stream}.bin`), bytes);
      assert.equal(hash(bytes), row.observed[stream].sha256);
      assert.equal(bytes.length, row.observed[stream].bytes);
    }
    assert.equal(row.assertions.fullRecordPass, false);
    assert.equal(row.child.exitCode, 0);
    assert.equal(row.child.signal, null);
    for (const key of ['timedOut', 'overflow']) assert.equal(row.child[key], false);
    for (const key of ['reaped', 'integrity', 'reapProof']) assert.equal(row.child[key], true);
    assert.equal(row.child.spawnError, null);
    classifications[row.assertions.classification] = (classifications[row.assertions.classification] ?? 0) + 1;
  }
  assert.deepEqual(classifications, { PASS_PROJECTION: 134, HARNESS_FAILURE: 1, INCOMPLETE: 31 });
  assert.equal(mapped.rows.length, 194);
  assert.equal(mapped.overlays.length, 8);
  assert.equal(mapped.rows.filter((row) => row.overlay).length, 8);
  assert.deepEqual(Object.values(mapped.roleCounts), [111, 34, 23, 11, 4, 5, 6]);
  assert.equal(source.designated.length, 23);
  assert.deepEqual(source.classificationCounts, { SUPPORT_ONLY: 15, SOURCE_COUNTERPROOF: 4, PARTIAL_SUPPORT: 4 });
  assert.equal(run.originalAggregate, 'FAIL');
  assert.equal(run.parent.elapsedMs, 619594);
  assert.equal(run.admissionBudgetMs, 600000);
  assert.equal(run.actualChildren, 167);
  assert.equal(run.sourceAdmission.length, 1);
  assert.equal(run.sourceAdmission[0].child.reaped, true);
  assert.equal(run.sourceAdmission[0].child.exitCode, 0);
  assert.deepEqual(run.movedElapsedRangeMs, [16840, 27231]);
  for (const finding of read('REPAIR-FINDINGS.json').findings) {
    for (const witness of finding.witnesses) {
      const bytes = artifactBytes(witness.source.artifact);
      assert.equal(hash(bytes), witness.sha256);
      assert.equal(bytes.toString().split('\n').slice(witness.firstLine - 1, witness.lastLine).join('\n'), witness.text);
    }
    assert.equal(finding.runtimeCounterTrace, 'UNRUN');
    assert.equal(finding.newPolicy, false);
  }
  const references = [
    { artifact: 'packet-maps', pointer: '/readme' },
    { artifact: 'packet-maps', pointer: '/source/files/README.md' },
    { artifact: 'packet-maps', pointer: '/archive/files/README.md' },
    { artifact: 'packet-maps', pointer: '/fullPackage/files/README.md' },
    { artifact: 'build-bindings', pointer: '/baselineReadme' },
    { artifact: 'build-final-map', pointer: '/files/README.md' },
  ];
  for (const reference of references) assert.equal(resolve(reference).sha256, provenance.readme.sha256);
  const readme = { sha256: provenance.readme.sha256, bytes: provenance.readme.bytes, mode: provenance.readme.mode, references,
    originalAndPriorMovedBefore: { artifact: 'guard-inputs', pointer: '' },
    originalAndPriorMovedAfter: { artifact: 'integrity-after', pointer: '' },
    freshMovedWholeTreeProofs: { artifact: 'moves', pointer: '' },
    buildBeforeAfter: { artifact: 'build-integrity', pointer: '' },
    observationOnly: 'Existing whole-tree membership/mode/hash evidence covers README; no new materialization or physical-package inspection.' };
  const report = { date: '2026-08-28', kind: 'ARTIFACT_DATA_VALIDATION_ONLY', exitCode: 0, inputFilesAuthenticated: authenticated.size,
    exactReferencePointersChecked: pointerChecks, runtimeRows: actual.length, classifications, plannedChildren: planned.length, unrun: 134,
    originalIds: mapped.rows.length, overlappingOverlays: 8, sourceClassifications: source.classificationCounts, readme,
    rawCommandBytesMatchCapturedReceipt: true, originalAggregate: 'FAIL', fullRecordPassesAdded: 0, productOrHarnessRuns: 0, compilerRuns: 0,
    physicalMaterializationsRechecked: false, noSourceOrFrameworkChanges: true };
  writeFileSync(join(output, 'VALIDATION.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  console.log(JSON.stringify({ status: 'ARTIFACT_DATA_VALIDATED', inputFilesAuthenticated: authenticated.size, exactReferencePointersChecked: pointerChecks, originalAggregate: 'FAIL', productOrHarnessRuns: 0 }));
}

try { main(); }
catch (error) {
  const failure = { date: '2026-08-28', name: error.name, message: error.message, stack: error.stack, productRuns: 0, dataValidationFailure: true };
  const path = join(scope, 'VALIDATION-FAILURE.json');
  if (!existsSync(path)) writeFileSync(path, `${JSON.stringify(failure, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  console.error(JSON.stringify(failure));
  process.exitCode = 1;
}
