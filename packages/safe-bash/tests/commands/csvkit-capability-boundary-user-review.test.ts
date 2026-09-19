import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { FsError } from "../../src/contracts/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

for (const synchronous of [false, true]) test(`csvlook ${synchronous ? "synchronous" : "asynchronous"} probe acquisition failure leaves no deferred cleanup failure`, async () => {
  let opens = 0;
  const fs = new MemoryFileSystem();
  Object.assign(fs, {
    open() {
      opens++;
      const failure = new FsError("EACCES", { path: "/private.csv" });
      if (synchronous) throw failure;
      return Promise.reject(failure);
    },
    readStream() { assert.fail("failed probe must not open a content stream"); },
    async readFile() { assert.fail("failed probe must not read contents"); }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec("csvlook -I -y 0 -H --max-rows 0 /private.csv", {
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("named probe must not advance stdin"); yield new Uint8Array(); } }
    });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "PermissionError: [Errno 13] Permission denied: '/private.csv'\n", status: 1
    });
    assert.equal(opens, 1);
    assert.equal((await shell.exec("csvcut --version")).exitCode, 0);
  } finally { await shell.dispose(); }
  assert.equal(opens, 1, "disposal must not retry failed acquisition");
});

test("csvlook explicit input-open capability takes precedence over every VFS read capability", async () => {
  const effects: unknown[] = [];
  const fs = new MemoryFileSystem();
  Object.assign(fs, {
    open() { assert.fail("explicit probe owns admission"); },
    readStream() { assert.fail("zero-row probe must not acquire a content stream"); },
    async readFile() { assert.fail("zero-row probe must not read contents"); }
  });
  const shell = new Shell({ fs, cwd: "/virtual" }).use(csvkitCommands({
    ...bindings,
    async probeInputOpen(path, settings) {
      settings.signal.throwIfAborted();
      effects.push([path, settings.cwd]);
    }
  }));
  try {
    const result = await shell.exec("csvlook -I -y 0 -H --max-rows 0 ../data.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "||\n|  |\n", stderr: "", status: 0
    });
    assert.deepEqual(effects, [["../data.csv", "/virtual"]]);
  } finally { await shell.dispose(); }
});

test("sql2csv absent SQLite capability reports a blocker without consuming supplied query stdin", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec("sql2csv --db sqlite:///:memory: --query 'SELECT 1'", {
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("explicit query must not advance stdin"); yield new Uint8Array(); } }
    });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "csvkit: unsupported or unqualified: database capability sqlite\n", status: 78
    });
  } finally { await shell.dispose(); }
});

for (const synchronous of [false, true]) test(`sql2csv ${synchronous ? "synchronous" : "asynchronous"} failed driver acquisition is not retried by cleanup`, async () => {
  let connects = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({
    ...bindings,
    databases: [{ profile: "failed-admission-user-review", schemes: ["review"], connect() {
      connects++;
      const failure = new Error("trusted driver admission failed");
      if (synchronous) throw failure;
      return Promise.reject(failure);
    } }]
  }));
  try {
    const result = await shell.exec("sql2csv --db review://owned --query 'SELECT 1'");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "shell: line 1: internal error\n", status: 1
    });
    assert.equal(connects, 1);
    assert.equal((await shell.exec("sql2csv --version")).exitCode, 0);
  } finally { await shell.dispose(); }
  assert.equal(connects, 1);
});
