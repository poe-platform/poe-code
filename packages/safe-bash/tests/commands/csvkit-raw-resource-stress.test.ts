import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

for (const [limits, argumentsText, diagnostic] of [
  [{ maxArguments: 0 }, " /owned.csv", "argv count limit exceeded"],
  [{ maxArgumentBytes: 1 }, " /owned.csv", "argv byte limit exceeded"]
] as const) test(`csvkit host ${diagnostic} remains a named divergence without acquiring input`, async () => {
  const fs = new MemoryFileSystem();
  Object.assign(fs, { readStream() { assert.fail("argv denial must precede named input acquisition"); } });
  const shell = new Shell({ fs }).use(csvkitCommands({ ...bindings, limits }));
  try {
    const result = await shell.exec(`csvcut${argumentsText}`, {
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("argv denial must precede stdin acquisition"); yield new Uint8Array(); } }
    });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 78, stdout: "", stderr: `csvkit: unsupported or unqualified: ${diagnostic}\n`
    });
  } finally { await shell.dispose(); }
});

for (const command of ["csvcut", "csvgrep -c a -m x", "csvformat", "csvclean --length-mismatch"])
  test(`${command} input budget failure waits for named source cleanup and preserves a later invocation`, async () => {
    const fs = new MemoryFileSystem();
    let release!: () => void, announce!: () => void;
    const closing = new Promise<void>(resolve => { release = resolve; });
    const admitted = new Promise<void>(resolve => { announce = resolve; });
    let returned = 0, acquired = 0;
    Object.assign(fs, { readStream() {
      acquired++;
      if (acquired > 1) return { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode("a\nx\n"); } };
      return { [Symbol.asyncIterator]() {
        return {
          async next() { return { done: false as const, value: new TextEncoder().encode("a\nx\nOVER\n") }; },
          async return() { returned++; announce(); await closing; return { done: true as const, value: undefined }; }
        };
      } };
    } });
    const shell = new Shell({ fs }).use(csvkitCommands({ ...bindings, limits: { maxInputBytes: 4 } }));
    let settled = false;
    const execution = shell.exec(`${command} /owned.csv`).then(result => { settled = true; return result; });
    try {
      await admitted;
      await new Promise<void>(resolve => { setImmediate(resolve); });
      assert.equal(settled, false, "cooperative registered return must drain before public settlement");
      release();
      const result = await execution;
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 78, stdout: "", stderr: "csvkit: unsupported or unqualified: input byte budget exceeded\n"
      });
      assert.equal(returned, 1);
      const later = await shell.exec("csvcut /owned.csv");
      assert.deepEqual({ status: later.exitCode, stdout: later.stdout, stderr: later.stderr }, { status: 0, stdout: "a\nx\n", stderr: "" });
    } finally { release(); await execution; await shell.dispose(); }
    assert.equal(returned, 1, "disposal must not retry a settled iterator return");
  });

for (const command of ["csvcut", "csvgrep -c 1 -m x", "csvformat", "csvclean --length-mismatch"])
  test(`${command} keeps source advancement behind the awaited first output write`, async () => {
    const fs = new MemoryFileSystem();
    const effects: string[] = [];
    // The frozen CPython decode profile permits one 8192-byte window of lookahead.
    const header = `a${" ".repeat(8190)}\n`;
    Object.assign(fs, { readStream() {
      return { async *[Symbol.asyncIterator]() {
        try {
          effects.push("header"); yield new TextEncoder().encode(header);
          effects.push("row"); yield new TextEncoder().encode("x\n");
          effects.push("eof");
        } finally { effects.push("return"); }
      } };
    } });
    const shell = new Shell({ fs }).use(csvkitCommands(bindings));
    let release!: () => void, announce!: () => void;
    const writing = new Promise<void>(resolve => { release = resolve; });
    const admitted = new Promise<void>(resolve => { announce = resolve; });
    let stdout = "", writes = 0;
    const execution = shell.exec(`${command} /owned.csv`, { stdout: {
      async write(bytes) {
        if (++writes === 1) { announce(); await writing; }
        stdout += new TextDecoder().decode(bytes);
      }
    } });
    try {
      await admitted;
      await new Promise<void>(resolve => { setImmediate(resolve); });
      assert.deepEqual(effects, ["header"], "raw commands must suspend their producer while the sink is blocked");
      release();
      const result = await execution;
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(stdout, `${header}x\n`);
      assert.deepEqual(effects, ["header", "row", "eof", "return"]);
    } finally { release(); await execution; await shell.dispose(); }
  });
