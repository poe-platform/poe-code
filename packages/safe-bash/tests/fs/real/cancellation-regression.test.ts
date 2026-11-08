import assert from "node:assert/strict";
import { promises as host } from "node:fs";
import * as native from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { FsOptions } from "../../../src/contracts/index.js";
import type { RealFileSystem } from "../../../src/fs/real/index.js";
import { bytes, errno, fixture, text } from "./helpers.js";

interface ResolutionHooks {
  path(path: string, options?: FsOptions): Promise<string>;
  root(options?: FsOptions): Promise<string>;
  walk(root: string, components: unknown[], options: FsOptions & { checkTarget?: boolean }): Promise<string>;
}

async function snapshot(root: string): Promise<unknown[]> {
  const entries = await native.readdir(root);
  return Promise.all(entries.sort().map(async (name) => {
    const path = join(root, name);
    const stats = await native.lstat(path);
    return {
      name, mode: stats.mode, mtimeMs: stats.mtimeMs, ino: stats.ino, nlink: stats.nlink,
      data: stats.isFile() ? await native.readFile(path, "utf8") : undefined,
      target: stats.isSymbolicLink() ? await native.readlink(path) : undefined,
      entries: stats.isDirectory() ? await snapshot(path) : undefined,
    };
  }));
}

const mutations: {
  name: string;
  boundary: string;
  run(filesystem: RealFileSystem, options: FsOptions): Promise<void>;
}[] = [
  { name: "rm", boundary: "/victim", run: (filesystem, options) => filesystem.rm("/victim", options) },
  { name: "rename source", boundary: "/source", run: (filesystem, options) => filesystem.rename("/source", "/victim", options) },
  { name: "rename destination", boundary: "/victim", run: (filesystem, options) => filesystem.rename("/source", "/victim", options) },
  { name: "copyFile source", boundary: "/source", run: (filesystem, options) => filesystem.copyFile("/source", "/victim", options) },
  { name: "copyFile destination", boundary: "/victim", run: (filesystem, options) => filesystem.copyFile("/source", "/victim", options) },
  { name: "mkdir", boundary: "/created", run: (filesystem, options) => filesystem.mkdir("/created", options) },
  { name: "symlink", boundary: "/created", run: (filesystem, options) => filesystem.symlink("/source", "/created", options) },
  { name: "link", boundary: "/created", run: (filesystem, options) => filesystem.link("/source", "/created", options) },
  { name: "chmod", boundary: "/victim", run: (filesystem, options) => filesystem.chmod("/victim", 0o400, options) },
  { name: "utimes", boundary: "/victim", run: (filesystem, options) => filesystem.utimes("/victim", 1000, 2000, options) },
  { name: "truncate", boundary: "/victim", run: (filesystem, options) => filesystem.truncate("/victim", 0, options) },
  { name: "writeFile", boundary: "/victim", run: (filesystem, options) => filesystem.writeFile("/victim", bytes("replace"), options) },
  { name: "appendFile", boundary: "/victim", run: (filesystem, options) => filesystem.appendFile("/victim", bytes("append"), options) },
];

for (const mutation of mutations) {
  test(`cancellation after ${mutation.name} resolution does not start a mutation`, async (context) => {
    const { filesystem, root } = await fixture(context);
    await filesystem.writeFile("/victim", bytes("keep"));
    await filesystem.writeFile("/source", bytes("source"));
    const before = await snapshot(root);
    const controller = new AbortController();
    const reason = new Error(`cancel ${mutation.name}`);
    const hooks = filesystem as unknown as ResolutionHooks;
    const resolvePath = hooks.path.bind(filesystem);
    hooks.path = async (path, options) => {
      const result = await resolvePath(path, options);
      if (path === mutation.boundary) controller.abort(reason);
      return result;
    };
    await assert.rejects(mutation.run(filesystem, { signal: controller.signal }), (error) => error === reason);
    assert.deepEqual(await snapshot(root), before);
  });
}

for (const operation of ["rm", "rename"] as const) {
  test(`${operation} checks cancellation after final root verification`, async (context) => {
    const { filesystem, root } = await fixture(context);
    await filesystem.writeFile("/victim", bytes("keep"));
    await filesystem.writeFile("/source", bytes("source"));
    const before = await snapshot(root);
    const controller = new AbortController();
    const reason = new Error("cancel final root verification");
    const hooks = filesystem as unknown as ResolutionHooks;
    const resolvePath = hooks.path.bind(filesystem);
    const resolveRoot = hooks.root.bind(filesystem);
    let resolved = false;
    hooks.path = async (path, options) => {
      const result = await resolvePath(path, options);
      if (path === "/victim") resolved = true;
      return result;
    };
    hooks.root = async (options) => {
      const result = await resolveRoot(options);
      if (resolved) controller.abort(reason);
      return result;
    };
    const options = { signal: controller.signal };
    const pending = operation === "rm"
      ? filesystem.rm("/victim", options)
      : filesystem.rename("/source", "/victim", options);
    await assert.rejects(pending, (error) => error === reason);
    assert.deepEqual(await snapshot(root), before);
  });
}

test("recursive mkdir checks cancellation after root resolution before creating parents", async (context) => {
  const { filesystem, root } = await fixture(context);
  const controller = new AbortController();
  const reason = new Error("cancel traversal");
  const hooks = filesystem as unknown as ResolutionHooks;
  const resolveRoot = hooks.root.bind(filesystem);
  hooks.root = async (options) => {
    const result = await resolveRoot(options);
    controller.abort(reason);
    return result;
  };
  await assert.rejects(filesystem.mkdir("/created/child", {
    recursive: true, signal: controller.signal,
  }), (error) => error === reason);
  assert.deepEqual(await native.readdir(root), []);
});

test("symlink checks cancellation after target traversal before creation", async (context) => {
  const { filesystem, root } = await fixture(context);
  const controller = new AbortController();
  const reason = new Error("cancel target traversal");
  const hooks = filesystem as unknown as ResolutionHooks;
  const walk = hooks.walk.bind(filesystem);
  hooks.walk = async (root, components, options) => {
    const result = await walk(root, components, options);
    if (options.checkTarget) controller.abort(reason);
    return result;
  };
  await assert.rejects(filesystem.symlink("missing", "/created", {
    signal: controller.signal,
  }), (error) => error === reason);
  assert.deepEqual(await native.readdir(root), []);
});

test("cancellation keeps completed stream writes without promising rollback", async (context) => {
  const { filesystem } = await fixture(context);
  const controller = new AbortController();
  const reason = new Error("cancel after first chunk");
  async function* source() {
    yield bytes("completed");
    controller.abort(reason);
    yield bytes("not written");
  }
  await assert.rejects(filesystem.writeStream("/partial", source(), {
    signal: controller.signal,
  }), (error) => error === reason);
  assert.equal(text(await filesystem.readFile("/partial")), "completed");
});

async function streamFixture(context: TestContext, configure: (handle: native.FileHandle) => void,
  afterClose: () => Promise<void> = async () => {}) {
  const { filesystem, root } = await fixture(context);
  await filesystem.writeFile("/input", bytes("data"));
  const open = host.open;
  const handles: { handle: native.FileHandle; close: () => Promise<void> }[] = [];
  const calls = { close: 0 };
  context.mock.method(host, "open", async (...args: Parameters<typeof host.open>) => {
    const handle = await open(...args);
    const close = handle.close.bind(handle);
    handles.push({ handle, close });
    assert.equal(args[0], join(root, "input"));
    configure(handle);
    context.mock.method(handle, "close", async () => {
      calls.close++;
      await close();
      await afterClose();
    });
    return handle;
  });
  syncBuiltinESMExports();
  context.after(async () => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
    await Promise.all(handles.map(({ handle, close }) => handle.fd < 0 ? undefined : close()));
  });
  return { filesystem, handles, calls };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

for (const reason of [Object.assign(new Error("read failure"), { code: "EIO" }), undefined, null, false, 0, ""]) {
  test(`readStream preserves read failure ${String(reason)} over close failure`, async (context) => {
    const { filesystem, handles, calls } = await streamFixture(context, handle => {
      context.mock.method(handle, "read", async () => { throw reason; });
    }, async () => { throw Object.assign(new Error("close failure"), { code: "EBADF" }); });
    await assert.rejects(filesystem.readStream("/input")[Symbol.asyncIterator]().next(), errno("EIO", "/input", "readStream"));
    assert.equal(calls.close, 1);
    assert.equal(handles.length, 1);
    assert.equal(handles[0]!.handle.fd, -1);
  });
}

for (const reason of [new Error("read cancelled"), null, false, 0, ""]) {
  test(`readStream preserves cancellation ${String(reason)} over close failure`, async (context) => {
    const controller = new AbortController();
    const { filesystem, handles, calls } = await streamFixture(context, handle => {
      context.mock.method(handle, "read", async () => {
        controller.abort(reason);
        throw Object.assign(new Error("read failure"), { code: "EIO" });
      });
    }, async () => { throw Object.assign(new Error("close failure"), { code: "EBADF" }); });
    await assert.rejects(filesystem.readStream("/input", { signal: controller.signal })[Symbol.asyncIterator]().next(),
      error => Object.is(error, reason));
    assert.equal(calls.close, 1);
    assert.equal(handles[0]!.handle.fd, -1);
  });
}

for (const completion of ["EOF", "return"] as const) {
  for (const closeFails of [false, true]) {
    test(`readStream awaits ${completion} close with failure=${closeFails}`, async (context) => {
      const started = gate(), release = gate();
      context.after(() => { release.resolve(); });
      const { filesystem, handles, calls } = await streamFixture(context, () => {}, async () => {
        started.resolve();
        await release.promise;
        if (closeFails) throw Object.assign(new Error("close failure"), { code: "EBADF" });
      });
      const iterator = filesystem.readStream("/input")[Symbol.asyncIterator]();
      assert.deepEqual(await iterator.next(), { done: false, value: bytes("data") });
      let settled = false;
      const pending = (completion === "EOF" ? iterator.next() : iterator.return!()).finally(() => { settled = true; });
      const checked = closeFails ? assert.rejects(pending, errno("EBADF", "/input", "readStream")) : pending;
      try {
        await started.promise;
        assert.equal(settled, false);
        assert.equal(calls.close, 1);
        assert.equal(handles[0]!.handle.fd, -1);
      } finally { release.resolve(); }
      await checked;
      assert.equal(settled, true);
      assert.deepEqual(await iterator.next(), { done: true, value: undefined });
      assert.equal(calls.close, 1);
    });
  }
}

for (const cancelled of [false, true]) {
  test(`readStream awaits close before publishing ${cancelled ? "cancellation" : "read failure"}`, async (context) => {
    const controller = new AbortController(), reason = new Error("cancel read");
    const started = gate(), release = gate();
    context.after(() => { release.resolve(); });
    const { filesystem, calls } = await streamFixture(context, handle => {
      context.mock.method(handle, "read", async () => {
        if (cancelled) controller.abort(reason);
        throw Object.assign(new Error("read failure"), { code: "EIO" });
      });
    }, async () => { started.resolve(); await release.promise; });
    let settled = false;
    const pending = filesystem.readStream("/input", { signal: controller.signal })[Symbol.asyncIterator]().next()
      .finally(() => { settled = true; });
    const checked = assert.rejects(pending, cancelled ? error => error === reason : errno("EIO", "/input", "readStream"));
    try { await started.promise; assert.equal(settled, false); }
    finally { release.resolve(); }
    await checked;
    assert.equal(calls.close, 1);
  });
}
