import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test("csvformat strips default-locale adornments without losing Decimal precision or signed zero", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvformat -U2", { stdin:
      'n\n"$9,007,199,254,740,993.00"\n-£0.0000\n25.50%\n+2.3400E+3\n' });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: '"n"\n9007199254740993.00\n-0.0000\n25.50\n2340.0\n', stderr: "", status: 0
    });
  } finally { await shell.dispose(); }
});

test("csvsort pipeline preserves stable decimal ties, reverses null placement and leaves source bytes intact", async () => {
  const fs = new MemoryFileSystem();
  const input = new TextEncoder().encode("n,row\n9007199254740993.00,20\n9007199254740993,30\n9007199254740992,10\nNA,40\n");
  await fs.writeFile("/numbers.csv", input);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvsort -y0 -c n --reverse numbers.csv | csvcut -c row");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "row\n40\n20\n30\n10\n", stderr: "", status: 0
    });
    assert.deepEqual(await fs.readFile("/numbers.csv"), input);
  } finally { await shell.dispose(); }
});

test("csvformat admits finite exponent boundaries and refuses larger magnitudes before any output", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    limits: { maxDecimalDigits: 4, maxDecimalExponent: 4 } }));
  try {
    for (const [input, expected] of [
      ["n\n1e4\n", { stdout: '"n"\n1E+4\n', stderr: "", status: 0 }],
      ["n\n1e-4\n", { stdout: '"n"\n0.0001\n', stderr: "", status: 0 }],
      ["n\n1e5\n", { stdout: "", stderr: "csvkit: unsupported or unqualified: Decimal admission budget exceeded\n", status: 78 }],
      ["n\n1e-5\n", { stdout: "", stderr: "csvkit: unsupported or unqualified: Decimal admission budget exceeded\n", status: 78 }],
      ["n\nNaN12345\n", { stdout: "", stderr: "csvkit: unsupported or unqualified: Decimal admission budget exceeded\n", status: 78 }],
      ["n\n12345\n", { stdout: "", stderr: "csvkit: unsupported or unqualified: Decimal admission budget exceeded\n", status: 78 }]
    ] as const) {
      const result = await shell.exec("csvformat -U2", { stdin: input });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, expected);
    }
  } finally { await shell.dispose(); }
});
