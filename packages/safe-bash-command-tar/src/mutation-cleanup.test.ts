import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext, type FileSystem } from "safe-bash-contracts";
import { createTarCommand } from "./index.js";

async function run(fs: FileSystem, args: string[], registerCleanup?: CommandContext["registerCleanup"]) {
  const values = createCommandArguments(args);
  let stderr = "";
  const result = await createTarCommand().execute({
    command: "tar", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
    stdin: toByteSource(""), stdout: { async write() {} },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
    ...(registerCleanup ? { registerCleanup } : {}),
  });
  return { ...result, stderr };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const timing of ["acquire", "write"] as const) test(`tar mutation registered cleanup drains ${timing} before removing staging`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array(4096).fill(42));
  assert.equal((await run(fs, ["-cf", "/archive.tar", "a"])).exitCode, 0);
  const original = await fs.readFile("/archive.tar");
  const reached = deferred();
  const release = deferred();
  const callbacks: Array<() => void | Promise<void>> = [];
  let removed = 0, acquired = 0;
  let busy = false;
  const view = new Proxy(fs, { get(target, property) {
    if (property === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      const stage = await fs.createStagedFile!(...args);
      acquired++;
      const pause = async () => { busy = true; reached.resolve(); await release.promise; busy = false; };
      if (timing === "acquire") await pause();
      return { ...stage, cleanup: { async remove() {
        assert.equal(busy, false, "removed staging with admitted work still in flight");
        removed++;
        await stage.cleanup!.remove();
      } }, writer: { ...stage.writer!, async write(...args: Parameters<NonNullable<typeof stage.writer>["write"]>) {
        if (timing === "write") await pause();
        return stage.writer!.write(...args);
      } } };
    };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = run(view, ["-rf", "/archive.tar", "a"], cleanup => { callbacks.push(cleanup); });
  await reached.promise;
  if (!callbacks.length) { release.resolve(); await result; assert.fail("mutation did not register cleanup before acquisition"); }
  const cleanup = callbacks[0]!();
  assert.ok(cleanup instanceof Promise);
  assert.equal(callbacks[0]!(), cleanup, "concurrent cleanup must share completion");
  let cleaned = false;
  void cleanup.then(() => { cleaned = true; });
  await Promise.resolve();
  assert.equal(cleaned, false);
  assert.equal(removed, 0);
  release.resolve();
  await cleanup;
  assert.equal((await result).exitCode, 2);
  assert.equal(removed, acquired, "every admitted stage is removed exactly once");
  assert.deepEqual(await fs.readFile("/archive.tar"), original);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["a", "archive.tar"]);
});

for (const prefix of [[31, 139], [66, 90, 104], [253, 55, 122, 88, 90, 0]]) test(`tar mutation diagnoses compressed input ${prefix[0]}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/archive.tar", Uint8Array.from([...prefix, ...new Array<number>(1024).fill(0)]));
  const original = await fs.readFile("/archive.tar");
  const result = await run(fs, ["--delete", "-f", "/archive.tar", "a"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /cannot modify compressed archives/);
  assert.deepEqual(await fs.readFile("/archive.tar"), original);
});
