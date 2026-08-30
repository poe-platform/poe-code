import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as native from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.REVIEW_COPY;
const temporary = process.env.TMPDIR;
const { captureNativeReport, createNativeCapture, createNativeScratch } = await import(pathToFileURL(join(root, 'tests/commands/split/native-capture.ts')));
const results = [];
async function check(name, operation) {
  try { await operation(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, error: String(error), stack: error.stack }); }
}
async function environment(values, operation) {
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  const set = values => { for (const [name, value] of Object.entries(values)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
  set(values);
  try { return await operation(); } finally { set(previous); }
}
await check('default-no-serialization-no-allocation', async () => {
  const before = await native.readdir(temporary);
  await environment({ VIRTUAL_BASH_SPLIT_CAPTURE: undefined }, async () => {
    assert.equal(await captureNativeReport({ diagnostic() { assert.fail(); } }, 'edge', { toJSON() { assert.fail(); } }), undefined);
  });
  assert.deepEqual(await native.readdir(temporary), before);
});
for (const name of ['edge', 'stress', 'dangling-native']) await check(`failure-diagnostic-roundtrip-${name}`, async () => {
  const report = { failed: true, bytes: '00ff000a', expected: { status: 1 }, observed: { status: 2 } };
  const messages = [];
  await environment({ VIRTUAL_BASH_SPLIT_CAPTURE: undefined }, () => captureNativeReport({ diagnostic(message) { messages.push(message); } }, name, report, true));
  assert.equal(messages.length, 1);
  const encoded = messages[0].split('(base64): ')[1];
  assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString()), report);
});
for (const setting of [root, join(root, 'tests/commands/split/evidence/edge-latest.json'), temporary, '0', '', 'true']) await check(`reject-setting-${JSON.stringify(setting)}`, async () => {
  await environment({ VIRTUAL_BASH_SPLIT_CAPTURE: setting }, () => assert.rejects(captureNativeReport({ diagnostic() {} }, 'edge', {}), /accepts only 1, not a destination/));
});
for (const name of ['../edge', '/tmp/edge', 'edge.json', '', 'native-initial']) await check(`reject-report-name-${JSON.stringify(name)}`, () => assert.rejects(createNativeCapture(name), /Unknown split native report name/));
const alias = join(temporary, 'repository-alias');
await native.symlink(root, alias, 'dir');
for (const path of [root, join(root, 'tests/commands/split'), alias, join(alias, 'tests/commands/split')]) await check(`reject-repository-TMPDIR-${path}`, async () => {
  await environment({ TMPDIR: path, TMP: path, TEMP: path }, async () => {
    await assert.rejects(createNativeCapture('edge'), /outside the repository/);
    await assert.rejects(createNativeScratch({ after() { assert.fail(); }, diagnostic() {} }), /outside the repository/);
  });
});
await check('twelve-concurrent-exclusive-OS-temp-publications', async () => {
  const captures = await Promise.all(Array.from({ length: 12 }, (_, index) => createNativeCapture(['edge', 'stress', 'dangling-native'][index % 3])));
  assert.equal(new Set(captures.map(capture => capture.directory)).size, 12);
  await Promise.all(captures.map(async (capture, index) => {
    assert.equal(dirname(capture.directory), temporary);
    assert.equal(await capture.write({ index }), capture.path);
    assert.deepEqual(JSON.parse(await native.readFile(capture.path, 'utf8')), { index });
    assert.equal((await native.stat(capture.directory)).mode & 0o777, 0o700);
    assert.equal((await native.stat(capture.path)).mode & 0o777, 0o600);
  }));
});
for (const guard of ['existing-output', 'existing-identical-output', 'output-symlink', 'dangling-output-symlink', 'directory-symlink', 'replaced-directory']) await check(guard, async () => {
  const capture = await createNativeCapture('dangling-native');
  const target = await native.mkdtemp(join(temporary, 'guard-target-'));
  const sentinel = join(target, 'sentinel');
  await native.writeFile(sentinel, 'ORIGINAL', { flag: 'wx' });
  if (guard.startsWith('existing-')) await capture.write({ original: true });
  else if (guard === 'output-symlink') await native.symlink(sentinel, capture.path);
  else if (guard === 'dangling-output-symlink') await native.symlink(join(target, 'absent'), capture.path);
  else {
    await native.rename(capture.directory, `${capture.directory}-original`);
    if (guard === 'directory-symlink') await native.symlink(target, capture.directory, 'dir');
    else await native.mkdir(capture.directory);
  }
  await assert.rejects(capture.write(guard === 'existing-identical-output' ? { original: true } : { replacement: true }), guard.includes('directory') ? /identity changed or is a symlink/ : { code: 'EEXIST' });
  assert.equal(await native.readFile(sentinel, 'utf8'), 'ORIGINAL');
  assert.deepEqual((await native.readdir(target)).sort(), ['sentinel']);
  if (guard.startsWith('existing-')) assert.deepEqual(JSON.parse(await native.readFile(capture.path, 'utf8')), { original: true });
});
for (const phase of ['initial', 'fixed', 'final', '../../evidence/dangling/native-initial', join(root, 'tests/commands/split/evidence/dangling/native-initial.json')]) await check(`phase-cannot-select-destination-${phase}`, async () => {
  await environment({ SPLIT_DANGLING_PHASE: phase, VIRTUAL_BASH_SPLIT_CAPTURE: '1' }, async () => {
    const path = await captureNativeReport({ diagnostic() {} }, 'dangling-native', { phase });
    assert.equal(dirname(dirname(path)), temporary);
    assert.equal(path.endsWith('/dangling-native.json'), true);
  });
});
if (process.env.REVIEW_CONTROLS === '1') {
  const target = join(root, 'tests/commands/split/evidence/edge-latest.json');
  const bytes = await native.readFile(target);
  const deny = { code: 'REVIEW_WRITE_BLOCKED' };
  await check('positive-control-identical-promise-write', () => assert.rejects(native.writeFile(target, bytes), deny));
  await check('positive-control-identical-sync-write', () => assert.throws(() => fs.writeFileSync(target, bytes), deny));
  await check('positive-control-identical-callback-write', () => assert.rejects(new Promise((resolve, reject) => fs.writeFile(target, bytes, error => error ? reject(error) : resolve())), deny));
  await check('positive-control-promises-open-truncate', () => assert.rejects(native.open(target, 'w'), deny));
  await check('positive-control-sync-open-truncate', () => assert.throws(() => fs.openSync(target, 'w'), deny));
  await check('positive-control-filehandle-write', async () => {
    const handle = await native.open(target, 'r');
    try { await assert.rejects(handle.writeFile(bytes), deny); } finally { await handle.close(); }
  });
  await check('positive-control-descriptor-write', async () => {
    const descriptor = fs.openSync(target, 'r');
    try { assert.throws(() => fs.writeSync(descriptor, bytes), deny); } finally { fs.closeSync(descriptor); }
  });
  await check('positive-control-write-stream', () => assert.throws(() => fs.createWriteStream(target), deny));
  await check('positive-control-identical-copy', () => assert.rejects(native.copyFile(target, target), deny));
  await check('positive-control-identical-rename', () => assert.rejects(native.rename(target, target), deny));
  await check('positive-control-unlink-through-directory-alias', () => assert.rejects(native.unlink(join(alias, 'tests/commands/split/evidence/edge-latest.json')), deny));
  await check('unlink-owned-symlink-does-not-unlink-protected-target', async () => {
    const link = join(temporary, 'unlink-control');
    await native.symlink(target, link);
    await native.unlink(link);
    assert.deepEqual(await native.readFile(target), bytes);
  });
}
await native.writeFile(join(temporary, 'guards.json'), JSON.stringify(results, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass: results.filter(result => result.pass).length, fail: results.filter(result => !result.pass).length, results }));
process.exitCode = results.some(result => !result.pass) ? 1 : 0;
