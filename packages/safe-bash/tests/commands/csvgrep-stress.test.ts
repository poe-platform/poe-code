import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected inference"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test("csvgrep Python assertions and escapes flow through the registered Shell engine", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [pattern, stdout] of [
      ["(?<=foo)bar", "a\nfoobar\n"],
      ["foo(?!bar)", "a\nfoobaz\n"],
      [String.raw`(?<=\U0001f600)b`, "a\n😀b\n"]
    ]) {
      const result = await shell.exec(`csvgrep -c a -r '${pattern}'`, { stdin: "a\nfoobar\nfoobaz\nbar\n😀b\n" });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout, stderr: "" });
    }
  } finally { await shell.dispose(); }
});

test("csvgrep stress complements aggregate AND and OR and preserves short rows", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const input = "a,b\nx,x\nx,y\ny,x\ny,y\nx\n";
    for (const [flags, stdout] of [
      ["", "a,b\nx,x\n"],
      ["-a", "a,b\nx,x\nx,y\ny,x\nx\n"],
      ["-i", "a,b\nx,y\ny,x\ny,y\nx\n"],
      ["-a -i", "a,b\ny,y\n"]
    ]) {
      const result = await shell.exec(`csvgrep -c a,b -m x ${flags}`, { stdin: input });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout, stderr: "" }, flags);
    }
    const missing = await shell.exec("csvgrep -c b -m y", { stdin: "a,b\nx\n" });
    assert.deepEqual({ status: missing.exitCode, stdout: missing.stdout, stderr: missing.stderr }, { status: 0, stdout: "a,b\n", stderr: "" });
  } finally { await shell.dispose(); }
});

test("csvgrep stress empty substring is omitted and header-only output succeeds", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [flags, stdin, stdout] of [
      ["-m ''", "a\nx\ny\n", "a\nx\ny\n"],
      ["-m '' -a", "a\nx\ny\n", "a\n"],
      ["-m '' -i", "a\nx\ny\n", "a\n"],
      ["-m z", "a\nx\ny\n", "a\n"],
      ["-m x", "a\n", "a\n"]
    ] as const) {
      const result = await shell.exec(`csvgrep -c a ${flags}`, { stdin });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout, stderr: "" }, flags);
    }
  } finally { await shell.dispose(); }
});

test("csvgrep stress line-number selectors filter original source positions", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [argv, stdout] of [
      ["-l -c a -m keep", "line_numbers,a\n2,keep\n4,keep\n"],
      ["-l -c 1 -m keep", "line_numbers,a\n2,keep\n4,keep\n"],
      ["-l -c 0 -m 4", "line_numbers,a\n4,keep\n"],
      ["-l --zero -c 0 -m keep", "line_numbers,a\n2,keep\n4,keep\n"],
      ["-l --zero -c=-1 -m 4", "line_numbers,a\n4,keep\n"]
    ]) {
      const result = await shell.exec(`csvgrep ${argv}`, { stdin: "a\ndrop\nkeep\ndrop\nkeep\n" });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout, stderr: "" }, argv);
    }
  } finally { await shell.dispose(); }
});

test("csvgrep stress names still eagerly opens and closes the match file without consuming it", async () => {
  const events: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile(path, settings) {
      events.push(`open:${path}:${settings.cwd}`);
      settings.signal.throwIfAborted();
      return { async *lines() { events.push("read"); yield "unused"; }, async close() { events.push("close"); } };
    }
  }));
  try {
    const result = await shell.exec("csvgrep -n -f matches.txt", { stdin: "a,b\nx,y\n" });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "  1: a\n  2: b\n", stderr: "" });
    assert.deepEqual(events, ["open:matches.txt:/", "close"]);
  } finally { await shell.dispose(); }
});

test("csvgrep stress match-file rstrip removes Unicode trailing whitespace without removing leading whitespace", async () => {
  const events: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile() {
      events.push("open");
      return { async *lines() { events.push("read"); yield "x \t\u00a0\r\n"; yield " y\n"; }, async close() { events.push("close"); } };
    }
  }));
  try {
    const result = await shell.exec("csvgrep -c a -m y -f matches.txt", { stdin: "a\nx\ny\n y\nx \n" });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "a\nx\n y\n", stderr: "" });
    assert.deepEqual(events, ["open", "read", "close"]);
  } finally { await shell.dispose(); }
});

test("csvgrep stress missing selected cells participate in exact empty match-file membership", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile() {
      return { async *lines() { yield "\n"; }, async close() {} };
    }
  }));
  try {
    const result = await shell.exec("csvgrep -c b -f empty-value.txt", { stdin: "a,b\nx\ny,z\nw,\n" });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "a,b\nx\nw,\n", stderr: "" });
  } finally { await shell.dispose(); }
});

test("csvgrep stress Python regex Unicode decimal and ASCII flag classifications differ", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [pattern, stdin, stdout] of [
      ["\\d", "a\n١\n2\nX\n", "a\n١\n2\n"],
      ["(?a)\\d", "a\n١\n2\nX\n", "a\n2\n"],
      ["(?i)^x$", "a\nX\ny\n", "a\nX\n"]
    ] as const) {
      const result = await shell.exec(`csvgrep -c a -r '${pattern}'`, { stdin });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout, stderr: "" }, pattern);
    }
  } finally { await shell.dispose(); }
});

test("csvgrep stress unqualified Unicode ignore-case remains an explicit blocker", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvgrep -c a -r '(?i)^x$'", { stdin: "a\n١\nX\n" });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 78, stdout: "a\n", stderr: "csvkit: unsupported or unqualified: Python regex syntax or diagnostic outside qualified subset\n"
    });
  } finally { await shell.dispose(); }
});

test("csvgrep stress regex work budget accumulates across rows", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, limits: { maxRegexWork: 6 } }));
  try {
    const single = await shell.exec("csvgrep -c a -r x", { stdin: "a\nx\n" });
    assert.deepEqual({ status: single.exitCode, stdout: single.stdout, stderr: single.stderr }, { status: 0, stdout: "a\nx\n", stderr: "" });
    const repeated = await shell.exec("csvgrep -c a -r x", { stdin: "a\nx\nx\n" });
    assert.deepEqual({ status: repeated.exitCode, stdout: repeated.stdout, stderr: repeated.stderr }, {
      status: 78, stdout: "a\nx\n", stderr: "csvkit: unsupported or unqualified: Python regex work budget exceeded\n"
    });
  } finally { await shell.dispose(); }
});

test("csvgrep stress cancellation during header backpressure retires borrowed stdin", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const controller = new AbortController();
  let entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let retired = false;
  const writes: string[] = [];
  try {
    const execution = shell.exec("csvgrep -c a -r x", {
      signal: controller.signal,
      stdin: { async *[Symbol.asyncIterator]() {
        try { yield new TextEncoder().encode("a\nx\nx\n"); }
        finally { retired = true; }
      } },
      stdout: { async write(bytes) { writes.push(new TextDecoder().decode(bytes)); entered(); await blocked; } }
    });
    await writing;
    assert.deepEqual(writes, ["a\n"]);
    controller.abort(false);
    await assert.rejects(execution, reason => reason === false);
    assert.equal(retired, true);
    assert.deepEqual(writes, ["a\n"]);
  } finally { release(); await shell.dispose(); }
});
