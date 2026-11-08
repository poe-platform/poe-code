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

// Exact finite cases derived from the frozen precision-28 HALF_EVEN context.
// No binary-float tolerance applies to executable output.
test("csvformat numeric Decimal rounding retains ties, sticky digits and carry scale", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvformat -U 2", { stdin:
      "n\n1.2345678901234567890123456785\n1.2345678901234567890123456795\n1.23456789012345678901234567850001\n9.9999999999999999999999999995\n-0.0000000\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: '"n"\n1.234567890123456789012345678\n1.234567890123456789012345680\n1.234567890123456789012345679\n10.00000000000000000000000000\n-0E-7\n',
      stderr: "", status: 0
    });
  } finally { await shell.dispose(); }
});

test("csvsort compares adjacent huge integers and exponent decimals without float collapse", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const input = "n,label\n9007199254740993,30\n9007199254740992,20\n9007199254740994,40\n-9007199254740993,10\n1E-7,50\n0.0000001000,60\n-0.00,70\n0.00,80\n";
    for (const [argv, output] of [
      ["", "n,label\n-9007199254740993,10\n-0.00,70\n0.00,80\n1E-7,50\n1.000E-7,60\n9007199254740992,20\n9007199254740993,30\n9007199254740994,40\n"],
      ["--reverse", "n,label\n9007199254740994,40\n9007199254740993,30\n9007199254740992,20\n1E-7,50\n1.000E-7,60\n-0.00,70\n0.00,80\n-9007199254740993,10\n"]
    ] as const) {
      const result = await shell.exec(`csvsort -c n ${argv}`, { stdin: input });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: output, stderr: "", status: 0 });
    }
  } finally { await shell.dispose(); }
});
