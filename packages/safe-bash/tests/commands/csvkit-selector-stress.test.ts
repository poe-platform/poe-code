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

// Pinned to csvkit 2.2.0 cli.py's name-before-int and separate range branches.
test("csvkit selector stress signed and spaced integer names resolve before conversion", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut -c '+1,-1, 1,1'", { stdin: "other,+1,-1, 1\na,b,c,d\n" });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "+1,-1, 1,other\nb,c,d,a\n", stderr: ""
    });
  } finally { await shell.dispose(); }
});

test("csvkit selector stress digit names, literal quote names and duplicate first matches", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut -c '1,\"1\",same,same,3'", { stdin: 'other,1,same,same,"""1"""\na,b,c,d,e\n' });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: 'other,"""1""",same,same,same\na,e,c,c,c\n', stderr: ""
    });
  } finally { await shell.dispose(); }
});

test("csvkit selector stress selection and exclusion open ends keep distinct defaults", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [argv, stdout, status, stderr] of [
      ["-c 2-", "b,c,d\nB,C,D\n", 0, ""],
      ["-C 2-", "a,d\nA,D\n", 0, ""],
      ["--zero -C 2-", "a,b\nA,B\n", 0, ""],
      ["--zero -c :2", "b,c\nB,C\n", 0, ""],
      ["--zero -c 2-", "", 1, "ColumnIdentifierError: Column 4 is invalid. The last column is 'd' at index 3.\n"],
      ["-c 4:2", "\n\n", 0, ""],
      ["-c d,a,d,2:3 -C unknown,99", "d,a,d,b,c\nD,A,D,B,C\n", 0, ""]
    ] as const) {
      const result = await shell.exec(`csvcut ${argv}`, { stdin: "a,b,c,d\nA,B,C,D\n" });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status, stdout, stderr }, argv);
    }
  } finally { await shell.dispose(); }
});

test("csvkit selector stress existing range-shaped names win before range parsing", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut -c 'a-b,a:b,1-2' -C absent", { stdin: "a-b,a:b,1-2\nx,y,z\n" });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "a-b,a:b,1-2\nx,y,z\n", stderr: ""
    });
  } finally { await shell.dispose(); }
});

test("csvkit selector stress grep line numbers shift the observable column offset", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const argv of ["-l -c 0", "--zero -l --columns=-1"]) {
      const result = await shell.exec(`csvgrep ${argv} -m 2`, { stdin: "a,b\nx,y\nu,v\n" });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 0, stdout: "line_numbers,a,b\n2,u,v\n", stderr: ""
      }, argv);
    }
  } finally { await shell.dispose(); }
});

test("csvkit selector stress names use exact padding and forbid no-header", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [argv, stdout, status, stderr] of [
      ["-n", "  1: a\n  2: a\n  3: 1\n", 0, ""],
      ["--zero -n", "  0: a\n  1: a\n  2: 1\n", 0, ""],
      ["-H -n", "", 1, "RequiredHeaderError: You cannot use --no-header-row with the -n or --names options.\n"]
    ] as const) {
      const result = await shell.exec(`csvcut ${argv}`, { stdin: "a,a,1\nx,y,z\n" });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status, stdout, stderr }, argv);
    }
    const input = Array.from({ length: 28 }, (_, index) => `v${index}`).join(",") + "\n";
    const result = await shell.exec("csvcut -H -c z,aa,ab", { stdin: input });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "z,aa,ab\nv25,v26,v27\n", stderr: ""
    });
  } finally { await shell.dispose(); }
});

test("csvkit selector stress csvjoin intentionally ignores zero-based selection", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/left.csv", new TextEncoder().encode("key,left\nx,L\n"));
  await fs.writeFile("/right.csv", new TextEncoder().encode("key,right\nx,R\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    for (const zero of ["", "--zero "]) {
      const result = await shell.exec(`csvjoin -I -y0 ${zero}-c 1 left.csv right.csv`);
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 0, stdout: "key,left,right\nx,L,R\n", stderr: ""
      });
    }
    const result = await shell.exec("csvjoin -I -y0 --zero -c 0 left.csv right.csv");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr: "ColumnIdentifierError: Column 0 is invalid. Columns are 1-based.\n"
    });
    assert.equal(new TextDecoder().decode(await fs.readFile("/left.csv")), "key,left\nx,L\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/right.csv")), "key,right\nx,R\n");
  } finally { await shell.dispose(); }
});
