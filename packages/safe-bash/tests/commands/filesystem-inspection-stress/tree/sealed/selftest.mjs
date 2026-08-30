import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cases, fixtures } from './corpus.mjs';
import { fixtureFileSystem, captureSink, deferred } from './fixture-fs.mjs';

const makeError = (code, options) => Object.assign(new Error(`${code}: ${options.path}`), { code, ...options });
const native = JSON.parse(await readFile(new URL('./native.json', import.meta.url), 'utf8'));
test('exactly 38 unique independently frozen intended cases, 20 native captures', () => {
  assert.equal(cases.length, 38);
  assert.equal(new Set(cases.map((entry) => entry.id)).size, 38);
  assert.equal(native.length, 20);
});
test('native bytes match every original hash and mandatory successful captures', () => {
  for (const result of native) {
    for (const stream of ['stdout', 'stderr']) assert.equal(createHash('sha256').update(Buffer.from(result[`${stream}Base64`], 'base64')).digest('hex'), result[`${stream}Sha256`]);
    if (!['N15', 'N17', 'N18'].includes(result.id)) assert.equal(result.exitCode, 0, result.id);
  }
  assert.notEqual(native.find((result) => result.id === 'N17').exitCode, 0);
  assert.notEqual(native.find((result) => result.id === 'N18').exitCode, 0);
});
test('native JSON round trips every control/Unicode filename without normalization', () => {
  const json = JSON.parse(Buffer.from(native.find((result) => result.id === 'N20').stdoutBase64, 'base64'));
  assert.deepEqual(json[0].contents.map((entry) => entry.name).sort(), fixtures.controls.map((entry) => entry[1]).sort());
});
test('independent fixture resolves root symlinks, alias siblings and ancestors', async () => {
  const fixture = fixtureFileSystem(makeError);
  assert.equal(await fixture.filesystem.realpath('/rootlink'), '/links/target');
  assert.equal(await fixture.filesystem.realpath('/cycle/inner/back'), '/cycle');
  assert.equal((await fixture.filesystem.lstat('/links/alias-a')).type, 'symlink');
  assert.equal((await fixture.filesystem.stat('/links/alias-a')).ino, (await fixture.filesystem.stat('/links/alias-b')).ino);
  await assert.rejects(fixture.filesystem.stat('/links/dangling'), { code: 'ENOENT' });
});
test('disjoint identities and unknown identities are independent fixture facts', async () => {
  const disjoint = fixtureFileSystem(makeError, { identity: 'disjoint', noRealpath: true });
  const parent = await disjoint.filesystem.stat('/finite');
  const child = await disjoint.filesystem.stat('/finite/child');
  assert.equal(parent.ino, child.ino);
  assert.deepEqual(parent.identityScope, child.identityScope);
  assert.notEqual(parent.identityScope, child.identityScope);
  const unknown = fixtureFileSystem(makeError, { identity: 'unknown', noRealpath: true });
  assert.equal((await unknown.filesystem.stat('/finite')).identityScope, undefined);
  await assert.rejects(unknown.filesystem.realpath('/finite'), { code: 'ENOTSUP' });
});
test('fixture abort signal is propagated and content/mutation tripwires fail', async () => {
  const fixture = fixtureFileSystem(makeError);
  const controller = new AbortController();
  const reason = makeError('ENOENT', { path: '/finite' });
  controller.abort(reason);
  await assert.rejects(fixture.filesystem.stat('/finite', { signal: controller.signal }), (error) => error === reason);
  assert.equal(fixture.calls[0].signal, controller.signal);
  await assert.rejects(fixture.filesystem.readFile('/basic/b.txt'), { code: 'EIO' });
  await assert.rejects(fixture.filesystem.rm('/basic'), { code: 'EROFS' });
});
test('sink harness retains bytes and exposes pending ownership/backpressure', async () => {
  const gate = deferred();
  const capture = captureSink({ before: () => gate.promise });
  const bytes = new TextEncoder().encode('雪');
  const pending = capture.sink.write(bytes);
  assert.equal(capture.statistics().active, 1);
  assert.equal(capture.bytes().length, 0);
  gate.resolve();
  await pending;
  assert.equal(capture.bytes().length, 3);
  capture.verifyOwnership();
  bytes[0] = 0;
  assert.throws(() => capture.verifyOwnership());
});
