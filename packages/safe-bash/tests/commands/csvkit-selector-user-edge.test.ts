import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

// Source-derived expectations: docs/csvkit/table-selector-quirks.md S01–S04/N01.
test("csvkit user selectors distinguish Unicode decimal, digit and numeric names", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const input = "first,２,Ⅳ,½,²\nA,B,C,D,E\n";
    for (const [selector, stdout] of [["２", "２\nB\n"], ["١", "first\nA\n"], ["Ⅳ,½,Ⅳ", "Ⅳ,½,Ⅳ\nC,D,C\n"]]) {
      const result = await shell.exec(`csvcut -c '${selector}'`, { stdin: input });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout, stderr: "" }, selector);
    }
    const result = await shell.exec("csvcut -c '²'", { stdin: input });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr: "ColumnIdentifierError: Column '²' is invalid. It is neither an integer nor a column name. Column names are: 'first', '２', 'Ⅳ', '½', '²'\n"
    });
  } finally { await shell.dispose(); }
});

test("csvkit user selectors preserve whitespace, empty names and literal quotes", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut -c ' 2,2 ,1_0,\"1\",, 2'", { stdin: 'first, 2,2 ,1_0,"""1""",\nA,B,C,D,E,F\n' });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: ' 2,2 ,1_0,"""1""",, 2\nB,C,D,E,F,B\n', stderr: ""
    });
    const empty = await shell.exec("csvcut -c ''", { stdin: "a,b\nA,B\n" });
    assert.deepEqual({ status: empty.exitCode, stdout: empty.stdout, stderr: empty.stderr }, { status: 0, stdout: "a,b\nA,B\n", stderr: "" });
  } finally { await shell.dispose(); }
});

test("csvkit user repeated ranges and exclusions do not normalize ordering", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [argv, stdout] of [
      ["-c 3,1:3,2,3:1 -C 1,unknown,99", "c,b,c,b\nC,B,C,B\n"],
      ["-c : -C :", "d\nD\n"],
      ["--zero -c 0:3 -C :", "a\nA\n"],
      ["-c 4:1 -C 99", "\n\n"],
      ["-c 1:4 -C 4:1", "a,b,c,d\nA,B,C,D\n"]
    ]) {
      const result = await shell.exec(`csvcut ${argv}`, { stdin: "a,b,c,d\nA,B,C,D\n" });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout, stderr: "" }, argv);
    }
  } finally { await shell.dispose(); }
});

test("csvkit user integer ranges bypass signed names and reject unknown range exclusions", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [argv, stderr] of [
      ["-c=-1:1", "ColumnIdentifierError: Column -1 is invalid. Columns are 1-based.\n"],
      ["-C unknown-unknown", "ColumnIdentifierError: Invalid range %s. Ranges must be two integers separated by a - or : character.\n"],
      ["-C 1:99", "ColumnIdentifierError: Column 3 is invalid. The last column is 'b' at index 2.\n"],
      ["--zero -c :", "ColumnIdentifierError: Column 2 is invalid. The last column is 'b' at index 1.\n"]
    ]) {
      const result = await shell.exec(`csvcut ${argv}`, { stdin: "-1,b\nA,B\n" });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 1, stdout: "", stderr }, argv);
    }
  } finally { await shell.dispose(); }
});

test("csvkit user names are source-helper output across tools and line-number offsets", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const command of ["csvcut", "csvgrep", "csvsort", "csvstat"]) {
      for (const [argv, stdout, status, stderr] of [
        ["-n", "  1: \n  2: a\n  3: a\n", 0, ""],
        ["--zero -n", "  0: \n  1: a\n  2: a\n", 0, ""],
        ["-H -n", "", 1, "RequiredHeaderError: You cannot use --no-header-row with the -n or --names options.\n"]
      ] as const) {
        const result = await shell.exec(`${command} ${argv}`, { stdin: ",a,a\nA,B,C\n" });
        assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status, stdout, stderr }, `${command} ${argv}`);
      }
    }
    const result = await shell.exec("csvcut --zero -l -n", { stdin: "a,b\nA,B\n" });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "  0: a\n  1: b\n", stderr: "" });
  } finally { await shell.dispose(); }
});

test("csvkit user invalid selectors retain Agate tuple versus raw list diagnostic punctuation", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/left.csv", new TextEncoder().encode("a\nA\n"));
  await fs.writeFile("/right.csv", new TextEncoder().encode("a\nA\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    for (const [command, names] of [["csvcut", "'a'"], ["csvsort -I -y0", "'a',"]]) {
      const result = await shell.exec(`${command} -c unknown`, { stdin: "a\nA\n" });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 1, stdout: "", stderr: `ColumnIdentifierError: Column 'unknown' is invalid. It is neither an integer nor a column name. Column names are: ${names}\n`
      }, command);
    }
    const join = await shell.exec("csvjoin -I -y0 -c unknown left.csv right.csv");
    assert.deepEqual({ status: join.exitCode, stdout: join.stdout, stderr: join.stderr }, {
      status: 1, stdout: "", stderr: "ColumnIdentifierError: Column 'unknown' is invalid. It is neither an integer nor a column name. Column names are: 'a',\n"
    });
    assert.equal(new TextDecoder().decode(await fs.readFile("/left.csv")), "a\nA\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/right.csv")), "a\nA\n");
  } finally { await shell.dispose(); }
});

test("csvkit user default headers carry through zz into aaa without Agate naming", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const input = Array.from({ length: 704 }, (_, index) => `v${index}`).join(",") + "\n";
    const result = await shell.exec("csvcut -H -c az,ba,zz,aaa,aab,aaa", { stdin: input });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "az,ba,zz,aaa,aab,aaa\nv51,v52,v701,v702,v703,v702\n", stderr: ""
    });
  } finally { await shell.dispose(); }
});
