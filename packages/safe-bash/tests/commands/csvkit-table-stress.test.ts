import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { parseArguments, utf8Codec } from "poe-code/csvkit";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const bytes = (text: string) => new TextEncoder().encode(text);

// Captured with frozen CPython 3.14.2 / csvkit 2.2.0 / Agate 1.14.2,
// LC_ALL=C LANG=C TZ=UTC, using CSVFormat's real stdin and output streams.
test("csvformat QUOTE_NONNUMERIC infers whole columns and preserves decimal scale", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [argv, stdin, stdout] of [
      ["", "a,b,c,d,e,f\n001,1.20,true,2020-01-01,NA,hello\n002,2.00,false,2020-02-01,.,world\n", '"a","b","c","d","e","f"\n1,1.20,"true","2020-01-01","","hello"\n2,2.00,"false","2020-02-01","","world"\n'],
      ["", "a,b\n1,foo\ntext,bar\n", '"a","b"\n"1","foo"\n"text","bar"\n'],
      ["", "a,b\n 1.20 , N/A \n2.30, NULL \n", '"a","b"\n1.20,""\n2.30,""\n'],
      ["-l", "a,b\n001,NA\n002,none\n", '"line_number","a","b"\n1,1,""\n2,2,""\n'],
      ["-H", "001,true\n002,false\n", '"a","b"\n1,"true"\n2,"false"\n'],
      ["-E", "a,b\n001,true\n002,false\n", '1,"true"\n2,"false"\n'],
      ["", 'a\n""\n', '"a"\n""\n'],
      ["", "a\n", '"a"\n'],
      ["", "a\n\n1\n", '"a"\n""\n1\n'],
      ["", "", "\n"],
      ["", "a,b\n1\n", '"a","b"\n1,""\n'],
      ["", "a\n9007199254740993\n9007199254740995\n", '"a"\n9007199254740993\n9007199254740995\n'],
      ["", "a\n1e-7\n1e+4\n", '"a"\n1E-7\n1E+4\n'],
      ["", "a\n-0.00\n+01.00\n", '"a"\n-0.00\n1.00\n'],
      ["", "a\n10%\n20%\n", '"a"\n10\n20\n'],
      ["", "a\n$1.00\n$2.00\n", '"a"\n1.00\n2.00\n'],
      ["", "a\n１２３\n４５６\n", '"a"\n123\n456\n'],
      ["", "a\nNaN\nInfinity\n", '"a"\nNaN\nInfinity\n'],
      ["", "a\n0x10\n001\n", '"a"\n"0x10"\n"001"\n'],
    ] as const) {
      const result = await shell.exec(`csvformat -U 2 ${argv}`, { stdin });
      assert.deepEqual({ stdout: result.stdoutBytes, stderr: result.stderrBytes, status: result.exitCode },
        { stdout: bytes(stdout), stderr: bytes(""), status: 0 }, `${argv}: ${JSON.stringify(stdin)}`);
    }
  } finally { await shell.dispose(); }
});

test("typed csvformat does not erase distinctions in later raw commands or virtual input", async () => {
  const fs = new MemoryFileSystem();
  const stdin = "a,b\n001,NA\n002,none\n";
  await fs.writeFile("/input.csv", bytes(stdin));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const typed = await shell.exec("csvformat -U 2 /input.csv > /typed.csv");
    assert.deepEqual({ stdout: typed.stdout, stderr: typed.stderr, status: typed.exitCode }, { stdout: "", stderr: "", status: 0 });
    assert.deepEqual(await fs.readFile("/typed.csv"), bytes('"a","b"\n1,""\n2,""\n'));
    for (const command of ["csvformat", "csvcut"]) {
      const raw = await shell.exec(`${command} /input.csv`);
      assert.deepEqual({ stdout: raw.stdoutBytes, stderr: raw.stderrBytes, status: raw.exitCode },
        { stdout: bytes(stdin), stderr: bytes(""), status: 0 });
    }
    assert.deepEqual(await fs.readFile("/input.csv"), bytes(stdin));
  } finally { await shell.dispose(); }
});

test("csvkit null-value stores only the last occurrence and consumes apparent file operands", async () => {
  for (const [argv, nullValues, blanks, noInference] of [
    [["--null-value", "foo", "--null-value", "bar"], ["bar"], false, false],
    [["--null-value", "foo", "bar", "--blanks"], ["foo", "bar"], true, false],
    [["--null-value", "foo", "input.csv"], ["foo", "input.csv"], false, false],
    [["--blanks", "--null-value", "FOO", "--no-inference"], ["FOO"], true, true]
  ] as const) {
    const parsed = await parseArguments("csvsort", argv.map(bytes), { limits: { maxArguments: 100, maxArgumentBytes: 10000 } });
    if (parsed.kind !== "parsed") assert.fail(parsed.stderr);
    try {
      assert.deepEqual({ nullValues: parsed.options.null_values, input: parsed.options.input_path,
        blanks: parsed.options.blanks, noInference: parsed.options.no_inference },
      { nullValues, input: null, blanks, noInference });
    } finally { await parsed.dispose(); }
  }
});

test("typed csvformat reads fragmented streams and closes a failed named producer before returning", async () => {
  const fs = new MemoryFileSystem();
  let closed = 0;
  Object.assign(fs, {
    async readFile() { assert.fail("stream-capable input must not use bulk readFile"); },
    async *readStream(path: string, settings: { signal: AbortSignal }) {
      assert.equal(path, "/input.csv");
      settings.signal.throwIfAborted();
      try {
        for (const byte of bytes("a\n001\n002\n")) {
          yield new Uint8Array();
          yield Uint8Array.of(byte);
        }
        throw Object.assign(new Error("late denied read"), { code: "EACCES" });
      } finally { closed++; }
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvformat -U 2 /input.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "PermissionError: [Errno 13] Permission denied: '/input.csv'\n", status: 1
    });
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvsort frozen Decimal ordering handles signs, exponents, stable zeros, infinity and null reversal", async () => {
  const stdin = "a\n-1E+4\n-1.2\n-1.20\n-1E-7\n-0.00\n0.00\n1E-7\n1.2\n1E+4\nInfinity\n-Infinity\nNULL\n";
  const ascending = 'a\n-Infinity\n-1E+4\n-1.2\n-1.20\n-1E-7\n-0.00\n0.00\n1E-7\n1.2\n1E+4\nInfinity\n""\n';
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [argv, stdout] of [
      ["", ascending], ["-i", ascending],
      ["-r", 'a\n""\nInfinity\n1E+4\n1.2\n1E-7\n-0.00\n0.00\n-1E-7\n-1.2\n-1.20\n-1E+4\n-Infinity\n'],
      ["--no-inference", 'a\n-0.00\n-1.2\n-1.20\n-1E+4\n-1E-7\n-Infinity\n0.00\n1.2\n1E+4\n1E-7\nInfinity\n""\n']
    ] as const) {
      const result = await shell.exec(`csvsort -y 0 -c a ${argv}`, { stdin });
      assert.deepEqual({ stdout: result.stdoutBytes, stderr: result.stderrBytes, status: result.exitCode },
        { stdout: bytes(stdout), stderr: bytes(""), status: 0 }, argv);
    }
  } finally { await shell.dispose(); }
});

test("csvsort mixed numeric and text columns infer and sort without temporal blockers", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvsort -c a", { stdin: "a,b\n2,hello\n1,world\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "a,b\n1,world\n2,hello\n", stderr: "", status: 0
    });
  } finally { await shell.dispose(); }
});
