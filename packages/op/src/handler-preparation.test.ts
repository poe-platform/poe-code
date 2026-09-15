import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandlerPreparation, createSourceSnapshot } from "./handler-preparation.js";
import type { OpCommandContext } from "./cli.js";
import { createSecretHandlers } from "./secrets.js";
import { createItemHandlers } from "./items.js";
import { createDocumentHandlers } from "./documents.js";
import { createEnvironmentHandlers } from "./environment-commands.js";
import type { OpPreparedHandler } from "./handler-preparation.js";
import type { OpBackendRequest } from "./types.js";

function context(overrides: Partial<OpCommandContext> = {}): OpCommandContext {
  return { args: [], env: {}, signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} }, ...overrides };
}

test("prepared sources detach caller bytes and replay without reading the host twice", async () => {
  const bytes = new Uint8Array([1, 2]);
  let reads = 0;
  let streams = 0;
  const source = context({ readFile: async () => { reads++; return bytes; }, stdin: { async *[Symbol.asyncIterator]() { streams++; yield bytes; } } });
  const prepared = createSourceSnapshot(source);
  await prepared.file("input");
  await prepared.file("input");
  await prepared.input();
  bytes.fill(9);
  assert.deepEqual(await prepared.context.readFile!("input"), new Uint8Array([1, 2]));
  const replay: number[] = [];
  for await (const chunk of prepared.context.stdin) replay.push(...chunk);
  assert.deepEqual(replay, [1, 2]);
  assert.equal(reads, 1);
  assert.equal(streams, 1);
  await assert.rejects(prepared.context.readFile!("unplanned"), /Unplanned/);
});

test("preparation copies env and observes cancellation before source acquisition", async () => {
  const controller = new AbortController();
  let reads = 0;
  const source = context({ env: { KEY: "before" }, signal: controller.signal, readFile: async () => { reads++; return new Uint8Array(); } });
  const prepared = createSourceSnapshot(source);
  source.env.KEY = "after";
  assert.equal(prepared.context.env.KEY, "before");
  controller.abort();
  await assert.rejects(prepared.file("input"));
  assert.equal(reads, 0);
});

const forbiddenBackend = { async execute(): Promise<never> { throw new Error("Preparation fetched a secret"); } };
const request = (resource: string, action = "", args: string[] = [], flags: OpBackendRequest["flags"] = {}): OpBackendRequest => ({ resource, action, args, flags });

test("read and inject prepare every reference without executing the backend", async () => {
  const handlers = createSecretHandlers(forbiddenBackend);
  const direct = await (handlers.read as OpPreparedHandler).prepare(request("read", "", ["op://vault/item/password"]), context());
  assert.deepEqual(direct.requests.map(value => value.args), [["op://vault/item/password"]]);
  let reads = 0;
  const prepared = await (handlers.inject as OpPreparedHandler).prepare(request("inject", "", [], { "in-file": "template" }), context({ env: { ITEM: "item" }, readFile: async () => { reads++; return new TextEncoder().encode("{{ op://vault/$ITEM/password }} op://vault/second/password"); } }));
  assert.deepEqual(prepared.requests.map(value => value.args), [["op://vault/item/password"], ["op://vault/second/password"]]);
  await prepared.context.readFile!("template");
  assert.equal(reads, 1);
});

test("item and document preparation pin the exact binary mutation input", async () => {
  const bytes = new Uint8Array([0, 255, 3]);
  const source = context({ readFile: async () => bytes });
  const item = await (createItemHandlers(forbiddenBackend)["item create"] as OpPreparedHandler).prepare(request("item", "create", ["attachment[file]=file"]), source);
  const document = await (createDocumentHandlers(forbiddenBackend)["document create"] as OpPreparedHandler).prepare(request("document", "create", ["file"]), source);
  bytes.fill(7);
  assert.deepEqual((document.requests[0]!.input as { content: Uint8Array }).content, new Uint8Array([0, 255, 3]));
  assert.deepEqual((item.requests[0]!.input as { files: { content: Uint8Array }[] }).files[0]!.content, new Uint8Array([0, 255, 3]));
});

test("run snapshots dotenv and nested references, requiring metadata for Environment dependencies", async () => {
  const run = createSecretHandlers(forbiddenBackend).run as OpPreparedHandler;
  const prepared = await run.prepare(request("run", "", ["child"], { "env-file": ["vars"] }), context({ invoke: async () => ({ exitCode: 0 }), readFile: async () => new TextEncoder().encode("TOKEN=op://vault/item/password") }));
  assert.deepEqual(prepared.requests.map(value => value.args), [["op://vault/item/password"]]);
  assert.deepEqual(prepared.effects[0]!.environmentNames, ["TOKEN"]);
  const environment = await run.prepare(request("run", "", ["child"], { environment: ["env"] }), context({ invoke: async () => ({ exitCode: 0 }) }));
  assert.throws(() => environment.complete([{}]), /metadata/);
  assert.deepEqual(environment.complete([{ environment: { names: ["TOKEN"], dependenciesComplete: true } }])[0]!.environmentNames, ["TOKEN"]);
});

test("snapshot create privately pins values and restore requires value-free key metadata", async () => {
  const handlers = createEnvironmentHandlers(forbiddenBackend);
  const source = context({ env: { TOKEN: "private" } });
  const create = await (handlers["environment snapshot create"] as OpPreparedHandler).prepare(request("environment snapshot", "create", ["saved"], { vars: ["TOKEN", "ABSENT"] }), source);
  source.env.TOKEN = "changed";
  assert.equal((create.requests[0]!.input as { snapshot: { variables: Record<string, unknown> } }).snapshot.variables.TOKEN, "private");
  assert.deepEqual(create.effects[0]!.environmentNames, ["TOKEN", "ABSENT"]);
  assert.deepEqual(create.effects[0]!.unsetNames, ["ABSENT"]);
  const restore = await (handlers["environment snapshot restore"] as OpPreparedHandler).prepare(request("environment snapshot", "restore", ["saved"], { shell: "sh" }), source);
  assert.throws(() => restore.complete([{}]), /metadata/);
  const effects = restore.complete([{ environment: { names: ["TOKEN", "ABSENT"], unsetNames: ["ABSENT"], scope: "selected", dependenciesComplete: true } }]);
  assert.deepEqual(effects[0]!.unsetNames, ["ABSENT"]);
  assert.equal(JSON.stringify(effects).includes("private"), false);
});

test("prepared execution guards destinations and child intent and captures sink methods", async () => {
  let writes = 0;
  let invokes = 0;
  const source = context({ stdout: { async write() { writes++; } }, writeFile: async () => { writes++; }, invoke: async () => { invokes++; return { exitCode: 0 }; } });
  const snapshot = createSourceSnapshot(source);
  const prepared = createHandlerPreparation([], snapshot.context, [{ kind: "invoke", command: "child", args: ["fixed"], environmentNames: ["TOKEN"] }]);
  prepared.complete([]);
  source.stdout.write = async () => { throw new Error("Replaced sink"); };
  await prepared.context.stdout.write(new Uint8Array());
  await assert.rejects(prepared.context.writeFile!("unplanned", new Uint8Array()), /Unplanned/);
  await assert.rejects(prepared.context.invoke!("other", ["fixed"], { env: { TOKEN: "value" } }), /Unplanned/);
  await assert.rejects(prepared.context.invoke!("child", ["fixed"], { env: { EXTRA: "value" } }), /Unplanned/);
  await prepared.context.invoke!("child", ["fixed"], { env: { TOKEN: "value" } });
  assert.equal(writes, 1);
  assert.equal(invokes, 1);
});

test("prepared handler execution uses owned sources and the same planned mutation", async () => {
  const seen: OpBackendRequest[] = [];
  const handler = createDocumentHandlers({ async execute(value) { seen.push(value); return { id: "document" }; } })["document create"] as OpPreparedHandler;
  const bytes = new Uint8Array([0, 255]);
  let reads = 0;
  const outer = request("document", "create", ["file"]);
  const prepared = await handler.prepare(outer, context({ readFile: async () => { reads++; return bytes; } }));
  prepared.complete([{}]);
  bytes.fill(8);
  await handler(outer, prepared.context);
  assert.deepEqual(seen, prepared.requests);
  assert.equal(reads, 1);
});

test("approval effects omit child argument values and deeply freeze display intent", async () => {
  const prepared = await (createSecretHandlers(forbiddenBackend).run as OpPreparedHandler).prepare(request("run", "", ["child", "--password=synthetic-private"]), context());
  const effects = prepared.complete([]);
  assert.equal(JSON.stringify(effects).includes("synthetic-private"), false);
  assert.equal(effects[0]!.argumentCount, 1);
  assert.ok(Object.isFrozen(effects[0]!.environmentNames));
});

test("inject reuses captured template after approval and plans duplicate references in order", async () => {
  let source = "{{ op://vault/item/password }} {{ op://vault/item/password }}";
  let reads = 0;
  const requests: OpBackendRequest[] = [];
  let output = "";
  const handler = createSecretHandlers({ async execute(value) { requests.push(value); return "resolved"; } }).inject as OpPreparedHandler;
  const outer = request("inject", "", [], { "in-file": "template", session: "session", account: "account" });
  const prepared = await handler.prepare(outer, context({ readFile: async () => { reads++; return new TextEncoder().encode(source); }, stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } } }));
  prepared.complete([{}, {}]);
  source = "op://vault/other/password";
  await handler(outer, prepared.context);
  assert.equal(output, "resolved resolved");
  assert.deepEqual(requests, prepared.requests);
  assert.equal(reads, 1);
});

test("run pins file contents, inherited env and invocation arguments across approval", async () => {
  let bytes = new TextEncoder().encode("TOKEN=op://vault/item/password");
  let reads = 0;
  let invoked: Readonly<Record<string, string>> | undefined;
  const source = context({ env: { INHERITED: "before" }, readFile: async () => { reads++; return bytes; }, invoke: async (_command, _args, options) => { invoked = options.env; return { exitCode: 0 }; } });
  const handler = createSecretHandlers({ async execute() { return "secret"; } }).run as OpPreparedHandler;
  const outer = request("run", "", ["child"], { "env-file": ["vars", "vars"] });
  const prepared = await handler.prepare(outer, source);
  prepared.complete([{}]);
  bytes = new TextEncoder().encode("TOKEN=op://vault/other/password");
  source.env.INHERITED = "after";
  await handler(outer, prepared.context);
  assert.deepEqual(invoked, { INHERITED: "before", TOKEN: "secret" });
  assert.equal(reads, 1);
});

test("secret-dependent environment selectors fail before execution rather than guessing", async () => {
  const handler = createSecretHandlers(forbiddenBackend).run as OpPreparedHandler;
  const prepared = await handler.prepare(request("run", "", ["child"], { environment: ["remote"] }), context({ env: { SELECTOR: "before", TOKEN: "op://vault/$SELECTOR/password" } }));
  assert.throws(() => prepared.complete([{ environment: { names: ["SELECTOR"], dependenciesComplete: true } }, {}]), /Secret-dependent/);
});

test("aborted pending preparation settles and never starts a second acquisition", async () => {
  const controller = new AbortController();
  let resolve!: (value: Uint8Array) => void;
  let reads = 0;
  const source = createSourceSnapshot(context({ signal: controller.signal, readFile: async () => { reads++; return new Promise(complete => { resolve = complete; }); } }));
  const pending = source.file("input");
  controller.abort();
  await assert.rejects(pending);
  resolve(new Uint8Array([1]));
  await assert.rejects(source.file("second"));
  assert.equal(reads, 1);
});

test("Environment overlays cannot silently discard planned secret dependencies", async () => {
  const handler = createSecretHandlers(forbiddenBackend).run as OpPreparedHandler;
  const prepared = await handler.prepare(request("run", "", ["child"], { environment: ["remote"] }), context({ env: { TOKEN: "op://vault/item/password" } }));
  assert.throws(() => prepared.complete([{ environment: { names: ["TOKEN"], dependenciesComplete: true } }, {}]), /overrides a planned/);
});

test("document stdin is consumed once and remains binary through prepared execution", async () => {
  let streams = 0;
  const bytes = new Uint8Array([0, 255, 1]);
  const seen: OpBackendRequest[] = [];
  const handler = createDocumentHandlers({ async execute(value) { seen.push(value); return { id: "document" }; } })["document create"] as OpPreparedHandler;
  const outer = request("document", "create");
  const prepared = await handler.prepare(outer, context({ stdin: { async *[Symbol.asyncIterator]() { streams++; yield bytes; } } }));
  prepared.complete([{}]);
  bytes.fill(9);
  await handler(outer, prepared.context);
  assert.deepEqual((seen[0]!.input as { content: Uint8Array }).content, new Uint8Array([0, 255, 1]));
  assert.equal(streams, 1);
});
