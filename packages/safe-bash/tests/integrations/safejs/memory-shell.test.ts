import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { createNodeFsBridge, makeSafeJsShellModule } from "../../../src/integrations/safejs/index.js";

test("memory bridge preserves symlink-before-parent resolution and trailing separators", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/outside/deep", { recursive: true });
  await fs.mkdir("/inside");
  await fs.writeFile("/outside/file", Buffer.from("outside"));
  await fs.writeFile("/inside/file", Buffer.from("inside"));
  await fs.symlink("/outside/deep", "/inside/link");
  const bridge = createNodeFsBridge(fs, { cwd: "/inside" });
  assert.equal(await bridge.readFile("link/../file", "utf8"), "outside");
  assert.equal(await bridge.readFile("/inside/link/../file", "utf8"), "outside");
  await assert.rejects(bridge.stat("file/"), { code: "ENOTDIR" });
  await assert.rejects(bridge.stat("missing/../file"), { code: "ENOENT" });
  await fs.mkdir("/outside/tree/child", { recursive: true });
  await fs.writeFile("/outside/tree/child/file", Buffer.from("nested"));
  assert.deepEqual(await bridge.readdir("link/../tree", { recursive: true }), ["child", "child/file"]);
  await bridge.cp("link/../tree", "/copy", { recursive: true });
  assert.equal(await bridge.readFile("/copy/child/file", "utf8"), "nested");
});

test("memory metadata, hardlinks, and truncate operate through the bridge", async () => {
  const fs = new MemoryFileSystem();
  const bridge = createNodeFsBridge(fs);
  await bridge.writeFile("/file", "hello", { mode: 0o640 });
  assert.equal((await bridge.stat("/file")).mode & 0o777, 0o640);
  await bridge.link("/file", "/alias");
  await bridge.truncate("/alias", 2);
  assert.equal(await bridge.readFile("/file", "utf8"), "he");
  await bridge.chmod("/alias", "600");
  await bridge.utimes("/file", 1.5, new Date(3000));
  const stats = await bridge.stat("/file");
  assert.equal(stats.mode & 0o777, 0o600);
  assert.equal(stats.atimeMs, 1500);
  assert.equal(stats.mtimeMs, 3000);
  assert.equal(stats.nlink, 2);
});

test("concrete Shell accepts the structural adapter and uses its exact VFS for pipes and redirection", { timeout: 3000 }, async () => {
  const fs = new MemoryFileSystem();
  const otherFs = new MemoryFileSystem();
  const shell = new Shell({ fs: otherFs });
  shell.register({
    name: "relay",
    async execute(context) {
      assert.equal(context.fs, fs);
      for await (const bytes of context.stdin) await context.stdout.write(bytes);
      return { exitCode: 0 };
    },
  });
  const controller = new AbortController();
  const module = makeSafeJsShellModule(shell, {
    fs, signal: controller.signal, replayPolicy: "read-side-effect", declareHostOperation: (operation) => operation,
  });
  const bridge = createNodeFsBridge(fs, { signal: controller.signal });
  await bridge.writeFile("/input", "shared content");
  const result = await module.exec("relay < /input | relay > /output");
  assert.equal(result.exitCode, 0);
  assert.equal(await bridge.readFile("/output", "utf8"), "shared content");
  assert.deepEqual(Object.keys(result), ["stdout", "stderr", "exitCode"]);
  await assert.rejects(otherFs.stat("/output"), { code: "ENOENT" });
});
