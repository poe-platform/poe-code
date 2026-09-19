import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("csvcut must not infer values"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

// Source contract: csvkit 2.2.0 utilities/csvcut.py and cli.py helpers.
test("csvcut stress empty headers bypass selectors but header cells validate them", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [command, stdin, stdout, stderr, status] of [
      ["csvcut -c missing -C invalid-range", "", "\n", "", 0],
      ["csvcut -c missing -C invalid-range", "\nx,y\n", "\n\n", "", 0],
      ["csvcut -x -c missing -C invalid-range", "\nx,y\n", "\n", "", 0],
      ["csvcut -c missing", '""\nx\n', "", "ColumnIdentifierError: Column 'missing' is invalid. It is neither an integer nor a column name. Column names are: ''\n", 1],
      ["csvcut -c ''", '""\nx\n', '""\nx\n', "", 0],
      ["csvcut -n", "", "", "StopIteration: \n", 1],
      ["csvcut -n -c missing -C invalid-range", "\nx,y\n", "", "", 0]
    ] as const) {
      const result = await shell.exec(command, { stdin });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status, stdout, stderr }, command + JSON.stringify(stdin));
    }
  } finally { await shell.dispose(); }
});

test("csvcut stress selected empty values drive deletion and line numbers count emitted rows", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [command, stdout] of [
      ["csvcut -l -c b,b -x", 'line_number,b,b\n1,001,001\n2,false,false\n3,null,null\n4, , \n'],
      ["csvcut -l --zero -c 1,1 -x", 'line_number,b,b\n1,001,001\n2,false,false\n3,null,null\n4, , \n'],
      ["csvcut -l -C 1,2 -x", "line_number\n"],
      ["csvcut -l -C 1,2", "line_number\n1\n2\n3\n4\n5\n6\n7\n"]
    ] as const) {
      const result = await shell.exec(command, { stdin: "a,b\nretained-source,\nshort\n,001\n,false\n,null\n, \n,,extra\n" });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout, stderr: "" }, command);
    }
  } finally { await shell.dispose(); }
});

test("csvcut stress names return before selector errors and oversized later records", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const command of ["csvcut -n -c missing -C invalid-range -z 1", "csvcut -n -l -x -z 1"]) {
      const result = await shell.exec(command, { stdin: "a,b\n\"long\nmultiline\",too-long\n" });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "  1: a\n  2: b\n", stderr: "" });
    }
    const result = await shell.exec("csvcut -H -n", { stdin: { async *[Symbol.asyncIterator]() {
      assert.fail("names/no-header rejection must precede stdin acquisition");
      yield new Uint8Array();
    } } });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr: "RequiredHeaderError: You cannot use --no-header-row with the -n or --names options.\n"
    });
  } finally { await shell.dispose(); }
});

test("csvcut stress skip-lines counts physical lines before multiline parsing", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut -K 2 -H -c b,a,b -x", { stdin: 'ignored\nignored\n001,"false\nnull",\n,,source\n' });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: 'b,a,b\n"false\nnull",001,"false\nnull"\n', stderr: ""
    });
  } finally { await shell.dispose(); }
});

test("csvcut stress names close admitted input once without reading beyond the decode window", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let reads = 0;
  let returns = 0;
  // CPython TextIO read-ahead is frozen at 8192 bytes. A smaller fragment
  // intentionally admits more transport reads before delivering the header.
  const bytes = new Uint8Array(8192).fill(0x78);
  bytes.set(new TextEncoder().encode("a,b\n"));
  try {
    const result = await shell.exec("csvcut -n", { stdin: { [Symbol.asyncIterator]() {
      return {
        async next() {
          if (++reads === 1) return { done: false as const, value: bytes };
          assert.fail("names-only must not pull a following source chunk");
        },
        async return() {
          returns++;
          bytes.fill(0x5a);
          return { done: true as const, value: undefined };
        }
      };
    } } });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "  1: a\n  2: b\n", stderr: ""
    });
    assert.equal(reads, 1);
    assert.equal(returns, 1);
  } finally { await shell.dispose(); }
});
