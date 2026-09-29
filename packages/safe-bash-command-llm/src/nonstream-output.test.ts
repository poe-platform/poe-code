import assert from "node:assert/strict";
import test from "node:test";
import { DeviceFileSystem, MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";

test("explicit nonstream output withholds partial provider text on failure", async () => {
  const command = createLlmCommand({ defaultModel: "model", providers: [{ name: "fixture", models: [{ id: "model" }], async *complete() { yield "partial"; throw new Error("provider failed"); } }] });
  for (const noStream of [false, true]) {
    const chunks: Uint8Array[] = [];
    const fs = new MemoryFileSystem();
    const result = await command.execute({ command: "llm", args: ["test", ...(noStream ? ["--no-stream"] : [])], fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write(chunk) { chunks.push(chunk.slice()); } }, stderr: { async write() {} } });
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.concat(chunks).toString(), noStream ? "" : "partial");
    assert.deepEqual(await fs.readdir("/"), []);
  }
});


test("nonstream output uses caller retained storage with bounded writes and reads", async () => {
  const backing = new MemoryFileSystem();
  let stages = 0, largestWrite = 0, largestRead = 0, output = 0;
  const fs = new Proxy(backing, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<typeof backing.createStagedFile>) => {
      stages++;
      const staged = await target.createStagedFile(...args);
      const writer = staged.writer!;
      return { ...staged, writer: {
        async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
          largestWrite = Math.max(largestWrite, bytes.byteLength);
          await writer.write(bytes, options);
        }, finish: writer.finish.bind(writer),
      } };
    };
    if (key === "readFile") return async (...args: Parameters<typeof backing.readFile>) => {
      assert.ok(!args[0].includes(".llm-output-"), "spool must not be loaded whole");
      return target.readFile(...args);
    };
    if (key === "openReadFile") return async (...args: Parameters<typeof backing.openReadFile>) => {
      const reader = await target.openReadFile(...args);
      return { stat: reader.stat.bind(reader), close: reader.close.bind(reader),
        async read(position: number, maxBytes: number, options: Parameters<typeof reader.read>[2]) {
          largestRead = Math.max(largestRead, maxBytes);
          return reader.read(position, maxBytes, options);
        },
      };
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const command = createLlmCommand({ defaultModel: "model", providers: [{
    name: "fixture", models: [{ id: "model" }], async *complete() {
      for (let i = 0; i < 16; i++) yield "x".repeat(65536);
    },
  }] });
  const result = await command.execute({ command: "llm", args: ["test", "--no-stream"], fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { assert.ok(bytes.byteLength <= 16384); output += bytes.byteLength; } },
    stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(output, 16 * 65536 + 1);
  assert.equal(stages, 1);
  assert.ok(largestWrite > 0 && largestWrite <= 16384);
  assert.ok(largestRead > 0 && largestRead <= 16384);
  assert.deepEqual(await backing.readdir("/"), []);
});


test("spool cancellation retires a retained reader acquired after cleanup", async () => {
  const { createLlmOutputSpool } = await import("./output-spool.js");
  const backing = new MemoryFileSystem();
  const controller = new AbortController();
  let entered!: () => void, release!: () => void, closes = 0;
  const opening = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const fs = new Proxy(backing, { get(target, key) {
    if (key === "openReadFile") return async (...args: Parameters<typeof backing.openReadFile>) => {
      const reader = await target.openReadFile(...args);
      entered(); await barrier;
      return { stat: reader.stat.bind(reader), read: reader.read.bind(reader),
        async close() { closes++; await reader.close(); },
      };
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const spool = await createLlmOutputSpool(fs, "/", controller.signal);
  await spool.write(Uint8Array.of(1, 2));
  const pending = spool.replay()[Symbol.asyncIterator]().next();
  await opening;
  controller.abort(new Error("cancelled"));
  await spool.close(); release();
  await assert.rejects(pending, /cancelled|closed/);
  assert.equal(closes, 1);
  assert.deepEqual(await backing.readdir("/"), []);
});


test("nonstream output stages beneath a device-aware root directory", async () => {
  const fs = new DeviceFileSystem(new MemoryFileSystem());
  const initialEntries = await fs.readdir("/");
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const command = createLlmCommand({ defaultModel: "model", providers: [{
    name: "fixture", models: [{ id: "model" }], async *complete() { yield "answer"; },
  }] });
  const result = await command.execute({ command: "llm", args: ["test", "--no-stream"], fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write(bytes) { errors.push(bytes.slice()); } },
  });
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.equal(Buffer.concat(output).toString(), "answer\n");
  assert.deepEqual(await fs.readdir("/"), initialEntries);
});
