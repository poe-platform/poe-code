import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.REVIEW_COPY;
const temporary = process.env.TMPDIR;
const helper = await import(pathToFileURL(join(root, 'tests/commands/split/native-capture.ts')));
const results = [];
const report = { expected: { bytes: '00ff', status: 1 }, observed: { bytes: '01fe', status: 2 }, failed: true };
const diagnostic = [];
const context = { diagnostic(message) { diagnostic.push(message); } };
async function check(name, action) {
  try { await action(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, error: String(error), stack: error.stack }); }
}
async function rejects(action, pattern) {
  let caught;
  try { await action(); } catch (error) { caught = error; }
  assert.ok(caught, 'guard did not reject');
  assert.match(String(caught), pattern);
  return { error: String(caught), code: caught.code };
}
delete process.env.VIRTUAL_BASH_SPLIT_CAPTURE;
await check('default does not serialize or write', async () => {
  const before = await fs.readdir(temporary);
  assert.equal(await helper.captureNativeReport(context, 'gnu-errors', { toJSON() { throw new Error('must not serialize'); } }), undefined);
  assert.deepEqual(await fs.readdir(temporary), before);
});
await check('default failure round-trip has no report write', async () => {
  const before = await fs.readdir(temporary);
  await helper.captureNativeReport(context, 'gnu-errors', report, true);
  assert.deepEqual(JSON.parse(Buffer.from(diagnostic.at(-1).split('(base64): ')[1], 'base64').toString()), report);
  assert.deepEqual(await fs.readdir(temporary), before);
});
for (const setting of ['', '0', 'true', '01', '2', join(temporary, 'wrong-destination.json')]) {
  await check(`invalid capture mode ${JSON.stringify(setting)}`, async () => {
    process.env.VIRTUAL_BASH_SPLIT_CAPTURE = setting;
    const before = await fs.readdir(temporary);
    const error = await rejects(() => helper.captureNativeReport(context, 'gnu-errors', report), /accepts only 1, not a destination/);
    assert.deepEqual(await fs.readdir(temporary), before);
    diagnostic.push(error);
  });
}
delete process.env.VIRTUAL_BASH_SPLIT_CAPTURE;
for (const name of ['../escape', '/absolute', 'gnu-errors.json', '', 'gnu-errors/child']) {
  await check(`invalid name ${JSON.stringify(name)}`, async () => {
    const before = await fs.readdir(temporary);
    diagnostic.push(await rejects(() => helper.createNativeCapture(name), /Unknown split native report name/));
    assert.deepEqual(await fs.readdir(temporary), before);
  });
}
const alias = join(temporary, 'repo-alias');
await fs.symlink(root, alias);
for (const location of [root, join(root, 'tests/commands/split'), alias]) {
  await check(`repo TMPDIR ${location}`, async () => {
    process.env.TMPDIR = location;
    try {
      diagnostic.push(await rejects(() => helper.createNativeCapture('gnu-errors'), /outside the repository/));
      diagnostic.push(await rejects(() => helper.createNativeScratch({ ...context, after() { assert.fail('unexpected allocation'); } }), /outside the repository/));
    } finally { process.env.TMPDIR = temporary; }
  });
}
await check('concurrent factories unique with exact bytes and modes', async () => {
  const captures = await Promise.all(Array.from({ length: 12 }, () => helper.createNativeCapture('gnu-errors')));
  assert.equal(new Set(captures.map(capture => capture.directory)).size, 12);
  await Promise.all(captures.map(async capture => {
    assert.equal(dirname(capture.directory), temporary);
    await capture.write(report);
    assert.equal(await fs.readFile(capture.path, 'utf8'), JSON.stringify(report, null, 2) + '\n');
    assert.equal((await fs.stat(capture.path)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(capture.directory)).mode & 0o777, 0o700);
  }));
});
for (const kind of ['replacement-directory', 'directory-symlink', 'existing-file', 'output-symlink', 'dangling-output-symlink', 'repeat-publication']) {
  await check(kind, async () => {
    const capture = await helper.createNativeCapture('gnu-errors');
    const sentinel = join(temporary, `sentinel-${kind}`);
    await fs.writeFile(sentinel, 'preserve sentinel');
    let pattern = /EEXIST/;
    if (kind === 'replacement-directory' || kind === 'directory-symlink') {
      await fs.rename(capture.directory, capture.directory + '.original');
      if (kind === 'replacement-directory') await fs.mkdir(capture.directory);
      else {
        await fs.mkdir(capture.directory + '.target');
        await fs.symlink(capture.directory + '.target', capture.directory);
      }
      pattern = /directory identity changed or is a symlink/;
    } else if (kind === 'existing-file') await fs.writeFile(capture.path, 'original output');
    else if (kind === 'output-symlink') await fs.symlink(sentinel, capture.path);
    else if (kind === 'dangling-output-symlink') await fs.symlink(sentinel + '.absent', capture.path);
    else await capture.write(report);
    const before = await fs.lstat(capture.path).catch(() => undefined);
    const bytes = before?.isFile() ? await fs.readFile(capture.path) : undefined;
    diagnostic.push({ kind, path: capture.path, ...await rejects(() => capture.write({ overwritten: true }), pattern) });
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'preserve sentinel');
    if (bytes) assert.deepEqual(await fs.readFile(capture.path), bytes);
    if (before?.isSymbolicLink()) assert.ok((await fs.lstat(capture.path)).isSymbolicLink());
    if (!before) await assert.rejects(fs.lstat(capture.path), { code: 'ENOENT' });
    if (kind === 'dangling-output-symlink') await assert.rejects(fs.lstat(sentinel + '.absent'), { code: 'ENOENT' });
  });
}
await fs.writeFile(join(temporary, 'guard-results.json'), JSON.stringify({ results, diagnostic }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass: results.filter(result => result.pass).length, fail: results.filter(result => !result.pass).length }));
process.exitCode = results.some(result => !result.pass) ? 1 : 0;
