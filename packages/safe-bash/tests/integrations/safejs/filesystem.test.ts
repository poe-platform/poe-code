import assert from "node:assert/strict";
import { test } from "node:test";
import { createNodeFsBridge, makeSafeJsFsModule } from "../../../src/integrations/safejs/index.js";
import type { NodeFsBridgeFileSystem } from "../../../src/integrations/safejs/index.js";
import { StubFileSystem } from "./stub-filesystem.js";

test("reads bytes by default and honors Node encodings without changing VFS bytes", async () => {
  const fs = new StubFileSystem({ "/data/file": "héllo" });
  const bridge = createNodeFsBridge(fs, { cwd: "/data" });
  assert.deepEqual(await bridge.readFile("file"), Buffer.from("héllo"));
  assert.equal(await bridge.readFile("file", "utf8"), "héllo");
  assert.equal(await bridge.readFile("file", { encoding: "hex" }), Buffer.from("héllo").toString("hex"));
  const bytes = await bridge.readFile("file");
  bytes.fill(0);
  assert.equal(await bridge.readFile(new URL("file:///data/file"), "utf8"), "héllo");
  assert.equal(await bridge.readFile(Buffer.from("/data/file"), "utf8"), "héllo");
});

test("write/append use encoding, flags, and the very same filesystem", async () => {
  const fs = new StubFileSystem();
  const bridge = createNodeFsBridge(fs);
  await bridge.writeFile("/file", "6869", "hex");
  assert.equal(Buffer.from(await fs.readFile("/file")).toString(), "hi");
  await bridge.appendFile("/file", "IQ==", "base64");
  assert.equal(await bridge.readFile("/file", "utf8"), "hi!");
  await assert.rejects(bridge.writeFile("/file", "x", { flag: "wx" }), { code: "EEXIST" });
  await assert.rejects(bridge.appendFile("/file", "x", { flag: "ax" }), { code: "EEXIST" });
  await bridge.appendFile("/file", "replacement", { flag: "w" });
  assert.equal(await bridge.readFile("/file", "utf8"), "replacement");
  const bytes = new Uint8Array([0, 1, 2, 3]);
  await bridge.writeFile("/file", new DataView(bytes.buffer, 1, 2));
  assert.deepEqual(await bridge.readFile("/file"), Buffer.from([1, 2]));
});

test("stats and dirents have Node numeric fields, dates, and callable type predicates", async () => {
  const fs = new StubFileSystem({ "/dir/file": "body" });
  const bridge = createNodeFsBridge(fs);
  await bridge.symlink("file", "/dir/link");
  const stat = await bridge.stat("/dir/link");
  assert.equal(stat.isFile(), true);
  assert.equal(stat.mode & 0o170000, 0o100000);
  assert.equal(stat.size, 4);
  assert.equal(stat.atime.getTime(), 1000);
  assert.equal(stat.birthtimeMs, 3000);
  assert.equal(stat.blocks, 1);
  assert.equal(stat.isSocket(), false);
  assert.equal((await bridge.lstat("/dir/link")).isSymbolicLink(), true);
  const entries = await bridge.readdir("/dir", { withFileTypes: true });
  assert.deepEqual(entries.map((entry) => entry.name), ["file", "link"]);
  assert.equal(entries[0]?.parentPath, "/dir");
  assert.equal(entries[0]?.isFile(), true);
  assert.equal(entries[1]?.isSymbolicLink(), true);
  const buffers = await bridge.readdir("/dir", { withFileTypes: true, encoding: "buffer" });
  assert.deepEqual(buffers[0]?.name, Buffer.from("file"));
});

test("directory recursion does not follow symlinks and preserves relative names", async () => {
  const bridge = createNodeFsBridge(new StubFileSystem({ "/dir/nested/file": "body" }));
  await bridge.symlink("..", "/dir/nested/loop");
  assert.deepEqual(await bridge.readdir("/dir", { recursive: true }), ["nested", "nested/file", "nested/loop"]);
  assert.deepEqual(await bridge.readdir("/dir", "buffer"), [Buffer.from("nested")]);
  assert.equal(await bridge.mkdir("/new/deep", { recursive: true }), "/new");
  assert.equal(await bridge.mkdir("/new/deep", { recursive: true }), undefined);
  assert.equal(await bridge.mkdir("/single"), undefined);
});

test("path operations remain virtual, including absolute paths and symlink targets", async () => {
  const fs = new StubFileSystem({ "/repo/file": "body" });
  const bridge = createNodeFsBridge(fs, { cwd: "/repo" });
  await bridge.symlink("file", "link");
  assert.equal(await bridge.readlink("link"), "file");
  assert.deepEqual(await bridge.readlink("link", "buffer"), Buffer.from("file"));
  assert.equal(await bridge.realpath("link"), "/repo/file");
  assert.equal(await bridge.readFile("/repo/file", "utf8"), "body");
  const callsBeforeEscape = fs.calls.length;
  await assert.rejects(bridge.readFile("/etc/passwd", "utf8"), { code: "EACCES" });
  assert.equal(fs.calls.length, callsBeforeEscape);
  await assert.rejects(bridge.readFile("", "utf8"), { code: "ENOENT" });
  await assert.rejects(bridge.readFile("bad\0path", "utf8"), TypeError);
});

test("rename, exclusive copies, removals, and temporary directories stay on VFS", async () => {
  const bridge = createNodeFsBridge(new StubFileSystem({ "/file": "body", "/full/child": "x" }));
  await bridge.copyFile("/file", "/copy");
  await assert.rejects(bridge.copyFile("/file", "/copy", 1), { code: "EEXIST" });
  await bridge.rename("/copy", "/renamed");
  await bridge.access("/renamed", 4);
  await bridge.rm("/renamed");
  await assert.rejects(bridge.access("/renamed"), { code: "ENOENT" });
  await assert.rejects(bridge.rmdir("/full"), { code: "ENOTEMPTY" });
  await assert.rejects(bridge.rmdir("/file"), { code: "ENOTDIR" });
  await bridge.mkdir("/empty");
  await assert.rejects(bridge.rmdir("/empty"), { code: "ENOTSUP" });
  assert.equal((await bridge.stat("/empty")).isDirectory(), true);
  const directory = await bridge.mkdtemp("/temp-");
  assert.match(directory, /^\/temp-[a-f0-9]{6}$/u);
  assert.equal((await bridge.stat(directory)).mode & 0o777, 0o700);
  await bridge.rm("/full", { recursive: true });
  await bridge.rm("/missing", { force: true });
});

test("recursive copy handles force/exclusive semantics and rejects copy-into-self", async () => {
  const bridge = createNodeFsBridge(new StubFileSystem({ "/src/nested/file": "body" }));
  await bridge.cp("/src", "/dest", { recursive: true });
  assert.equal(await bridge.readFile("/dest/nested/file", "utf8"), "body");
  await bridge.writeFile("/dest/nested/file", "keep");
  await bridge.cp("/src", "/dest", { recursive: true, force: false });
  assert.equal(await bridge.readFile("/dest/nested/file", "utf8"), "keep");
  await assert.rejects(bridge.cp("/src", "/dest", { recursive: true, force: false, errorOnExist: true }), { code: "EEXIST" });
  await assert.rejects(bridge.cp("/src", "/src/copy", { recursive: true }), { code: "EINVAL" });
  await bridge.symlink("/src", "/alias");
  await assert.rejects(bridge.cp("/src", "/alias/copy", { recursive: true }), { code: "EINVAL" });
  await assert.rejects(bridge.cp("/src", "/no-recursion"), { code: "EISDIR" });
  await assert.rejects(bridge.cp("/", "/copy-root", { recursive: true }), { code: "EINVAL" });
});

test("unsupported options and capabilities fail closed, never host-fallback", async () => {
  const bridge = createNodeFsBridge(new StubFileSystem({ "/file": "body" }));
  await assert.rejects(bridge.stat("/file", { bigint: true }), { code: "ENOTSUP" });
  await assert.rejects(bridge.writeFile("/file", "x", { flush: true }), { code: "ENOTSUP" });
  await assert.rejects(bridge.readFile("/file", { flag: "r+", encoding: "utf8" }), { code: "ENOTSUP" });
  await assert.rejects(bridge.chmod("/file", 0o600), { code: "ENOTSUP" });
  await assert.rejects(bridge.link("/file", "/hardlink"), { code: "ENOTSUP" });
  await assert.rejects(bridge.truncate("/file", 1), { code: "ENOTSUP" });
  await assert.rejects(bridge.utimes("/file", 1, 2), { code: "ENOTSUP" });
  await assert.rejects(bridge.cp("/file", "/copy", { preserveTimestamps: true }), { code: "ENOTSUP" });
  await assert.rejects(bridge.rm("/file", { maxRetries: 1 }), { code: "ENOTSUP" });
  await assert.rejects(Reflect.apply(bridge.readFile, bridge, ["/file", "buffer"]), TypeError);
  assert.equal(await bridge.readFile("/file", "utf8"), "body");
});

test("optional metadata and atomic rmdir methods retain their receiver and signal", async () => {
  const fs: NodeFsBridgeFileSystem = new StubFileSystem({ "/dir/file": "body" });
  const controller = new AbortController();
  const seen: unknown[][] = [];
  fs.chmod = async function (path, mode, options) { assert.equal(this, fs); seen.push([path, mode, options?.signal]); };
  fs.utimes = async function (path, atime, mtime, options) { assert.equal(this, fs); seen.push([path, atime, mtime, options?.signal]); };
  fs.truncate = async function (path, length, options) { assert.equal(this, fs); seen.push([path, length, options?.signal]); };
  fs.link = async function (source, target, options) { assert.equal(this, fs); seen.push([source, target, options?.signal]); };
  fs.rmdir = async function (path, options) { assert.equal(this, fs); seen.push([path, options?.signal]); };
  const bridge = createNodeFsBridge(fs, { signal: controller.signal });
  await bridge.chmod("/dir/file", "640");
  await bridge.utimes("/dir/file", "1.5", new Date(3000));
  await bridge.truncate("/dir/file", -1);
  await bridge.link("/dir/file", "/dir/hardlink");
  await bridge.mkdir("/empty");
  await bridge.rmdir("/empty");
  assert.deepEqual(seen, [
    ["/dir/file", 0o640, controller.signal],
    ["/dir/file", 1500, 3000, controller.signal],
    ["/dir/file", 0, controller.signal],
    ["/dir/file", "/dir/hardlink", controller.signal],
    ["/empty", controller.signal],
  ]);
});

test("every fs call receives the explicit host cancellation signal", async () => {
  const fs = new StubFileSystem({ "/file": "body" });
  const controller = new AbortController();
  const bridge = createNodeFsBridge(fs, { signal: controller.signal });
  await bridge.readFile("/file", "utf8");
  await bridge.stat("/file");
  await bridge.writeFile("/other", "data");
  await bridge.mkdir("/dir");
  await bridge.readdir("/");
  assert.ok(fs.calls.every((call) => call.signal === controller.signal));
  const count = fs.calls.length;
  controller.abort({ secret: "must not escape" });
  await assert.rejects(bridge.readFile("/file", "utf8"), { name: "AbortError", code: "ABORT_ERR" });
  assert.equal(fs.calls.length, count);
});

test("in-flight cancellation rejects even if a backend ignores the signal", async () => {
  const fs = new StubFileSystem();
  let notify: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { notify = resolve; });
  const controller = new AbortController();
  fs.readFile = async (_path, options) => {
    assert.equal(options?.signal, controller.signal);
    notify();
    return new Promise<Uint8Array>(() => undefined);
  };
  const pending = createNodeFsBridge(fs, { signal: controller.signal }).readFile("/slow", "utf8");
  await started;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("completed calls release cancellation links; injection never selects ambient fs", async () => {
  const fs = new StubFileSystem({ "/file": "body" });
  const host = new AbortController();
  const call = new AbortController();
  const bridge = createNodeFsBridge(fs, { signal: host.signal });
  await bridge.readFile("/file", { encoding: "utf8", signal: call.signal });
  const passed = fs.calls[0]?.signal;
  assert.ok(passed instanceof AbortSignal);
  call.abort();
  assert.equal(passed.aborted, false);
  const module = makeSafeJsFsModule((options) => createNodeFsBridge(options.adapter, options), fs);
  assert.equal(await module.readFile("/file", "utf8"), "body");
});

for (const source of ["host", "call"] as const) {
  test(`${source} cancellation reaches the adapter during an unfinished operation`, async () => {
    const host = new AbortController();
    const call = new AbortController();
    const reason = new Error(`${source} cancellation`);
    let captured: AbortSignal | undefined;
    let entered!: () => void;
    const admitted = new Promise<void>(resolve => { entered = resolve; });
    class PendingFileSystem extends StubFileSystem {
      override async readFile(_path: string, options?: { signal?: AbortSignal }): Promise<Uint8Array> {
        captured = options?.signal;
        entered();
        return new Promise((_resolve, reject) => {
          captured?.addEventListener("abort", () => reject(captured?.reason), { once: true });
        });
      }
    }
    const bridge = createNodeFsBridge(new PendingFileSystem(), { signal: host.signal });
    const pending = bridge.readFile("/file", { signal: call.signal });
    const rejection = assert.rejects(pending, { code: "ABORT_ERR" });
    await admitted;
    (source === "host" ? host : call).abort(reason);
    await rejection;
    assert.equal(captured?.aborted, true);
    assert.equal(captured?.reason, reason);
    assert.equal((source === "host" ? call : host).signal.aborted, false);
  });
}
