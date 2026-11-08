import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts";
import { bindFileOutputBudget } from "safe-bash-contracts/filesystem-output";
import { createXmllintCommand } from "./index.js";

for (const scenario of ["success", "cancel", "write", "limit", "replace", "finish", "publish", "acquire-cancel"] as const)
test(`XML file output streams into retained staging (${scenario})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("output interrupted");
  const encoder = new TextEncoder();
  await fs.writeFile("/target", encoder.encode("original"));
  await fs.link("/target", "/hardlink");
  await fs.symlink("/target", "/alias");
  const original = await fs.stat("/target");
  let writes = 0, outstanding = 0, published = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "writeFile" || key === "readFile") return () => assert.fail("output must not materialize a complete file");
    if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
      const staged = await fs.createStagedFile(...args), writer = staged.writer!;
      if (scenario === "acquire-cancel") controller.abort(failure);
      return { ...staged, cleanup: { ...staged.cleanup!, async remove() { assert.equal(outstanding, 0, "retire only after the active write settles"); await staged.cleanup!.remove(); } }, writer: { ...writer, async finish(options: Parameters<typeof writer.finish>[0]) { if (scenario === "finish") throw failure; return writer.finish(options); }, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        assert.ok(bytes.length <= 16384); assert.equal(++outstanding, 1);
        try {
          await Promise.resolve(); writes++;
          if (scenario === "write") throw failure;
          if (scenario === "cancel") { controller.abort(failure); await new Promise<void>(resolve => setImmediate(resolve)); }
          await writer.write(bytes, options);
        } finally { outstanding--; }
      } } };
    };
    if (key === "publishStagedFile") return async (...args: Parameters<typeof fs.publishStagedFile>) => {
      published++;
      if (scenario === "publish") throw failure;
      if (scenario === "replace") { await fs.unlink("/alias"); await fs.symlink("/hardlink", "/alias"); }
      return fs.publishStagedFile(...args);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const input = encoder.encode(`<x>${"a".repeat(16384)}</x>`);
  const context: CommandContext = { command: "xmllint", ...createCommandArguments(["--output", "/alias"]),
    fs: injected, cwd: "/", env: {}, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() { yield encoder.encode("<r>"); for (let i = 0; i < 80; i++) yield input; yield encoder.encode("</r>"); } },
    stdout: { async write() { assert.fail("unexpected stdout"); } }, stderr: { async write() {} },
  };
  const result = Promise.resolve(createXmllintCommand({ limits: scenario === "limit" ? { maxOutputBytes: 40000 } : {} }).execute(context));
  if (["cancel", "write", "finish", "publish", "acquire-cancel"].includes(scenario)) await assert.rejects(result, error => error === failure);
  else assert.equal((await result).exitCode, scenario === "success" ? 0 : scenario === "limit" ? 5 : 6);
  assert.equal(outstanding, 0);
  assert.ok(scenario === "acquire-cancel" ? writes === 0 : writes > 0, "generated output must use retained staging writes");
  const target = await fs.readFile("/target");
  if (scenario === "success") {
    assert.ok(target.length > 1024 * 1024);
    assert.deepEqual(await fs.readFile("/hardlink"), target);
    assert.equal((await fs.stat("/target")).ino, original.ino);
    assert.equal(published, 1);
  } else assert.equal(new TextDecoder().decode(target), "original");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["alias", "hardlink", "target"]);
});

for (const scenario of ["success", "limit", "spill-error", "shell-limit"] as const)
test(`XML file output replays bounded caller-backed pages without staging (${scenario})`, async () => {
  const fs = createMemoryFileSystem(), encoder = new TextEncoder(), failure = new Error("spill failed");
  await fs.writeFile("/target", encoder.encode("original"));
  let spilled = 0, published = 0, outstanding = 0;
  const capabilities = { ...fs.capabilities, atomicFileStaging: false };
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "capabilities") return capabilities;
    if (key === "capabilitiesFor") return async () => capabilities;
    if (key === "readFile" || key === "writeFile") return () => assert.fail("no complete-file I/O");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...values: Parameters<typeof handle.write>) => {
          assert.ok(values[0].length <= 16384);
          spilled += values[0].length;
          if (scenario === "spill-error") throw failure;
          return handle.write(...values);
        };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    if (key === "writeStream") return async (path: string, source: Parameters<typeof fs.writeStream>[1], options: Parameters<typeof fs.writeStream>[2]) => {
      published++;
      await fs.writeStream(path, (async function* () {
        for await (const bytes of source) {
          assert.ok(bytes.length <= 16384); assert.equal(++outstanding, 1);
          try { await Promise.resolve(); yield bytes; } finally { outstanding--; }
        }
      })(), options);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const cleanups: (() => void | Promise<void>)[] = [];
  const registerCleanup = (cleanup: () => void | Promise<void>): void => { cleanups.push(cleanup); };
  let admitted = 0;
  bindFileOutputBudget({ registerCleanup }, sink => ({ async write(bytes) {
    if (scenario === "shell-limit" && admitted + bytes.length > 100000) throw failure;
    admitted += bytes.length; await sink.write(bytes);
  } }));
  const result = Promise.resolve(createXmllintCommand({ limits: scenario === "limit" ? { maxOutputBytes: 100000 } : {} }).execute({
    registerCleanup,
    command: "xmllint", ...createCommandArguments(["--output", "/target"]), cwd: "/", env: {}, fs: injected,
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {
      yield encoder.encode("<r>"); const bytes = encoder.encode(`<x>${"a".repeat(16384)}</x>`);
      for (let index = 0; index < 20; index++) yield bytes;
      yield encoder.encode("</r>");
    } }, stdout: { async write() { assert.fail(); } }, stderr: { async write() {} },
  }));
  if (scenario === "spill-error" || scenario === "shell-limit") await assert.rejects(result, error => error === failure);
  else if (scenario === "success") { assert.equal((await result).exitCode, 0); assert.equal(admitted, (await fs.stat("/target")).size); }
  else assert.equal((await result).exitCode, 5);
  for (const cleanup of cleanups.reverse()) await cleanup();
  assert.ok(spilled >= 16384);
  assert.equal(outstanding, 0);
  assert.equal(published, scenario === "success" ? 1 : 0);
  if (scenario === "success") assert.ok((await fs.readFile("/target")).length > 300000);
  else assert.equal(new TextDecoder().decode(await fs.readFile("/target")), "original");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["target"]);
});
