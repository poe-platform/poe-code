import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "poe-code/csvkit";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

// Independently captured from the frozen CPython 3.14.2 / csvkit 2.2.0 /
// Agate 1.14.2 executable streams under LC_ALL=C LANG=C TZ=UTC.
test("csvformat U2 respects Decimal NaN payload precision and signed zero scale", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const stdin = "a\nNaN123456789012345678901234567890123\nNaN10000000000000000000000000000\n-NaN12\n+NaN003\n--NaN123\n0E-20\n-0E+2\n0.00E+5\n";
    const result = await shell.exec("csvformat -U 2", { stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: '"a"\nNaN6789012345678901234567890123\nNaN\nNaN12\nNaN3\n-NaN123\n0E-20\n-0E+2\n0E+3\n', stderr: "", status: 0
    });
  } finally { await shell.dispose(); }
});

test("csvsort no-inference retains Text null matching and store-action operand consumption", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode("a\nwrong file\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    for (const [argv, stdin, stdout] of [
      ["--null-value foo --null-value bar", "a\nfoo\nbar\n", 'a\nfoo\n""\n'],
      ["--null-value '  FOO  '", "a\nfoo\n  FOO  \n", "a\n  FOO  \nfoo\n"],
      ["--blanks --null-value NA", 'a\n NA \n""\n', 'a\n""\n""\n'],
      ["--null-value foo /input.csv", "a\nfoo\n/input.csv\n", 'a\n""\n""\n'],
      ["", "a\n N/A \n . \nnull\n none \nNA\ntext\n", 'a\ntext\n""\n""\n""\n""\n""\n']
    ] as const) {
      const result = await shell.exec(`csvsort -y 0 --no-inference ${argv}`, { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout, stderr: "", status: 0 }, argv);
    }
    assert.equal(new TextDecoder().decode(await fs.readFile("/input.csv")), "a\nwrong file\n");
  } finally { await shell.dispose(); }
});

test("csvformat U2 rejects later overlong rows without partial output", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvformat -U 2", { stdin: "a,b\n1\n2,3,4\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "ValueError: Row 1 has 3 values, but Table only has 2 columns.\n", status: 1
    });
  } finally { await shell.dispose(); }
});
