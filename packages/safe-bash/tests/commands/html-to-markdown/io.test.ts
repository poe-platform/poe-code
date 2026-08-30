import assert from "node:assert/strict";
import { setImmediate as pause } from "node:timers/promises";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createHtmlToMarkdownCommand, createHtmlToMarkdownCommands, htmlToMarkdownCommands } from "../../../src/commands/html-to-markdown/index.js";
import { Inputs } from "../../../src/commands/html-to-markdown/input.js";
import { standardCommands } from "../../../src/commands/index.js";
import { networkCommands } from "../../../src/commands/network/index.js";
import { FsError, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { byteChunks, convert, readonlyFacade } from "./helpers.js";

test("files and repeated stdin share one cursor and preserve VFS", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/docs");
  await fs.writeFile("/docs/a", Buffer.from("<h1>A</h1>"));
  await fs.writeFile("/docs/-name", Buffer.from("<b>B</b>"));
  let acquired = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { acquired++; return byteChunks("<p>stdin</p>")[Symbol.asyncIterator](); } };
  const result = await convert(source, {}, { fs, cwd: "/docs", args: ["a", "-", "-", "--", "-name"] });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "# A\n\nstdin\n\n**B**\n"); assert.equal(acquired, 1);
  assert.equal(Buffer.from(await fs.readFile("/docs/a")).toString(), "<h1>A</h1>");
});
test("readFile-only backend receives remaining cap and the same owned operation signal", async () => {
  const original = new MemoryFileSystem(); const controller = new AbortController();
  const calls: unknown[] = [];
  let operationSignal: AbortSignal | undefined;
  const fs = readonlyFacade(original, { readFile: async (path, options) => {
    calls.push([path, options?.maxBytes]);
    assert.ok(options?.signal instanceof AbortSignal); assert.notEqual(options.signal, controller.signal);
    operationSignal ??= options.signal; assert.equal(options.signal, operationSignal);
    assert.equal(options.signal.aborted, false); return Buffer.from("<p>x</p>");
  } }, ["readStream"]);
  const result = await convert("", { limits: { maxInputBytes: 16 } }, { fs, signal: controller.signal, args: ["a", "b"] });
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "x\n\nx\n"); assert.deepEqual(calls, [["/a", 16], ["/b", 8]]);
  assert.equal(controller.signal.aborted, false);
});
test("missing file produces status1 and leaves previous output explicit", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("/a", Buffer.from("<p>A</p>"));
  const result = await convert("", {}, { fs, args: ["/a", "/missing"] });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "A\n"); assert.match(result.stderr, /html-to-markdown:/u);
});
test("borrowed byteOffset chunks copied before next/finalization", async () => {
  const chunks = ["<p>aa", "bb</p>"];
  const backing = Buffer.alloc(32); let index = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return { async next() {
    backing.fill(120);
    if (index === chunks.length) return { done: true, value: undefined };
    const chunk = chunks[index++]!; backing.write(chunk, 5); return { done: false, value: backing.subarray(5, 5 + Buffer.byteLength(chunk)) };
  } }; } };
  assert.equal((await convert(source)).stdout, "aabb\n");
});
test("preabort does not acquire resources and preserves reason identity", async () => {
  const controller = new AbortController(), reason = { reason: "preabort" }; controller.abort(reason);
  let acquired = 0;
  await assert.rejects(convert({ [Symbol.asyncIterator]() { acquired++; throw new Error("unexpected"); } }, {}, { signal: controller.signal }), error => error === reason);
  assert.equal(acquired, 0);
});
test("registration rejection occurs before acquisition", async () => {
  let acquired = 0;
  const result = await convert({ [Symbol.asyncIterator]() { acquired++; throw new Error("unexpected"); } }, {}, { registerCleanup: () => { throw new Error("closing scope"); } });
  assert.equal(result.exitCode, 1); assert.equal(acquired, 0); assert.match(result.stderr, /closing scope/u);
});
test("pending read cancels and iterator return executes exactly once", async () => {
  const controller = new AbortController(), reason = { reason: "read abort" }; let returned = 0;
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next: () => { started(); return new Promise(resolve => { controller.signal.addEventListener("abort", () => resolve({ done: true, value: undefined }), { once: true }); }); },
    return: async () => { returned++; return { done: true, value: undefined }; },
  }; } };
  const promise = convert(source, {}, { signal: controller.signal }); await ready; controller.abort(reason);
  await assert.rejects(promise, error => error === reason); assert.equal(returned, 1);
});
test("large single chunk yields for cancellation without publishing output", async () => {
  const controller = new AbortController(), reason = new Error("CPU cancel"); let output = 0;
  const promise = convert("<p>" + "x".repeat(100_000) + "</p>", {}, { signal: controller.signal, stdout: { write: async () => { output++; } } });
  await pause(); controller.abort(reason);
  await assert.rejects(promise, error => error === reason); assert.equal(output, 0);
});
test("producer failure stays primary over finalization failure", async () => {
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw new Error("primary producer failure"); },
    async return() { throw new Error("secondary cleanup failure"); },
  }; } };
  const result = await convert(source);
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /primary producer failure/u); assert.doesNotMatch(result.stderr, /secondary cleanup/u);
});
test("output awaits backpressure and cancellation does not publish later chunks", async () => {
  const controller = new AbortController(), reason = new Error("sink abort"); let writes = 0;
  let release!: () => void, started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { started = resolve; });
  const promise = convert("a".repeat(12_000), {}, { signal: controller.signal, stdout: { async write() { writes++; started(); await blocked; } } });
  await ready; await pause(); assert.equal(writes, 1); controller.abort(reason);
  await assert.rejects(promise, error => error === reason); release(); await pause(); assert.equal(writes, 1);
});
test("sink rejection stops output and is not returned as success", async () => {
  let writes = 0;
  const result = await convert("a".repeat(12_000), {}, { stdout: { async write() { writes++; throw new FsError("EPIPE"); } } });
  assert.equal(result.exitCode, 1); assert.equal(writes, 1);
});
test("help does not read input, unknown options do not masquerade as success", async () => {
  const source = { [Symbol.asyncIterator]() { throw new Error("unexpected acquisition"); } };
  assert.equal((await convert(source, {}, { args: ["--help"] })).exitCode, 0);
  assert.equal((await convert(source, {}, { args: ["--version"] })).exitCode, 0);
  assert.equal((await convert(source, {}, { args: ["--arbitrary"] })).exitCode, 2);
});
test("standalone registration and actual VFS pipeline", async () => {
  const fs = new MemoryFileSystem(); const shell = new Shell({ fs }).use(standardCommands()).use(htmlToMarkdownCommands());
  try {
    const result = await shell.exec("printf '<h1>Release</h1><p>ready</p>' | html-to-markdown | cat > /result");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(Buffer.from(await fs.readFile("/result")).toString(), "# Release\n\nready\n");
    assert.deepEqual(createHtmlToMarkdownCommands().map(command => command.name), ["html-to-markdown"]);
  } finally { await shell.dispose(); }
});

test("explicit curl companion pipeline fetches only through injected authorized transport", async () => {
  const fs = new MemoryFileSystem(); const seen: string[] = [], approved: string[] = []; let disposed = 0;
  const shell = new Shell({ fs }).use(standardCommands()).use(htmlToMarkdownCommands()).use(networkCommands({
    authorize: request => { approved.push(request.url); return request.url === "https://page.test/document"; },
    transport: async request => {
      seen.push(request.url);
      return { status: 200, statusText: "OK", headers: [["content-type", "text/html"]], body: byteChunks('<h1>Docs</h1><img src="https://image.test/x" alt="logo"><script src="https://script.test/x">bad</script>'), async dispose() { disposed++; } };
    },
  }));
  try {
    const result = await shell.exec("curl https://page.test/document | html-to-markdown > /doc.md");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/doc.md")).toString(), "# Docs\n\n![logo](<https://image.test/x>)\n");
    assert.deepEqual(seen, ["https://page.test/document"]); assert.deepEqual(approved, seen); assert.equal(disposed, 1);
  } finally { await shell.dispose(); }
});

test("normal downstream head closes a finite conversion pipeline", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(htmlToMarkdownCommands());
  try {
    const result = await shell.exec("html-to-markdown | head -n 1", { stdin: "<h1>first</h1>" + "<p>later</p>".repeat(1000) });
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "# first\n");
  } finally { await shell.dispose(); }
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

const cleanupCases: { name: string; inputFailure?: { reason: unknown }; outputFailure?: { reason: unknown } }[] = [
  { name: "both succeed" },
  { name: "input alone fails", inputFailure: { reason: new Error("input close") } },
  { name: "output alone fails", outputFailure: { reason: new Error("output close") } },
  ...[new Error("first close"), undefined, null, false, 0, ""].map(reason => ({
    name: `both fail with first=${String(reason)}`, inputFailure: { reason }, outputFailure: { reason: new Error("second close") },
  })),
];

for (const scenario of cleanupCases) {
  test(`direct execution cleanup: ${scenario.name}`, async context => {
    const started = gate(), release = gate();
    context.after(() => { release.resolve(); });
    const events: string[] = [];
    const document = Inputs.prototype.document;
    context.mock.method(Inputs.prototype, "document", function (this: Inputs, name: string) {
      const close = this.close;
      context.mock.method(this, "close", async () => {
        await close();
        events.push("input closed");
        if (scenario.inputFailure) throw scenario.inputFailure.reason;
      });
      this.context.registerCleanup!(async () => {
        events.push("output closing");
        started.resolve();
        await release.promise;
        events.push("output closed");
        if (scenario.outputFailure) throw scenario.outputFailure.reason;
      });
      return document.call(this, name);
    });
    const stdout: Uint8Array[] = [];
    const commandContext: CommandContext = {
      command: "html-to-markdown", args: [], stdin: byteChunks("<p>text</p>"),
      stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write() { assert.fail("unexpected diagnostic"); } },
      cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
    };
    let settled = false;
    const pending = Promise.resolve(createHtmlToMarkdownCommand().execute(commandContext)).finally(() => { settled = true; });
    const expected = scenario.inputFailure ?? scenario.outputFailure;
    const checked = expected ? assert.rejects(pending, error => Object.is(error, expected.reason)) : pending;
    try {
      await started.promise;
      assert.equal(settled, false);
      assert.deepEqual(events, ["input closed", "output closing"]);
    } finally { release.resolve(); }
    const result = await checked;
    if (!expected) assert.deepEqual(result, { exitCode: 0 });
    assert.deepEqual(events, ["input closed", "output closing", "output closed"]);
    assert.equal(Buffer.concat(stdout).toString(), "text\n");
  });
}

for (const primary of ["producer", "diagnostic", "cancel"] as const)
  for (const reason of [new Error(`primary ${primary}`), undefined, null, false, 0, ""]) {
  test(`direct execution preserves ${primary} ${String(reason)} while awaiting both failing cleanups`, async context => {
    const controller = new AbortController();
    const started = gate(), release = gate();
    context.after(() => { release.resolve(); });
    const events: string[] = [], diagnostics: Uint8Array[] = [];
    const document = Inputs.prototype.document;
    context.mock.method(Inputs.prototype, "document", function (this: Inputs, name: string) {
      const close = this.close;
      context.mock.method(this, "close", async () => {
        await close(); events.push("input closed"); throw new Error("input close");
      });
      this.context.registerCleanup!(async () => {
        events.push("output closing"); started.resolve(); await release.promise;
        events.push("output closed"); throw new Error("output close");
      });
      return document.call(this, name);
    });
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() {
        if (primary === "cancel") controller.abort(reason);
        throw primary === "producer" ? reason : new Error("primary producer");
      },
      async return() { events.push("iterator returned"); return { done: true, value: undefined }; },
    }; } };
    const commandContext: CommandContext = {
      command: "html-to-markdown", args: [], stdin: source,
      stdout: { async write() { assert.fail("unexpected output"); } },
      stderr: { async write(bytes) { if (primary === "diagnostic") throw reason; diagnostics.push(bytes.slice()); } },
      cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: controller.signal,
    };
    let settled = false;
    const pending = Promise.resolve(createHtmlToMarkdownCommand().execute(commandContext)).finally(() => { settled = true; });
    const checked = primary === "producer" ? pending : assert.rejects(pending,
      error => Object.is(error, primary === "cancel" ? controller.signal.reason : reason));
    try { await started.promise; assert.equal(settled, false); }
    finally { release.resolve(); }
    const result = await checked;
    if (primary === "producer") {
      assert.deepEqual(result, { exitCode: 1 });
      assert.equal(Buffer.concat(diagnostics).toString(), `html-to-markdown: ${reason instanceof Error ? reason.message : String(reason)}\n`);
    }
    if (primary === "cancel") {
      assert.deepEqual(events.toSorted(), ["input closed", "iterator returned", "output closed", "output closing"]);
      assert.ok(events.indexOf("iterator returned") < events.indexOf("input closed"));
      assert.ok(events.indexOf("output closing") < events.indexOf("output closed"));
    } else assert.deepEqual(events, ["iterator returned", "input closed", "output closing", "output closed"]);
  });
}
