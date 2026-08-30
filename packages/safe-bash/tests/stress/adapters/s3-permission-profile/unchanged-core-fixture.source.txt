import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { adapters, binary, cancellation, errno, loopbackDav } from "../../fs/conformance/fixtures.js";
import { PropertyDav } from "../../fs/webdav/property-fixture.js";

for (const adapter of adapters) {
  test(`${adapter.name}: traversal remains rooted under explicit backend policy`, async (context) => {
    const { fs } = await adapter.create(context);
    await fs.writeFile("/sentinel", binary);
    if (adapter.name === "memory" || adapter.name === "real") {
      assert.deepEqual(await fs.readFile("/../../sentinel"), binary);
      await fs.writeFile("../../new", new Uint8Array([0, 255]));
      assert.deepEqual(await fs.readFile("/new"), new Uint8Array([0, 255]));
      context.diagnostic("PATH POLICY: lexical root ascent clamps at virtual root");
    } else {
      await assert.rejects(fs.readFile("/../../sentinel"), errno("EACCES"));
      await assert.rejects(fs.writeFile("../../new", binary), errno("EACCES"));
      await assert.rejects(fs.stat("/new"), errno("ENOENT"));
      context.diagnostic("PATH POLICY: lexical root ascent rejects EACCES");
    }
    assert.deepEqual(await fs.readFile("/sentinel"), binary);
  });

  test(`${adapter.name}: optional metadata capabilities are exercised or fail closed`, async (context) => {
    const propertyFixture = adapter.name === "webdav" ? await loopbackDav(context) : undefined;
    if (propertyFixture) propertyFixture.fixture.intercept = new PropertyDav().fetch;
    const { fs } = propertyFixture ?? await adapter.create(context);
    await fs.writeFile("/file", binary);
    if (fs.capabilities.permissions) {
      assert.ok(fs.chmod);
      await fs.chmod("/file", 0o600);
      assert.equal((await fs.stat("/file")).mode & 0o777, 0o600);
    } else {
      assert.equal(fs.capabilities.permissions, false);
      if (fs.chmod) await assert.rejects(fs.chmod("/file", 0o600), errno("ENOTSUP"));
      await assert.rejects(fs.writeFile("/mode", binary, { mode: 0o600 }), errno("ENOTSUP"));
      await assert.rejects(fs.access("/file", 1), errno("ENOTSUP"));
      context.diagnostic("CAPABILITY GAP: permissions, creation modes, execute access checks unsupported");
    }
    if (fs.capabilities.timestamps) {
      assert.ok(fs.utimes);
      const atimeMs = adapter.name === "real" ? (Math.floor(Date.now() / 1000) + 86400) * 1000 : 10000;
      await fs.utimes("/file", atimeMs, 20000);
      const stat = await fs.stat("/file");
      assert.equal(stat.atimeMs, atimeMs);
      assert.equal(stat.mtimeMs, 20000);
    } else {
      assert.equal(fs.capabilities.timestamps, false);
      if (fs.utimes) await assert.rejects(fs.utimes("/file", 10000, 20000), errno("ENOTSUP"));
      context.diagnostic("CAPABILITY GAP: timestamp mutation unsupported");
    }
    assert.deepEqual(await fs.readFile("/file"), binary);
  });

  test(`${adapter.name}: optional truncate preserves exact bytes or rejects without mutation`, async (context) => {
    const { fs } = await adapter.create(context);
    await fs.writeFile("/file", binary.slice(0, 16));
    if (!fs.truncate) {
      context.diagnostic("CAPABILITY GAP: optional truncate absent; no dedicated capability flag");
      assert.deepEqual(await fs.readFile("/file"), binary.slice(0, 16));
      return;
    }
    if (adapter.name === "webdav") {
      await assert.rejects(fs.truncate("/file", 8), errno("ENOTSUP"));
      assert.deepEqual(await fs.readFile("/file"), binary.slice(0, 16));
      context.diagnostic("CAPABILITY GAP: optional truncate exists but rejects ENOTSUP; no dedicated capability flag");
      return;
    }
    await fs.truncate("/file", 8);
    assert.deepEqual(await fs.readFile("/file"), binary.slice(0, 8));
    await fs.truncate("/file", 12);
    assert.deepEqual(await fs.readFile("/file"), new Uint8Array([...binary.slice(0, 8), 0, 0, 0, 0]));
    await assert.rejects(fs.truncate("/file", -1), errno("EINVAL"));
    assert.equal((await fs.stat("/file")).size, 12);
    assert.deepEqual(await fs.readFile("/file"), new Uint8Array([...binary.slice(0, 8), 0, 0, 0, 0]));
  });
}

for (const adapter of adapters.filter((candidate) => candidate.name === "memory" || candidate.name === "real")) {
  test(`${adapter.name}: cancellation between stream reads closes the iterator`, async (context) => {
    const { fs } = await adapter.create(context);
    assert.ok(fs.readStream);
    await fs.writeFile("/file", binary);
    const controller = new AbortController();
    const reason = new Error("cancel after first chunk");
    const iterator = fs.readStream("/file", { chunkSize: 64, signal: controller.signal })[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.deepEqual(first.value, binary.slice(0, 64));
    controller.abort(reason);
    await assert.rejects(iterator.next(), cancellation(controller.signal));
    assert.equal((await iterator.next()).done, true);
    assert.deepEqual(await fs.readFile("/file"), binary);
  });

  test(`${adapter.name}: cancellation during streaming write does not consume post-abort bytes`, async (context) => {
    const { fs } = await adapter.create(context);
    assert.ok(fs.writeStream);
    const controller = new AbortController();
    const reason = new Error("cancel during producer resume");
    let closed = false;
    let consumedAfterAbort = false;
    const source = (async function* () {
      try {
        yield binary.slice(0, 64);
        controller.abort(reason);
        yield new Uint8Array([99]);
        consumedAfterAbort = true;
      } finally { closed = true; }
    })();
    await assert.rejects(fs.writeStream("/partial", source, { signal: controller.signal }), cancellation(controller.signal));
    assert.equal(closed, true);
    assert.equal(consumedAfterAbort, false);
    const exists = (await fs.readdir("/")).some((entry) => entry.name === "partial");
    if (exists) {
      const actual = await fs.readFile("/partial");
      assert.ok(actual.length <= 64);
      assert.deepEqual(actual, binary.slice(0, actual.length));
    }
  });

  test(`${adapter.name}: symlink dot-dot resolution and directory unlink preserve targets`, async (context) => {
    const { fs } = await adapter.create(context);
    assert.ok(fs.symlink);
    await fs.mkdir("/target/nested", { recursive: true });
    await fs.writeFile("/target/file", binary);
    await fs.symlink("/target/nested", "/alias");
    assert.deepEqual(await fs.readFile("/alias/../file"), binary);
    await fs.rm("/alias", { recursive: true });
    assert.deepEqual(await fs.readFile("/target/file"), binary);
    assert.equal((await fs.stat("/target/nested")).type, "directory");
  });
}

test("real: preexisting host symlink cannot escape a disposable sandbox", async (context) => {
  const fixture = await adapters[1].create(context);
  assert.ok(fixture.root);
  const sandbox = join(fixture.root, "sandbox");
  const secret = join(fixture.root, "secret");
  await mkdir(sandbox);
  await writeFile(secret, binary);
  await symlink("../secret", join(sandbox, "escape"));
  const fs = await createRealFileSystem({ root: sandbox });
  await assert.rejects(fs.readFile("/escape"), errno("EACCES"));
  await assert.rejects(fs.writeFile("/escape", new Uint8Array()), errno("EACCES"));
  assert.equal((await fs.lstat("/escape")).type, "symlink");
  await fs.rm("/escape");
  assert.deepEqual(new Uint8Array(await readFile(secret)), binary);
});
