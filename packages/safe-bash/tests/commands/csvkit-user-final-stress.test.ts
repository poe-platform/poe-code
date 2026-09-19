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

test("all fourteen version commands leave borrowed input unread and named files untouched", async () => {
  const fs = new MemoryFileSystem();
  Object.assign(fs, {
    readStream() { assert.fail("version must not acquire named input"); },
    async readFile() { assert.fail("version must not bulk-read named input"); },
    async open() { assert.fail("version must not probe named input"); }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    for (const name of ["csvclean", "csvcut", "csvformat", "csvgrep", "csvjoin", "csvjson", "csvlook", "csvpy", "csvsort", "csvsql", "csvstack", "csvstat", "in2csv", "sql2csv"]) {
      const result = await shell.exec(`${name} /unused.csv --version`, {
        // ShellInput acquires the caller iterator before command dispatch;
        // csvkit must leave that borrowed iterator unread.
        stdin: { [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
          return { async next() { assert.fail("version must not advance borrowed stdin"); } };
        } }
      });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 0, stdout: `${name} 2.2.0\n`, stderr: ""
      });
    }
  } finally { await shell.dispose(); }
});

test("csvcut accepts empty chunks between split UTF-8 bytes without requiring an iterator return hook", async () => {
  const bytes = new TextEncoder().encode("a,b\n😀,é\n");
  let advances = 0;
  const source = { [Symbol.asyncIterator]() {
    let index = 0;
    return { async next(): Promise<IteratorResult<Uint8Array>> {
      advances++;
      if (index >= bytes.length * 2) return { done: true, value: undefined };
      const step = index++;
      return { done: false, value: step % 2 === 0 ? new Uint8Array() : bytes.slice(Math.floor(step / 2), Math.floor(step / 2) + 1) };
    } };
  } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec("csvcut", { stdin: source });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "a,b\n😀,é\n", stderr: ""
    });
    assert.equal(advances, bytes.length * 2 + 1);
  } finally { await shell.dispose(); }
});

test("csvcut cancellation rejects late named bytes and closes the admitted iterator exactly once", async () => {
  const fs = new MemoryFileSystem();
  let announce!: () => void, release!: () => void;
  const admitted = new Promise<void>(resolve => { announce = resolve; });
  const next = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => resolve({ done: false, value: new TextEncoder().encode("a\nlate\n") });
  });
  let returns = 0, written = "";
  Object.assign(fs, { readStream() { return { [Symbol.asyncIterator]() {
    return {
      next() { announce(); return next; },
      async return() { returns++; release(); return { done: true as const, value: undefined }; }
    };
  } }; } });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  const controller = new AbortController();
  const reason = new Error("cancel before late bytes");
  const execution = shell.exec("csvcut /late.csv", {
    signal: controller.signal,
    stdout: { async write(bytes) { written += new TextDecoder().decode(bytes); } }
  });
  const rejected = assert.rejects(execution, failure => failure === reason);
  try {
    await admitted;
    controller.abort(reason);
    await rejected;
    assert.equal(written, "");
    assert.equal(returns, 1);
    const version = await shell.exec("csvcut --version");
    assert.deepEqual({ status: version.exitCode, stdout: version.stdout, stderr: version.stderr }, {
      status: 0, stdout: "csvcut 2.2.0\n", stderr: ""
    });
  } finally { release(); await rejected; await shell.dispose(); }
  assert.equal(returns, 1);
});
