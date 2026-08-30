import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { authenticate, inventory, sha256 } from './primitives.mjs';
import { applyDeltas, noPullInput, observeAccess, accessDenied, exactDiagnostic } from './fixture-data.mjs';

export async function runDataControls(main) {
  const emit = (kind, id, detail) => process.stdout.write(JSON.stringify({ kind, id, detail }) + '\n');
  const input = JSON.parse(fs.readFileSync(main.inputs, 'utf8'));
  const work = main.positiveWork;
  fs.mkdirSync(work, { mode: 0o700 });
  let writtenBytes = 0;
  function put(filename, value, mode = input.mode) {
    const bytes = Buffer.from(value);
    assert.ok(writtenBytes + bytes.length <= 65536, 'scratch admission');
    fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
    writtenBytes += bytes.length;
  }
  const installed = path.join(work, 'installed');
  const moved = path.join(work, 'moved');
  fs.mkdirSync(installed);
  put(path.join(installed, 'package-data.txt'), input.packageBody);
  const bodies = input.variants.map(variant => Buffer.from(`${input.bodyPrefix}${variant}\n`));
  for (const [index, variant] of input.variants.entries()) put(path.join(installed, `${input.installedPrefix}${variant}${input.suffix}`), bodies[index]);
  const installedBefore = inventory(installed);
  fs.renameSync(installed, moved);
  assert.equal(fs.existsSync(installed), false);
  assert.deepEqual(inventory(moved), installedBefore);
  for (const [index, variant] of input.variants.entries()) {
    const oldName = path.join(moved, `${input.installedPrefix}${variant}${input.suffix}`);
    assert.throws(() => put(oldName, bodies[index]), { code: 'EEXIST' });
    authenticate(oldName, bodies[index], input.mode);
    put(path.join(moved, `${input.movedPrefix}${variant}${input.suffix}`), bodies[index]);
  }
  emit('control', 'R01', { physicalRename: true, oldEEXIST: 5, distinctMovedWx: 5, variants: input.variants, intendedBodiesUnchanged: true });
  const exactBefore = inventory(moved);
  for (const [index, variant] of input.variants.entries()) authenticate(path.join(moved, `${input.installedPrefix}${variant}${input.suffix}`), bodies[index], input.mode);
  assert.deepEqual(inventory(moved), exactBefore);
  emit('control', 'R02', { exactExisting: 5, noWrites: true });
  const refusals = path.join(work, 'refusals');
  fs.mkdirSync(refusals);
  const different = Buffer.from(bodies[0]);
  different[0] ^= 1;
  put(path.join(refusals, 'different'), different);
  put(path.join(refusals, 'mode'), bodies[0], 0o600);
  fs.symlinkSync(path.join(moved, `${input.installedPrefix}${input.variants[0]}${input.suffix}`), path.join(refusals, 'symlink'));
  put(path.join(refusals, 'alias-source'), bodies[0]);
  fs.linkSync(path.join(refusals, 'alias-source'), path.join(refusals, 'alias'));
  const refusalBefore = inventory(refusals);
  for (const [name, pattern] of [['different', /bytes refused/], ['mode', /mode refused/], ['symlink', /regular file required/], ['alias', /alias refused/]]) {
    assert.throws(() => authenticate(path.join(refusals, name), bodies[0], input.mode), pattern);
  }
  assert.deepEqual(inventory(refusals), refusalBefore);
  emit('control', 'R03', { rejected: ['bytes', 'mode', 'symlink', 'hardlink'], noWrites: true });
  const admitted = [];
  function admit(bytes) { assert.ok(bytes.length <= 64, 'capture admission refused'); admitted.push(Buffer.from(bytes)); }
  const reused = Buffer.alloc(64, 17);
  admit(reused);
  reused.fill(0);
  assert.deepEqual(admitted[0], Buffer.alloc(64, 17));
  assert.throws(() => admit(Buffer.alloc(65)), /capture admission refused/);
  assert.equal(admitted.length, 1);
  emit('control', 'B01', { accepted: 64, refused: 65, ownedCopy: true, scope: 'helper admission only' });
  const fixtures = JSON.parse(fs.readFileSync(main.fixtures, 'utf8'));
  const sourceBytes = fs.readFileSync(main.supplement);
  assert.equal(sha256(sourceBytes), fixtures.supplement.sha256);
  assert.equal(sha256(fs.readFileSync(main.original32)), fixtures.original32.sha256);
  const source = JSON.parse(sourceBytes);
  assert.equal(source.cases.length, 80);
  for (const fixture of fixtures.cases) {
    const excerpt = Buffer.from(fixture.originalSourceBase64, 'base64');
    assert.equal(sha256(excerpt), fixture.originalSourceSha256);
    assert.ok(sourceBytes.includes(excerpt));
    assert.deepEqual(JSON.parse(excerpt), fixture.original);
    assert.deepEqual(source.cases.find(row => row.id === fixture.original.id), fixture.original);
    assert.deepEqual(applyDeltas(fixture.original, fixture.deltas), fixture.row);
    assert.equal(fixture.row.execution, 'NOT_RUN');
    assert.notEqual(fixture.row.id, fixture.original.id);
  }
  assert.deepEqual(fixtures.cases.map(fixture => fixture.row.id), main.fixtureIds);
  emit('data', 'D01', { originalMembership: 4, exactSourceExcerpts: 4, explicitDeltas: 4, newIds: main.fixtureIds, productRuns: 0 });
  const canonical = fixtures.cases[0].row;
  const branches = fixtures.cases[3].row;
  assert.equal(Buffer.byteLength(canonical.expected.stderr.utf8), 38);
  assert.equal(exactDiagnostic(canonical, Buffer.from('apply_patch: permission denied: /work/a\n')), true);
  assert.equal(exactDiagnostic(canonical, Buffer.from('apply_patch: permission denied: /work/a [truncated]\n')), false);
  assert.deepEqual(branches.expected.stderr.exactUtf8Alternatives.map(value => Buffer.byteLength(value)), [98, 92]);
  for (const text of branches.expected.stderr.exactUtf8Alternatives) {
    assert.equal(exactDiagnostic(branches, Buffer.from(text)), true);
    assert.equal(exactDiagnostic(branches, Buffer.from(text.trimEnd())), false);
    assert.equal(exactDiagnostic(branches, Buffer.from(text.replace('/work/b', '/work/c'))), false);
  }
  assert.equal(exactDiagnostic(branches, Buffer.from('apply_patch: target changed\n')), false);
  emit('data', 'D02', { canonicalBytes: 38, exactBranchBytes: [98, 92], nearMatchesRejected: true, timestampCausationClaim: false });
  const literal = fixtures.cases[1];
  assert.deepEqual(literal.row.invocation.args, literal.original.invocation.args);
  assert.deepEqual(literal.row.expected.files, literal.original.expected.files);
  assert.deepEqual(literal.row.expected.stdout, literal.original.expected.stdout);
  const counters = { acquired: 0, pulls: 0, returns: 0 };
  const iterator = noPullInput(counters)[Symbol.asyncIterator]();
  assert.equal(typeof iterator.next, 'function');
  assert.deepEqual(counters, { acquired: 1, pulls: 0, returns: 0 });
  const beforeIntentionalPull = structuredClone(counters);
  await assert.rejects(iterator.next(), /V6_FORBIDDEN_STDIN_PULL/);
  await iterator.return();
  assert.deepEqual(counters, { acquired: 1, pulls: 1, returns: 1 });
  emit('data', 'D03', { beforeIntentionalPull, trapVerified: true, literalSourceAndEffectsPreserved: true, scope: 'synthetic iterator, not Shell' });
  const selectedSignal = new AbortController().signal;
  const specification = fixtures.cases[2].row.provider.access;
  const calls = [];
  const fake = { async access(...args) {
    calls.push(observeAccess(args, selectedSignal));
    if (accessDenied(specification, args)) throw Object.assign(new Error('synthetic mode2 denial'), { code: 'EACCES' });
  } };
  await fake.access('/work', 0, { signal: selectedSignal });
  await assert.rejects(fake.access('/work', 2, { signal: selectedSignal }), { code: 'EACCES' });
  await fake.access('/work', 4, { signal: selectedSignal });
  await fake.access('/elsewhere', 2, { signal: selectedSignal });
  assert.deepEqual(calls.map(call => call.mode), [0, 2, 4, 2]);
  assert.ok(calls.every(call => call.signalMatches));
  assert.equal(calls[3].path, '/elsewhere');
  emit('data', 'D04', { calls, denialCount: 1, scope: 'finite fake provider only, actual args[1]' });
  emit('positive-complete', 'START-POSITIVE', { writtenBytes, work: inventory(work), productRuns: 0 });
}
