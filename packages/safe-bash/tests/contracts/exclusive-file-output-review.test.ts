import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem, type InvocationCleanup } from "../../src/contracts/index.js";
import { openFileOutput, type FileOutputOpenOptions } from "../../src/contracts/filesystem-output.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("review: delayed capability lookup cannot turn snapshotted wx into a collision overwrite", async () => {
  const fs: FileSystem = createMemoryFileSystem();
  await fs.writeFile("/target", Uint8Array.of(7), { mode: 0o400 });
  const entered = deferred(), release = deferred();
  fs.capabilitiesFor = async () => { entered.resolve(); await release.promise; return fs.capabilities; };
  const writeStream = fs.writeStream!.bind(fs);
  fs.writeStream = async (path, source, options) => {
    assert.equal(options?.flag, "wx");
    assert.equal(options.mode, 0);
    await writeStream(path, source, options);
  };
  const options: FileOutputOpenOptions = { flag: "wx", mode: 0 };
  const opening = openFileOutput({ fs, signal: new AbortController().signal }, "/target", options);
  const checked = assert.rejects(opening, { code: "EEXIST" });
  await entered.promise;
  Object.assign(options, { flag: "w", mode: 0o777 });
  release.resolve();
  await checked;
  assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(7));
  assert.equal((await fs.stat("/target")).mode & 0o7777, 0o400);
});

test("review: exclusive acquisition cancellation drains capability work and never starts a writer", async () => {
  const fs: FileSystem = createMemoryFileSystem();
  const controller = new AbortController();
  const entered = deferred(), release = deferred();
  const cleanups: InvocationCleanup[] = [];
  let writers = 0, settled = false;
  fs.capabilitiesFor = async () => {
    assert.equal(cleanups.length, 1);
    entered.resolve();
    await release.promise;
    return fs.capabilities;
  };
  fs.writeStream = async () => { writers++; throw new Error("late acquisition must not start writing"); };
  const opening = openFileOutput({ fs, signal: controller.signal, registerCleanup: cleanup => { cleanups.push(cleanup); } }, "/target", { flag: "wx", mode: 0o600 });
  const checked = assert.rejects(opening, error => error === false);
  void opening.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    controller.abort(false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally {
    release.resolve();
    await checked;
    await Promise.all(cleanups.map(cleanup => cleanup()));
  }
  assert.equal(writers, 0);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("review: exclusive ENOTSUP after provider creation is never retried through pathname appends", async () => {
  const fs = createMemoryFileSystem();
  const writeFile = fs.writeFile.bind(fs);
  let writes = 0, appends = 0;
  fs.writeStream = async (path, _source, options) => {
    await writeFile(path, new Uint8Array(), options);
    throw new FsError("ENOTSUP");
  };
  fs.writeFile = async () => { writes++; throw new Error("must not retry exclusive creation"); };
  fs.appendFile = async () => { appends++; throw new Error("must not append through an unretained pathname"); };
  await assert.rejects(openFileOutput({ fs, signal: new AbortController().signal }, "/target", { flag: "wx", mode: 0o600 }), { code: "ENOTSUP" });
  assert.equal(writes, 0);
  assert.equal(appends, 0);
  assert.deepEqual(await fs.readFile("/target"), new Uint8Array());
  assert.equal((await fs.stat("/target")).mode & 0o7777, 0o600);
});

test("review: mode-zero exclusive creation writes through the admitted stream without chmod", async () => {
  const fs = createMemoryFileSystem();
  const chmod = fs.chmod.bind(fs);
  fs.chmod = async () => { throw new Error("initial mode must not be emulated by chmod"); };
  const target = await openFileOutput({ fs, signal: new AbortController().signal }, "/target", { flag: "wx", mode: 0 });
  await target.sink.write(Uint8Array.of(255, 0, 128));
  await target.finish();
  assert.equal((await fs.stat("/target")).mode & 0o7777, 0);
  await chmod("/target", 0o400);
  assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(255, 0, 128));
});
