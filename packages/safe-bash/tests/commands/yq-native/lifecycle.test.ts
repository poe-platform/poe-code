import assert from "node:assert/strict";
import { test } from "node:test";
import { Composer, Document, Lexer } from "yaml";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { type InvocationCleanup, type ByteSource } from "../../../src/contracts/index.js";
import { createMikeYqCommand } from "../../../src/commands/yq/mike.js";
import { run } from "./helpers.js";

for (const [name, input, limit] of [
  ["maxInputBytes", "12345", 4], ["maxDocumentBytes", "a: abcdefgh", 4],
  ["maxScalarBytes", '"abcdef"', 4], ["maxNodes", "[1,2,3]", 2],
  ["maxDepth", "[[[[1]]]]", 2], ["maxSteps", "[1,2,3]", 2],
  ["maxParserNodes", "[1,2,3,4]", 2],
] as const) test(`bounded ${name}`, async () => {
  const result = await run(["."], input, {}, { limits: { [name]: limit } });
  assert.equal(result.status, 1); assert.match(result.stderr, new RegExp(name, "u"));
});

test("document admission precedes library lexing", async context => {
  let called = false;
  const lex = Lexer.prototype.lex;
  context.mock.method(Lexer.prototype, "lex", function (this: Lexer, ...args: Parameters<typeof lex>) { called = true; return lex.apply(this, args); });
  const result = await run(["."], "a: abcdefgh", {}, { limits: { maxDocumentBytes: 4 } });
  assert.equal(result.status, 1); assert.equal(called, false);
});

test("huge requested indentation fails before string allocation", async () => {
  const result = await run(["-I2147483647", "."], "a: [1]", {}, { limits: { maxOutputBytes: 1024 } });
  assert.equal(result.status, 1); assert.match(result.stderr, /maxOutputBytes/u);
});

test("alias expansion is bounded for JSON", async () => {
  const result = await run(["-o=json", "."], "base: &base [1]\nrefs: [*base, *base, *base]", {}, { limits: { maxAliases: 2 } });
  assert.equal(result.status, 1); assert.match(result.stderr, /maxAliases/u);
});

test("null input and help never acquire supplied stdin", async () => {
  const stdin: ByteSource = { [Symbol.asyncIterator]() { throw new Error("stdin must not be acquired"); } };
  assert.equal((await run(["-n", ".a = 1"], "", { stdin })).status, 0);
  assert.equal((await run(["--help"], "", { stdin })).status, 0);
});

test("empty chunks yield to timers and return the producer", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled"); let produced = 0; let returned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stdin = (async function* () { timer = setTimeout(() => controller.abort(reason), 0); try { for (; produced < 4096; produced++) yield new Uint8Array(); } finally { returned = true; } })();
  try { await assert.rejects(run(["."], "", { signal: controller.signal, stdin }), error => error === reason); assert.ok(produced < 4096); assert.equal(returned, true); }
  finally { clearTimeout(timer); }
});

test("fallback readFile receives a byte bound", async context => {
  const fs = createMemoryFileSystem();
  let maxBytes: number | undefined;
  context.mock.method(fs, "readFile", async (...args: Parameters<typeof fs.readFile>) => { maxBytes = args[1]?.maxBytes; return Buffer.from("1"); });
  const fallback = new Proxy(fs, { get(target, key) { if (key === "readStream") return undefined; const result: unknown = Reflect.get(target, key); return typeof result === "function" ? result.bind(target) : result; } });
  assert.equal((await run([".", "/input"], "", { fs: fallback }, { limits: { maxInputBytes: 32 } })).status, 0);
  assert.equal(maxBytes, 32);
});

test("late staging-file admission is cleaned after concurrent invocation close", async context => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/input", Buffer.from("a: 1\n"));
  let release!: () => void; let opened!: () => void; let cleanup: InvocationCleanup | undefined;
  const admitted = new Promise<void>(resolve => { opened = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const create = fs.createStagedFile.bind(fs);
  context.mock.method(fs, "createStagedFile", async (...args: Parameters<typeof create>) => {
    opened(); await gate;
    return create(args[0], args[1], args[2], { parent: args[3].parent });
  });
  const pending = run(["-i", ".a = 2", "/input"], "", { fs, registerCleanup(callback) { cleanup ??= callback; } });
  const rejected = assert.rejects(pending);
  await admitted;
  const closing = cleanup!();
  release(); await closing; await rejected;
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a: 1\n");
});

test("JSON containers never materialize through plain-object JSON.parse", async context => {
  const parse = JSON.parse;
  let parsedScalars = 0;
  context.mock.method(JSON, "parse", (text: string) => {
    assert.ok(!text.startsWith("{") && !text.startsWith("["));
    parsedScalars++;
    return parse(text);
  });
  assert.deepEqual(await run(["-p=json", "-o=json", "-I0", "."], '{"a":1,"a":2,"items":[true,null]}'), { status: 0, stdout: '{"a":1,"a":2,"items":[true,null]}\n', stderr: "" });
  assert.ok(parsedScalars > 0);
});

test("duplicate JSON member admission is bounded before output", async () => {
  const result = await run(["-p=json", "-o=json", "."], '{"a":1,"a":2,"a":3}', {}, { limits: { maxParserNodes: 4 } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /maxParserNodes/u);
});

test("quoted-indentation workspace refusal preserves the original in-place file", async () => {
  const fs = createMemoryFileSystem();
  const input = 'a: "one\ntwo"\n';
  await fs.writeFile("/input", Buffer.from(input));
  const result = await run(["-i", ".", "/input"], "", { fs }, { limits: { maxDocumentBytes: Buffer.byteLength(input) } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /maxDocumentBytes/u);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), input);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
});

test("a known first quote error does not allocate later document error records", async () => {
  assert.deepEqual(await run(["."], 'a: "bad\n---\n'.repeat(80), {}, { limits: { maxNodes: 64 } }), { status: 1, stdout: "", stderr: "Error: bad file '-': yaml: while scanning a quoted scalar at line 1, column 4: line 2: found unexpected document indicator\n" });
});

test("wildcard backtracking consumes the configured work budget", async () => {
  const result = await run([`.a == "*${"a".repeat(64)}b"`], `a: ${"a".repeat(1024)}\n`, {}, { limits: { maxSteps: 20_000 } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /maxSteps/u);
});

for (const phase of ["createStagedFile", "publishStagedFile"] as const) for (const reason of [false, new Error("writer cancellation")]) test(`direct execute drains ${phase} without external cleanup: ${String(reason)}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a: 1\n"));
  const controller = new AbortController();
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  let finished = false; let settled = false;
  if (phase === "createStagedFile") {
    const create = fs.createStagedFile.bind(fs);
    context.mock.method(fs, phase, async (...args: Parameters<typeof create>) => {
      entered(); await gate;
      const receipt = await create(args[0], args[1], args[2], { parent: args[3].parent });
      finished = true; return receipt;
    });
  } else {
    const publish = fs.publishStagedFile.bind(fs);
    context.mock.method(fs, phase, async (...args: Parameters<typeof publish>) => {
      entered(); await gate;
      await publish(args[0], args[1], { parent: args[2].parent, destination: args[2].destination, ...(args[2].ancestors ? { ancestors: args[2].ancestors } : {}) });
      finished = true;
    });
  }
  const pending = run(["-i", ".a = 2", "/input"], "", { fs, signal: controller.signal });
  void pending.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(pending, error => error === reason);
  await admitted; controller.abort(reason);
  try {
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false); assert.equal(finished, false);
    assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a: 1\n");
  } finally { release(); }
  await rejected;
  assert.equal(finished, true);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), phase === "createStagedFile" ? "a: 1\n" : "a: 2\n");
});

test("pending source next is drained and iterator returned exactly once", async () => {
  let release!: () => void; let entered!: () => void; let cleanup: InvocationCleanup | undefined; let returns = 0;
  const gate = new Promise<IteratorResult<Uint8Array>>(resolve => { release = () => resolve({ done: false, value: Buffer.from("1") }); });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return { next() { entered(); return gate; }, async return() { returns++; return { done: true, value: undefined }; } }; } };
  const pending = run(["."], "", { stdin, registerCleanup(callback) { cleanup ??= callback; } });
  const rejected = assert.rejects(pending); await started;
  let closed = false; const closing = Promise.resolve(cleanup!()).then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  release(); await closing; await rejected; assert.equal(returns, 1);
});

test("invalid limit configuration is rejected synchronously", () => {
  assert.throws(() => createMikeYqCommand({ limits: { maxDepth: 0 } }), /invalid yq limit/u);
});

test("input buffer reuse preserves owned bytes", async () => {
  const data = Buffer.from("[1,");
  const stdin = (async function* () { yield data; data.set(Buffer.from("2]\n")); yield data; data.fill(0); })();
  assert.equal((await run(["-o=json", "-I0", "."], "", { stdin })).stdout, "[1,2]\n");
});

test("node admission precedes recursive library composition", async context => {
  let called = false;
  const next = Composer.prototype.next;
  context.mock.method(Composer.prototype, "next", function (this: Composer, ...args: Parameters<typeof next>) { called = true; return next.apply(this, args); });
  const result = await run(["."], "[1,2,3]", {}, { limits: { maxNodes: 2 } });
  assert.equal(result.status, 1); assert.equal(called, false);
});

test("primary falsey sink failure survives rejecting producer cleanup", async () => {
  const stdin: ByteSource = { [Symbol.asyncIterator]() { let sent = false; return {
    async next() { if (sent) return { done: true, value: undefined }; sent = true; return { done: false, value: Buffer.from("1") }; },
    async return() { throw new Error("cleanup failed"); },
  }; } };
  await assert.rejects(run(["."], "", { stdin, stdout: { async write() { throw 0; } } }), error => error === 0);
});

test("help observes the configured stdout bound", async () => {
  const result = await run(["--help"], "", {}, { limits: { maxOutputBytes: 8 } });
  assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /maxOutputBytes/u);
});

test("prototype names cannot be admitted as flags or limits", async () => {
  for (const name of ["toString", "constructor", "__proto__"]) {
    const result = await run([`--${name}`]);
    assert.equal(result.status, 1); assert.ok(result.stderr.startsWith(`Error: unknown flag: --${name}\n`));
    assert.throws(() => createMikeYqCommand({ limits: { [name]: 1 } }), /invalid yq limit/u);
  }
});

test("document quota spans all input files in eval mode", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first", Buffer.from("1\n")); await fs.writeFile("/second", Buffer.from("2\n"));
  const result = await run([".", "/first", "/second"], "", { fs }, { limits: { maxDocuments: 1 } });
  assert.equal(result.status, 1); assert.equal(result.stdout, "1\n"); assert.match(result.stderr, /maxDocuments/u);
});

test("exactly fitting YAML output is not rejected by conservative projection", async () => {
  assert.deepEqual(await run(["."], "a: 1\n", {}, { limits: { maxOutputBytes: 5 } }), { status: 0, stdout: "a: 1\n", stderr: "" });
});

test("recursive merge aliases consume depth budget", async () => {
  const result = await run(["--yaml-fix-merge-anchor-to-spec", ".x"], "&self {<<: *self}", {}, { limits: { maxDepth: 8 } });
  assert.equal(result.status, 1); assert.match(result.stderr, /maxDepth/u);
});

test("JSON node admission precedes recursive library node construction", async context => {
  let called = false;
  const create = Document.prototype.createNode;
  context.mock.method(Document.prototype, "createNode", function (this: Document, ...args: Parameters<typeof create>) { called = true; return create.apply(this, args); });
  const result = await run(["-p=json", "."], "[1,2,3]", {}, { limits: { maxNodes: 2 } });
  assert.equal(result.status, 1); assert.equal(called, false);
});

for (const rename of [true, false]) test(`in-place refuses ancestor substitution with rename=${rename}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/visible"); await fs.mkdir("/private");
  await fs.writeFile("/visible/input", Buffer.from("a: 1\n"));
  await fs.writeFile("/private/input", Buffer.from("a: 9\n"));
  const read = fs.readStream.bind(fs);
  let swapped = false;
  context.mock.method(fs, "readStream", (...args: Parameters<typeof read>) => (async function* () {
    yield* read(...args);
    if (!swapped) {
      swapped = true;
      await fs.rename("/visible", "/old"); await fs.symlink("/private", "/visible");
    }
  })());
  const backend = new Proxy(fs, { get(target, key) {
    if (key === "capabilities" && !rename) return { ...target.capabilities, rename: false };
    if (key === "capabilitiesFor" && !rename) return undefined;
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run(["-i", ".a = 2", "/visible/input"], "", { fs: backend });
  assert.equal(result.status, 1);
  assert.equal(Buffer.from(await fs.readFile("/private/input")).toString(), "a: 9\n");
  assert.equal(Buffer.from(await fs.readFile("/old/input")).toString(), "a: 1\n");
});

test("in-place refuses backends without atomic ancestry publication", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a: 1\n"));
  const backend = new Proxy(fs, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, atomicStagingAncestry: false };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run(["-i", ".a = 2", "/input"], "", { fs: backend });
  assert.equal(result.status, 1);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a: 1\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
});

test("in-place conditional publication preserves a replaced target", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a: 1\n"));
  const publish = fs.publishStagedFile.bind(fs);
  context.mock.method(fs, "publishStagedFile", async (...args: Parameters<typeof publish>) => {
    await fs.rename("/input", "/old");
    await fs.writeFile("/input", Buffer.from("a: 9\n"));
    return publish(...args);
  });
  assert.equal((await run(["-i", ".a = 2", "/input"], "", { fs })).status, 1);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a: 9\n");
  assert.equal(Buffer.from(await fs.readFile("/old")).toString(), "a: 1\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input", "old"]);
});

test("in-place pins ancestors above the parent through publication and cleanup", async context => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/visible/child", { recursive: true });
  await fs.mkdir("/private/child", { recursive: true });
  await fs.writeFile("/visible/child/input", Buffer.from("a: 1\n"));
  await fs.writeFile("/private/child/input", Buffer.from("a: 9\n"));
  const publish = fs.publishStagedFile.bind(fs);
  context.mock.method(fs, "publishStagedFile", async (...args: Parameters<typeof publish>) => {
    await fs.rename("/visible", "/old"); await fs.symlink("/private", "/visible");
    return publish(...args);
  });
  // Cleanup also refuses the substituted namespace instead of deleting through it.
  await assert.rejects(run(["-i", ".a = 2", "/visible/child/input"], "", { fs }));
  assert.equal(Buffer.from(await fs.readFile("/private/child/input")).toString(), "a: 9\n");
  assert.equal(Buffer.from(await fs.readFile("/old/child/input")).toString(), "a: 1\n");
  assert.deepEqual((await fs.readdir("/private/child")).map(entry => entry.name), ["input"]);
});

test("in-place reads the captured symlink target after the alias is replaced", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a: 1\n"));
  await fs.writeFile("/other", Buffer.from("a: 9\n"));
  await fs.symlink("/input", "/alias");
  const lstat = fs.lstat.bind(fs);
  context.mock.method(fs, "lstat", async (...args: Parameters<typeof lstat>) => {
    const stat = await lstat(...args);
    if (args[0] === "/input") { await fs.rm("/alias"); await fs.symlink("/other", "/alias"); }
    return stat;
  });
  assert.equal((await run(["-i", ".a += 1", "/alias"], "", { fs })).status, 0);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a: 2\n");
  assert.equal(Buffer.from(await fs.readFile("/other")).toString(), "a: 9\n");
});
