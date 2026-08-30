import assert from "node:assert/strict";
import test from "node:test";
import type { TextEncoder as NodeTextEncoder } from "node:util";
import { FsError, toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { fileCommands, type FileLimits } from "../../../src/commands/file/index.js";
import { SharedBudget } from "../../../src/commands/file/shared.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { proxyFs, run } from "./helpers.js";

async function linkFs(target: string) {
  const memory = createMemoryFileSystem();
  await memory.symlink!("placeholder", "/link");
  return proxyFs(memory, { async readlink() { return target; } });
}

function directBudget(limits: Partial<FileLimits>) {
  const chunks: Uint8Array[] = [];
  const context: CommandContext = { command: "file", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write(bytes) { chunks.push(bytes.slice()); } } };
  const budget = new SharedBudget(context, { maxSniffBytes: 64, maxReadFileBytes: 1024, maxInputBytes: 1024,
    maxOutputBytes: 1024, maxChunkBytes: 1024, maxEntries: 64, maxSteps: 4096,
    maxArgumentBytes: 1024, maxDurationMs: 1000, ...limits });
  return { budget, context, chunks };
}

test("TEXT-BOUND-001: direct readlink metadata is admitted before escaping", async () => {
  const result = await run(["-b", "/link"], { limits: { maxInputBytes: 16, maxOutputBytes: 4096 } }, { fs: await linkFs("\n".repeat(128)) });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /input limit exceeded/);
});

test("TEXT-BOUND-001: actual Shell rejects oversized link text without changing stored target", async () => {
  const fs = createMemoryFileSystem(); const target = "\u202e".repeat(128);
  await fs.symlink!(target, "/link");
  const shell = new Shell({ fs }); shell.use(fileCommands({ limits: { maxInputBytes: 16, maxOutputBytes: 4096 } }));
  try {
    const result = await shell.exec("file -b /link");
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /input limit exceeded/);
    assert.equal(await fs.readlink!("/link"), target);
  } finally { await shell.dispose(); }
});

test("TEXT-BOUND-001: backend error messages consume bounded input before expansion", async () => {
  const fs = proxyFs(createMemoryFileSystem(), { async lstat() { throw new FsError("EACCES", { message: "\n".repeat(128) }); } });
  const result = await run(["/denied"], { limits: { maxInputBytes: 16, maxOutputBytes: 4096 } }, { fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  assert.match(result.stderr, /input limit exceeded/); assert.ok(result.stderrBytes.length < 64);
});

test("TEXT-BOUND-001: MIME-only links do not escape an unused target description", async context => {
  const target = "\n".repeat(64); const fs = await linkFs(target);
  const original = String.prototype.replace; let targetEscapes = 0;
  context.mock.method(String.prototype, "replace", function (this: string, ...args: Parameters<typeof original>) {
    if (String(this) === target) targetEscapes++;
    return Reflect.apply(original, this, args);
  });
  const result = await run(["-bi", "/link"], { limits: { maxInputBytes: 128, maxOutputBytes: 32 } }, { fs });
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "inode/symlink; charset=binary\n");
  assert.equal(targetEscapes, 0);
});

test("TEXT-BOUND-001: output length is admitted before encoding", async context => {
  const { budget, context: command } = directBudget({ maxOutputBytes: 16 });
  const original = TextEncoder.prototype.encode; const lengths: number[] = [];
  context.mock.method(TextEncoder.prototype, "encode", function (this: NodeTextEncoder, text?: string) {
    lengths.push(text?.length ?? 0); return Reflect.apply(original, this, [text]);
  });
  try {
    await assert.rejects(budget.output(command.stdout, "x".repeat(128)), /output limit exceeded/);
    assert.ok(lengths.every(length => length <= 16), `encoded lengths: ${lengths}`);
  } finally { budget.dispose(); }
});

test("TEXT-BOUND-001: failure prefix is bounded before encoding and preserves codepoints", async context => {
  const { budget, chunks } = directBudget({ maxOutputBytes: 17 });
  const original = TextEncoder.prototype.encode; const lengths: number[] = [];
  context.mock.method(TextEncoder.prototype, "encode", function (this: NodeTextEncoder, text?: string) {
    lengths.push(text?.length ?? 0); return Reflect.apply(original, this, [text]);
  });
  try {
    await budget.failure("😀".repeat(128));
    assert.ok(lengths.every(length => length <= 17), `encoded lengths: ${lengths}`);
    const bytes = Buffer.concat(chunks);
    assert.ok(bytes.length <= 17); assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(bytes), "😀".repeat(4));
  } finally { budget.dispose(); }
});

test("TEXT-BOUND-001: metadata input is cumulative across multiple operands", async () => {
  const fs = await linkFs("abcd");
  const result = await run(Array.from({ length: 10 }, () => "/link"), { limits: { maxInputBytes: 12 } }, { fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout.split("\n").filter(Boolean).length, 3);
  assert.match(result.stderr, /input limit exceeded/);
});

test("TEXT-BOUND-001: metadata and output work are cumulative across entries", async () => {
  const fs = await linkFs("abcdef");
  const result = await run(Array.from({ length: 10 }, () => "/link"), { limits: { maxSteps: 128 } }, { fs });
  assert.equal(result.exitCode, 1); assert.ok(result.stdout.split("\n").filter(Boolean).length < 10);
  assert.match(result.stderr, /step limit exceeded/);
});

test("TEXT-BOUND-001: backend diagnostic input is cumulative, not reset for each error", async () => {
  let calls = 0;
  const fs = proxyFs(createMemoryFileSystem(), { async lstat() { calls++; throw new FsError("EACCES", { message: "permission denied" }); } });
  const result = await run(Array.from({ length: 10 }, () => "/denied"), { limits: { maxInputBytes: 40 } }, { fs });
  assert.equal(result.exitCode, 1); assert.ok(calls < 10); assert.match(result.stderr, /input limit exceeded/);
});

test("TEXT-BOUND-001: argument string length is checked before UTF-8 scanning", async context => {
  const argument = "x".repeat(128); const original = Buffer.byteLength; let scans = 0;
  context.mock.method(Buffer, "byteLength", (...args: Parameters<typeof original>) => {
    if (args[0] === argument) scans++;
    return Reflect.apply(original, Buffer, args);
  });
  const result = await run([argument], { limits: { maxArgumentBytes: 16 } });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /argument limit exceeded/); assert.equal(scans, 0);
});

test("TEXT-BOUND-001: small Unicode links and permission diagnostics retain their profile", async () => {
  const target = "😀雪\n\\\u202e";
  const result = await run(["/link"], {}, { fs: await linkFs(target) });
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "/link: symbolic link to 😀雪\\u{a}\\\\\\u{202e}\n");
  const fs = proxyFs(createMemoryFileSystem(), { async lstat() { throw new FsError("EACCES", { message: "permission denied: 雪\n" }); } });
  const error = await run(["/denied"], {}, { fs });
  assert.equal(error.exitCode, 1); assert.equal(error.stderr, "file: /denied: EACCES: permission denied: 雪\\u{a}\n");
});

test("TEXT-BOUND-001: exact UTF-8 output bytes and work are admitted before encoding", async context => {
  const cases = [
    [directBudget({ maxOutputBytes: 16 }), "雪".repeat(8), /output limit exceeded/],
    [directBudget({ maxSteps: 1 }), "word", /step limit exceeded/],
  ] as const;
  const original = TextEncoder.prototype.encode; const lengths: number[] = [];
  context.mock.method(TextEncoder.prototype, "encode", function (this: NodeTextEncoder, text?: string) {
    lengths.push(text?.length ?? 0); return Reflect.apply(original, this, [text]);
  });
  for (const [{ budget, context: command }, text, failure] of cases) {
    try { await assert.rejects(budget.output(command.stdout, text), failure); }
    finally { budget.dispose(); }
  }
  assert.deepEqual(lengths, []);
});

test("TEXT-BOUND-001: emergency diagnostic reserve is cumulative and independent of exhausted normal work", async () => {
  const { budget, chunks } = directBudget({ maxSteps: 1 });
  try {
    budget.work(1);
    await budget.failure("x".repeat(256));
    await budget.failure("y".repeat(256));
    assert.equal(Buffer.concat(chunks).toString(), "x".repeat(64));
  } finally { budget.dispose(); }
});

test("TEXT-BOUND-001: metadata admission accounts for UTF-8 bytes, not only UTF-16 length", async () => {
  const fs = await linkFs("😀");
  const denied = await run(["-bi", "/link"], { limits: { maxInputBytes: 3 } }, { fs });
  assert.equal(denied.exitCode, 1); assert.match(denied.stderr, /input limit exceeded/);
  const accepted = await run(["-bi", "/link"], { limits: { maxInputBytes: 4 } }, { fs });
  assert.equal(accepted.exitCode, 0); assert.equal(accepted.stdout, "inode/symlink; charset=binary\n");
});

test("TEXT-BOUND-001: MIME-only mode preserves readlink permission failures", async () => {
  const fs = proxyFs(await linkFs("target"), { async readlink() { throw new FsError("EACCES", { path: "/link" }); } });
  const result = await run(["-bi", "/link"], {}, { fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /permission denied.*link/);
});

test("TEXT-BOUND-001: long admitted metadata yields to cancellation without output", async () => {
  const fs = await linkFs("x".repeat(12288));
  const controller = new AbortController(), reason = new FsError("ENOENT", { message: "cancel metadata escaping" });
  const running = run(["-b", "/link"], {}, { fs, signal: controller.signal });
  const check = assert.rejects(running, error => error === reason);
  const timer = setImmediate(() => controller.abort(reason));
  try { await check; } finally { clearImmediate(timer); }
});

test("TEXT-BOUND-001: admitted long usage errors retain complete diagnostics", async () => {
  const option = "--" + "x".repeat(128);
  const result = await run([option]);
  assert.equal(result.exitCode, 2); assert.equal(result.stdout, "");
  assert.equal(result.stderr, `file: unsupported option '${option}'\n`);
});
