import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceSnapshot } from "./handler-preparation.js";
import type { OpPreparedHandler } from "./handler-preparation.js";
import type { OpCommandContext } from "./cli.js";
import type { OpBackendRequest } from "./types.js";
import { createSecretHandlers } from "./secrets.js";
import { createDocumentHandlers } from "./documents.js";
import { createItemHandlers } from "./items.js";
import { createEnvironmentHandlers } from "./environment-commands.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

function context(overrides: Partial<OpCommandContext> = {}): OpCommandContext {
  return {
    args: [], env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() { assert.fail("unexpected output"); } },
    stderr: { async write() { assert.fail("unexpected error output"); } },
    ...overrides,
  };
}

function request(resource: string, action: string, args: string[], flags: OpBackendRequest["flags"] = {}): OpBackendRequest {
  return Object.freeze({ resource, action, args: Object.freeze([...args]), flags: Object.freeze({ ...flags }) });
}

test("independent: run captures env argv and host callbacks before asynchronous acquisition", async () => {
  const entered = deferred<void>();
  const acquired = deferred<Uint8Array>();
  const originalBytes = Buffer.from("TOKEN=op://vault/item/password\n");
  const originalArgs = ["child", "--password=synthetic-argument"];
  const calls: OpBackendRequest[] = [];
  let reads = 0;
  let launched: { command: string; args: readonly string[]; env: Readonly<Record<string, string>> } | undefined;
  const source = context({
    args: originalArgs, env: { INHERITED: "synthetic-before" },
    async readFile() { reads++; entered.resolve(); return acquired.promise; },
    async invoke(command, args, options) { launched = { command, args, env: options.env }; return { exitCode: 0 }; },
  });
  const handler = createSecretHandlers({ async execute(value) { calls.push(value); return "synthetic-resolved"; } }).run as OpPreparedHandler;
  const outer = request("run", "", originalArgs, { "env-file": ["env"] });
  const pending = handler.prepare(outer, source);
  await Promise.race([entered.promise, pending.then(() => assert.fail("preparation ended before acquisition"))]);
  source.env.INHERITED = "synthetic-after";
  originalArgs[0] = "other-child";
  originalArgs[1] = "unapproved-argument";
  source.readFile = async () => { assert.fail("replaced reader"); };
  source.invoke = async () => { assert.fail("replaced invocation"); };
  acquired.resolve(originalBytes);
  const prepared = await pending;
  assert.equal(calls.length, 0);
  const effects = prepared.complete([{}]);
  for (const marker of ["synthetic-before", "synthetic-argument", "synthetic-resolved"]) assert.equal(JSON.stringify(effects).includes(marker), false);
  assert.equal(effects[0]?.argumentCount, 1);
  originalBytes.fill(120);
  await handler(outer, prepared.context);
  assert.deepEqual(launched, { command: "child", args: ["--password=synthetic-argument"], env: { INHERITED: "synthetic-before", TOKEN: "synthetic-resolved" } });
  assert.deepEqual(calls, prepared.requests);
  assert.equal(reads, 1);
});

test("independent: stdin snapshot owns Buffer views before requesting another chunk", async () => {
  const backing = Buffer.from([99, 0, 255, 65, 99]);
  const chunk = backing.subarray(1, 4);
  let iterations = 0;
  const source = createSourceSnapshot(context({ stdin: {
    async *[Symbol.asyncIterator]() {
      iterations++;
      yield chunk;
      backing.fill(7);
      yield Buffer.from([10]);
    },
  } }));
  const first = await source.input();
  assert.deepEqual(first, new Uint8Array([0, 255, 65, 10]));
  first.fill(8);
  for (let repeat = 0; repeat < 2; repeat++) {
    const replay: number[] = [];
    for await (const bytes of source.context.stdin) { replay.push(...bytes); bytes.fill(9); }
    assert.deepEqual(replay, [0, 255, 65, 10]);
  }
  assert.equal(iterations, 1);
});

test("independent: execution cannot acquire uncached files or mutate cached binary input", async () => {
  let reads = 0;
  const source = createSourceSnapshot(context({ async readFile(path) {
    reads++;
    assert.equal(path, "literal.bin");
    return Buffer.from([0, 255, 128, 10]).subarray(1);
  } }));
  await assert.rejects(source.context.readFile!("literal.bin"), { message: "Unplanned file acquisition" });
  assert.equal(reads, 0);
  const acquired = await source.file("literal.bin");
  acquired.fill(1);
  const replay = await source.context.readFile!("literal.bin");
  assert.deepEqual(replay, new Uint8Array([255, 128, 10]));
  replay.fill(2);
  assert.deepEqual(await source.context.readFile!("literal.bin"), new Uint8Array([255, 128, 10]));
  await assert.rejects(source.context.readFile!("other.bin"), { message: "Unplanned file acquisition" });
  assert.equal(reads, 1);
});

test("independent: binary document output preserves exact bytes and approved file options", async () => {
  let backendCalls = 0;
  const writes: { path: string; bytes: Uint8Array; mode?: number; overwrite?: boolean }[] = [];
  const binary = Buffer.from([0, 255, 128, 10]);
  const handler = createDocumentHandlers({ async execute() { backendCalls++; return binary; } })["document get"] as OpPreparedHandler;
  const outer = request("document", "get", ["synthetic"], { "out-file": "literal.bin", "file-mode": "0640", force: true, encoding: "gbk" });
  const prepared = await handler.prepare(outer, context({ async writeFile(path, bytes, options) { writes.push({ path, bytes, ...options }); } }));
  assert.equal(backendCalls, 0);
  await assert.rejects(prepared.context.writeFile!("literal.bin", binary, { mode: 0o640, overwrite: true }), { message: "Preparation is incomplete" });
  prepared.complete([{}]);
  await assert.rejects(prepared.context.writeFile!("other.bin", binary, { mode: 0o640, overwrite: true }), { message: "Unplanned file output" });
  await assert.rejects(prepared.context.writeFile!("literal.bin", binary, { mode: 0o600, overwrite: true }), { message: "Unplanned file output" });
  await handler(outer, prepared.context);
  binary.fill(3);
  assert.deepEqual(writes, [{ path: "literal.bin", bytes: new Uint8Array([0, 255, 128, 10]), mode: 0o640, overwrite: true }]);
  assert.equal(backendCalls, 1);
});

test("independent: prepared item templates and attachment sources replay without fresh acquisition", async () => {
  const files = new Map([
    ["template.json", Buffer.from(JSON.stringify({ title: "Synthetic", category: "LOGIN", fields: [{ id: "password", type: "CONCEALED", value: "synthetic-template-secret" }] }))],
    ["attachment.bin", Buffer.from([0, 255, 4])],
  ]);
  const reads: string[] = [];
  const calls: OpBackendRequest[] = [];
  const source = context({ stdout: { async write() {} }, async readFile(path) { reads.push(path); return files.get(path)!; } });
  const handler = createItemHandlers({ async execute(value) { calls.push(value); return { id: "created" }; } })["item create"] as OpPreparedHandler;
  const outer = request("item", "create", ["Docs.payload[file]=attachment.bin"], { template: "template.json" });
  const prepared = await handler.prepare(outer, source);
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(prepared.effects).includes("synthetic-template-secret"), false);
  const captured = structuredClone(prepared.requests);
  prepared.complete([{}]);
  for (const bytes of files.values()) bytes.fill(88);
  await handler(outer, prepared.context);
  assert.deepEqual(calls, captured);
  assert.deepEqual(reads, ["template.json", "attachment.bin"]);
});

test("independent: literal inject templates preserve quotes newlines and Unicode through replay", async () => {
  const literal = 'literal "quoted"\nUnicode: λ\n';
  const bytes = Buffer.from(literal);
  let reads = 0;
  let output = "";
  const handler = createSecretHandlers({ async execute() { assert.fail("literal template must not fetch backend values"); } }).inject as OpPreparedHandler;
  const outer = request("inject", "", [], { "in-file": "literal" });
  const prepared = await handler.prepare(outer, context({ async readFile() { reads++; return bytes; }, stdout: { async write(data) { output += Buffer.from(data); } } }));
  assert.equal(prepared.requests.length, 0);
  prepared.complete([]);
  bytes.fill(0);
  await handler(outer, prepared.context);
  assert.equal(output, literal);
  assert.equal(reads, 1);
});

test("independent: complete snapshot restoration manifests only final set and unset names", async () => {
  const handler = createEnvironmentHandlers({ async execute() { assert.fail("preparation must not fetch snapshots"); } })["environment snapshot restore"] as OpPreparedHandler;
  const prepared = await handler.prepare(request("environment snapshot", "restore", ["snapshot", "child", "synthetic-private-argument"]), context({ env: { DROP: "synthetic-private-value", KEEP: "old" } }));
  const effects = prepared.complete([{ environment: { names: ["KEEP", "ABSENT"], unsetNames: ["ABSENT"], scope: "complete", dependenciesComplete: true } }]);
  assert.deepEqual(effects[0]?.environmentNames, ["KEEP"]);
  assert.deepEqual(effects[0]?.unsetNames, ["ABSENT", "DROP"]);
  assert.equal(effects[0]?.masking, true);
  assert.equal(effects[0]?.argumentCount, 1);
  assert.equal(JSON.stringify(effects).includes("synthetic-private"), false);
});

test("independent: aborted acquisition never starts a later source or backend operation", async () => {
  const entered = deferred<void>();
  const release = deferred<Uint8Array>();
  const controller = new AbortController();
  const reads: string[] = [];
  const handler = createSecretHandlers({ async execute() { assert.fail("backend must not execute"); } }).run as OpPreparedHandler;
  const pending = handler.prepare(request("run", "", ["child"], { "env-file": ["first", "second"] }), context({ signal: controller.signal, async readFile(path) { reads.push(path); entered.resolve(); return release.promise; } }));
  await Promise.race([entered.promise, pending.then(() => assert.fail("preparation ended before acquisition"))]);
  controller.abort();
  await assert.rejects(pending);
  release.resolve(Buffer.from("TOKEN=synthetic"));
  assert.deepEqual(reads, ["first"]);
});
