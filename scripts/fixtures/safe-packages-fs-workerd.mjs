import assert from 'node:assert/strict';
import * as native from 'node:fs/promises';
import { RealFileSystem } from '@poe-platform/safe-fs/fs/real';
import { FsError } from '@poe-platform/safe-fs/core';

export default { async fetch() {
  const directory = await native.mkdtemp('/tmp/safe-fs-workerd-');
  const filename = `${directory}/artifact.bin`;
  const original = `${directory}/retained.bin`;
  const bytes = Uint8Array.of(0, 1, 127, 128, 254, 255);
  const replacement = Uint8Array.of(9, 8, 7);
  // Playwright supplies absolute native /tmp paths; / keeps them unchanged.
  const filesystem = new RealFileSystem({ root: '/' });
  let retained;
  try {
    for (const capability of ['open', 'permissions', 'timestamps', 'conditionalChmod', 'trustedOwnedStaging', 'atomicRename']) assert.equal(filesystem.capabilities[capability], false, capability);
    assert.equal(filesystem.capabilities.retainedRead, true);
    assert.throws(() => new RealFileSystem({ root: '/', renameNoReplace: async () => {} }), error => error instanceof FsError && error.code === 'ENOTSUP');
    await native.writeFile(filename, bytes);
    await assert.rejects(filesystem.open(filename, { access: 'write', creation: 'never', truncate: true }), error => error instanceof FsError && error.code === 'ENOTSUP');
    const link = `${directory}/link`;
    await native.symlink(filename, link);
    assert.ok((await native.lstat(link)).isSymbolicLink());
    await assert.rejects(filesystem.open(link, { access: 'read', creation: 'never', noFollow: true }), error => error instanceof FsError && error.code === 'ENOTSUP');
    await assert.rejects(filesystem.chmod(filename, 0o700), error => error instanceof FsError && error.code === 'ENOTSUP');
    await assert.rejects(filesystem.utimes(filename, 1, 2), error => error instanceof FsError && error.code === 'ENOTSUP');
    await assert.rejects(filesystem.mkdir(`${directory}/strict`, { exactMode: true, mode: 0o700 }), error => error instanceof FsError && error.code === 'ENOTSUP');
    await assert.rejects(native.stat(`${directory}/strict`), { code: 'ENOENT' });
    assert.deepEqual(new Uint8Array(await native.readFile(filename)), bytes);
    assert.equal(await filesystem.realpath(filename), filename);
    const produced = await native.stat(filename);
    retained = await filesystem.openReadFile(filename);
    const opened = await retained.stat();
    assert.equal(opened.type, 'file');
    assert.equal(opened.size, bytes.length);
    assert.equal(opened.dev, produced.dev);
    assert.equal(opened.ino, produced.ino);
    assert.equal(opened.identityScope, undefined);
    assert.equal(opened.opaqueVersion, undefined);
    assert.deepEqual(await retained.read(0, bytes.length + 1), bytes);
    assert.deepEqual(await retained.read(2, 3), bytes.slice(2, 5));
    assert.deepEqual(await retained.read(bytes.length, 1), new Uint8Array());
    const controller = new AbortController();
    const reason = { canceled: true };
    controller.abort(reason);
    await assert.rejects(retained.seekEnd({ signal: controller.signal }), error => error === reason);
    await assert.rejects(retained.seekEnd(), error => error instanceof FsError && error.code === 'ENOTSUP');
    assert.deepEqual(await retained.read(0, bytes.length), bytes);
    const owned = await retained.read(0, bytes.length);
    owned.fill(42);
    assert.deepEqual(await retained.read(0, bytes.length), bytes);

    await native.rename(filename, original);
    await native.writeFile(filename, replacement);
    const current = await filesystem.stat(filename);
    assert.equal(current.identityScope, undefined);
    assert.equal(current.opaqueVersion, undefined);
    assert.deepEqual(await filesystem.readFile(filename), replacement);
    await filesystem.rm(original);
    await assert.rejects(native.stat(original), { code: 'ENOENT' });
    assert.deepEqual(await retained.read(0, bytes.length), bytes);
    const after = await retained.stat();
    assert.equal(after.dev, opened.dev);
    assert.equal(after.ino, opened.ino);
    assert.equal(after.identityScope, opened.identityScope);
    await retained.close();
    await retained.close();
    await assert.rejects(retained.read(0, 1), error => error instanceof FsError && error.code === 'EBADF');
    await assert.rejects(retained.stat(), error => error instanceof FsError && error.code === 'EBADF');
    await filesystem.rm(filename);
    await assert.rejects(native.stat(filename), { code: 'ENOENT' });
  } finally {
    try { await retained?.close(); }
    finally { await native.rm(directory, { recursive: true, force: true }); }
  }
  await assert.rejects(native.stat(directory), { code: 'ENOENT' });
  return Response.json({ ok: true });
} };
