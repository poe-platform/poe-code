import assert from "node:assert/strict";
import test from "node:test";
import { createOutputOperation, FsError, toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { diagnostic } from "../../src/commands/internal.js";
import { deferred } from "../commands/column/helpers.js";
import { diagnostics as columnDiagnostics } from "../../src/commands/column/internal.js";
import { diagnostic as patchDiagnostic, PatchError } from "../../src/commands/apply-patch/shared.js";
import { escapeText } from "../../src/escaping.js";
import { createHtmlToMarkdownCommand } from "../../src/commands/html-to-markdown/index.js";
import { jqCommand } from "../../src/commands/structured/jq.js";
import { NodeHost } from "../../src/commands/node/host.js";
import { NodeLedger } from "../../src/commands/node/values.js";
import { nodeLimits } from "../../src/commands/node/types.js";

function context(overrides: Partial<CommandContext> = {}) {
  const chunks: Uint8Array[] = [];
  const value: CommandContext = {
    command: "probe", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: (async function* () { yield new Uint8Array(); })(),
    stdout: { async write() {} }, stderr: { async write(bytes) { chunks.push(bytes.slice()); } },
    signal: new AbortController().signal, ...overrides,
  };
  return { value, chunks };
}

for (const [character, escaped] of [
  ["\0", "\\000"], ["\u0007", "\\007"], ["\b", "\\b"], ["\v", "\\v"],
  ["\f", "\\f"], ["\r", "\\r"], ["\u001b", "\\033"], ["\u007f", "\\177"],
  ["\u0085", "\\302\\205"], ["\u009b", "\\302\\233"], ["\u009f", "\\302\\237"],
] as const) {
  test(`generated diagnostics escape control U+${character.charCodeAt(0).toString(16)}`, async () => {
    const { value, chunks } = context({ command: `p${character}q` });
    const path = `/p${character}q`;
    const error = new FsError("ENOENT", { path, dest: path });
    const original = error.message;
    await diagnostic(value, error);
    const actual = Buffer.concat(chunks).toString();
    assert.equal(actual.includes(character), false);
    assert.equal(actual.startsWith(`p${escaped}q: `), true);
    assert.equal(actual.includes(`/p${escaped}q`), true);
    assert.equal(error.path, path);
    assert.equal(error.dest, path);
    assert.equal(error.message, original);
  });
}

test("diagnostics preserve LF, TAB, ordinary Unicode and existing backslash text", async () => {
  const { value, chunks } = context();
  const message = "line\n\té \\033 \\n";
  await diagnostic(value, new Error(message));
  assert.equal(Buffer.concat(chunks).toString(), `probe: ${message}\n`);
});

test("generated diagnostics use bounded output chunks", async () => {
  const { value, chunks } = context();
  await diagnostic(value, new Error("x".repeat(20_000)));
  assert.equal(Buffer.concat(chunks).toString(), `probe: ${"x".repeat(20_000)}\n`);
  assert.ok(chunks.every(chunk => chunk.length <= 16_384));
});

test("long generated diagnostic formatting cooperatively observes cancellation", async () => {
  const controller = new AbortController();
  const { value } = context({ signal: controller.signal });
  const running = diagnostic(value, new Error("\u001b".repeat(3000)));
  const rejected = assert.rejects(running, error => error === false);
  const turn = setImmediate(() => controller.abort(false));
  try { await rejected; } finally { clearImmediate(turn); }
});

for (const reason of [null, false, 0, ""]) {
  test(`diagnostics retain falsey cancellation ${JSON.stringify(reason)}`, async () => {
    const controller = new AbortController();
    const { value, chunks } = context({ signal: controller.signal });
    controller.abort(reason);
    await assert.rejects(diagnostic(value, new Error("failure")), error => Object.is(error, reason));
    assert.equal(chunks.length, 0);
  });
}

test("diagnostic chunks await backpressure and retain distinct immutable bytes", async () => {
  const entered = deferred(), release = deferred();
  const chunks: Uint8Array[] = [];
  const { value } = context({ stderr: { async write(bytes) {
    chunks.push(bytes);
    if (chunks.length === 1) { entered.resolve(); await release.promise; }
  } } });
  const message = "\u001b".repeat(6000);
  let finished = false;
  const pending = diagnostic(value, new Error(message)).then(() => { finished = true; });
  await entered.promise;
  const first = chunks[0]!.slice();
  assert.equal(finished, false);
  assert.equal(chunks.length, 1);
  release.resolve();
  await pending;
  assert.equal(chunks.length, 2);
  assert.notEqual(chunks[0]!.buffer, chunks[1]!.buffer);
  assert.deepEqual(chunks[0], first);
  assert.equal(Buffer.concat(chunks).toString(), `probe: ${"\\033".repeat(6000)}\n`);
});

for (const reason of [null, false, 0, ""]) {
  test(`diagnostic write failure preserves accepted prefix and identity ${JSON.stringify(reason)}`, async () => {
    const accepted: Uint8Array[] = [];
    let writes = 0;
    const { value } = context({ stderr: { async write(bytes) {
      if (++writes === 2) throw reason;
      accepted.push(bytes);
    } } });
    await assert.rejects(diagnostic(value, new Error("\u001b".repeat(6000))), error => Object.is(error, reason));
    assert.equal(writes, 2);
    const expected = `probe: ${"\\033".repeat(6000)}\n`;
    assert.equal(Buffer.concat(accepted).toString(), expected.slice(0, accepted[0]!.length));
    assert.ok(accepted[0]!.length <= 16_384);
  });

  test(`diagnostic cancellation during a write schedules no later writes ${JSON.stringify(reason)}`, async () => {
    const controller = new AbortController();
    const entered = deferred(), release = deferred();
    let writes = 0;
    const { value } = context({ signal: controller.signal, stderr: { async write() {
      writes++; entered.resolve(); await release.promise;
    } } });
    const pending = diagnostic(value, new Error("\u001b".repeat(6000)));
    const rejection = assert.rejects(pending, error => Object.is(error, reason));
    await entered.promise;
    controller.abort(reason);
    await rejection;
    release.resolve();
    await Promise.resolve();
    assert.equal(writes, 1);
  });

  test(`existing owned output boundary preserves consumer-close identity ${JSON.stringify(reason)}`, async () => {
    const consumer = new AbortController();
    const entered = deferred(), release = deferred();
    let writes = 0;
    const { value } = context();
    const operation = createOutputOperation(value, {
      async write() { assert.fail("owned output must not use the legacy writer"); },
      ownedOutput: { consumerClosed: consumer.signal, async write() {
        writes++; entered.resolve(); await release.promise;
      } },
    });
    const pending = diagnostic({ ...value, stderr: operation.output }, new Error("\u001b".repeat(6000)));
    const rejection = assert.rejects(pending, error => Object.is(error, reason));
    await entered.promise;
    consumer.abort(reason);
    await rejection;
    release.resolve();
    await operation.close();
    assert.equal(writes, 1);
  });
}

test("rendered-byte admission precedes retaining an escaped part", () => {
  const sizes: number[] = [];
  assert.equal(escapeText("a\u009b", "diagnostic", size => { sizes.push(size); }), "a\\302\\233");
  assert.deepEqual(sizes, [1, 5, 9]);
  assert.throws(() => escapeText("a\u009b", "diagnostic", size => {
    if (size > 8) throw new Error("render budget");
  }), /render budget/);
});

test("column counts escaped bytes across successive diagnostics", async () => {
  const text = "column: \\033\n";
  const { value, chunks } = context();
  const emit = columnDiagnostics(value, Buffer.byteLength(text));
  await emit(new Error("\u001b"));
  await emit(new Error("unadmitted"));
  assert.equal(Buffer.concat(chunks).toString(), text);
  const smaller = context();
  await columnDiagnostics(smaller.value, Buffer.byteLength(text) - 1)(new Error("\u001b"));
  assert.ok(Buffer.concat(smaller.chunks).length <= Buffer.byteLength(text) - 1);
  assert.equal(Buffer.concat(smaller.chunks).includes(27), false);
});

test("apply_patch preserves its reserved truncation marker after escaping", () => {
  const expected = "apply_patch: \\033\\302\\233\n";
  const maximum = Buffer.byteLength(expected) - 1 + Buffer.byteLength(" [truncated]\n");
  assert.equal(Buffer.from(patchDiagnostic(new PatchError("\u001b\u009b"), maximum)).toString(), expected);
  const truncated = Buffer.from(patchDiagnostic(new PatchError("\u001b\u009b"), maximum - 1));
  assert.ok(truncated.length <= maximum - 1);
  assert.equal(truncated.toString().endsWith(" [truncated]\n"), true);
  assert.equal(truncated.includes(27), false);
});

test("HTML diagnostics apply their existing cap to rendered bytes", async () => {
  const args = ["/missing-\u001b"];
  const complete = context({ args });
  await createHtmlToMarkdownCommand().execute(complete.value);
  const expected = Buffer.concat(complete.chunks);
  assert.equal(expected.includes(27), false);
  assert.equal(expected.toString().includes("\\033"), true);
  for (const maximum of [expected.length, expected.length - 1]) {
    const limited = context({ args });
    await createHtmlToMarkdownCommand({ limits: { maxDiagnosticBytes: maximum } }).execute(limited.value);
    assert.deepEqual(Buffer.concat(limited.chunks), expected.subarray(0, maximum));
  }
});

test("jq queued errors account for escaped messages and source names", async () => {
  const name = "/input-\u001b";
  const fs = createMemoryFileSystem();
  await fs.writeFile(name, Buffer.from(JSON.stringify("bad\u001b") + "\n"));
  const complete = context({ fs, args: ["tonumber", name], stdin: toByteSource("") });
  await jqCommand().execute(complete.value);
  const expected = Buffer.concat(complete.chunks).toString();
  const prefix = "jq: error (at /input-\\033:1): ";
  assert.equal(expected.startsWith(prefix), true, JSON.stringify(expected));
  const message = expected.slice(prefix.length, -1);
  assert.equal(message.includes("\\033"), true, JSON.stringify(message));
  const maximum = Buffer.byteLength(message) + Buffer.byteLength("/input-\\033") + 64;
  for (const limit of [maximum, maximum - 1]) {
    const probe = context({ fs, args: ["tonumber", name], stdin: toByteSource("") });
    const result = await jqCommand({ limits: { maxOutputBytes: limit } }).execute(probe.value);
    assert.notEqual(result.exitCode, 0);
    const text = Buffer.concat(probe.chunks).toString();
    assert.equal(text.includes("\u001b"), false);
    if (limit === maximum) assert.equal(text, expected);
    else assert.equal(text.includes("maxOutputBytes"), true, JSON.stringify(text));
  }
});

test("Node diagnostic admission counts escaped bytes without filtering guest output", async () => {
  let written = 0, last = "";
  const { value } = context({ stderr: { async write(bytes) { written += bytes.length; last = Buffer.from(bytes).toString(); } } });
  const host = new NodeHost({
    context: value, signal: value.signal, ledger: new NodeLedger(), isClosed: () => false,
    check() { value.signal.throwIfAborted(); }, failure(reason) { throw reason; },
    async job(start) { return await start(); },
  }, { sourceRead: false, dataRead: false, dataWrite: false, jsonModules: false, stdinRead: false, stdoutWrite: false, stderrWrite: true }, "/", "/");
  const payload = "\u001b".repeat(65_536);
  let remaining = nodeLimits.outputBytes - 8;
  for (let sequence = 1; remaining > 0; sequence++) {
    const text = payload.slice(0, Math.min(remaining, payload.length));
    const response = await host.request({ sequence, op: "writeOutput", authority: "stderr", text, path: null, flag: null, moduleKey: null });
    assert.equal(response.kind, "void");
    host.delivered(sequence);
    assert.equal(last, text);
    remaining -= text.length;
  }
  await assert.rejects(host.diagnostic("a\u009b"), /diagnostic output bytes/);
  assert.equal(written, nodeLimits.outputBytes - 8);
  await host.diagnostic("\u009b");
  assert.equal(last, "\\302\\233");
  assert.equal(written, nodeLimits.outputBytes);
  assert.equal(host.retire(), undefined);
});
