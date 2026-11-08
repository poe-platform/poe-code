import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "poe-code/csvkit";

const bytes = (value: string) => new TextEncoder().encode(value);
const settings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected formatting"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const exact = (result: { stdoutBytes: Uint8Array; stderr: string; exitCode: number }, stdout: string, stderr = "", exitCode = 0) => {
  assert.deepEqual(result.stdoutBytes, bytes(stdout));
  assert.equal(result.stderr, stderr);
  assert.equal(result.exitCode, exitCode);
};

test("csvformat user Unicode dialect counts codepoints and preserves independent input dialect", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(settings));
  try {
    exact(await shell.exec("csvformat -D '😀' -Q '🪶' -U 1", { stdin: 'a,b\n"x,y",🪶\n' }), "🪶a🪶😀🪶b🪶\n🪶x,y🪶😀🪶🪶🪶🪶\n");
    exact(await shell.exec("csvformat -D '😀😀'", { stdin: "" }), "", 'TypeError: "delimiter" must be a unicode character, not a string of length 2\n', 1);
  } finally { await shell.dispose(); }
});

test("csvformat user byte-sized input chunks preserve BOM, multibyte cells and multiline CRLF", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(settings));
  const input = bytes('\uFEFFa,b\r\n"é\r\n😀",z\r\n');
  let closed = 0;
  try {
    exact(await shell.exec("csvformat --add-bom -T", { stdin: (async function* () {
      try { for (const value of input) yield Uint8Array.of(value); }
      finally { closed++; }
    })() }), '\uFEFFa\tb\n"é\n\n😀"\tz\n');
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvformat user explicit filename leaves borrowed stdin untouched and changes only redirected VFS output", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(settings));
  const input = bytes('a,b\n001,NULL\n');
  await fs.writeFile("/-leading.csv", input);
  let reads = 0;
  try {
    exact(await shell.exec("csvformat -T -- /-leading.csv > /converted.tsv", { stdin: {
      [Symbol.asyncIterator]() { return { async next() { reads++; throw new Error("named input must not consume stdin"); } }; }
    } }), "");
    assert.equal(reads, 0);
    assert.deepEqual(await fs.readFile("/converted.tsv"), bytes("a\tb\n001\tNULL\n"));
    assert.deepEqual(await fs.readFile("/-leading.csv"), input);
  } finally { await shell.dispose(); }
});

test("csvformat user typed rows pad missing values and reject excess values before output", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(settings));
  try {
    exact(await shell.exec("csvformat -U 2", { stdin: "n,t\n1\n2,word\n" }), '"n","t"\n1,""\n2,"word"\n');
    exact(await shell.exec("csvformat -U 2", { stdin: "n,t\n1,word,extra\n" }), "", "ValueError: Row 0 has 3 values, but Table only has 2 columns.\n", 1);
    exact(await shell.exec("csvformat", { stdin: "n,t\n1,word,extra\n" }), "n,t\n1,word,extra\n");
  } finally { await shell.dispose(); }
});

test("csvformat user QUOTE_NOTNULL and QUOTE_STRINGS retain literal raw empty strings", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(settings));
  try {
    for (const mode of [4, 5]) {
      exact(await shell.exec(`csvformat -U ${mode}`, { stdin: "n,t\n001,NULL\n,\n" }), '"n","t"\n"001","NULL"\n"",""\n');
    }
  } finally { await shell.dispose(); }
});

test("csvformat user frozen number and text inference retains Decimal spelling and null semantics", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(settings));
  // Exact observations from csvkit 2.2.0 / CPython 3.14.2 / Agate 1.14.2.
  const cases = [
    ["001", "1"], ["-0.00", "-0.00"], ["1e3", "1E+3"],
    ["1E-3", "0.001"], ["NaN", "NaN"], ["inf", "Infinity"],
    ["1_000", "1000"], ["20%", "20"], ["€1.23", "1.23"],
    ["١٢٣", "123"], ["None", '""'], ["N/A", '""'],
    ["true", '"true"'], ["−1", '"−1"']
  ] as const;
  try {
    for (const [input, output] of cases) {
      exact(await shell.exec("csvformat -U 2", { stdin: `n,t\n"${input}",word\n` }), `"n","t"\n${output},"word"\n`);
    }
  } finally { await shell.dispose(); }
});

test("csvformat user arbitrary terminator escaping and blank single-field errors preserve completed rows", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(settings));
  try {
    exact(await shell.exec("csvformat -U 3 -P '#' -M END", { stdin: "h\nEND\n" }), "hEND#E#N#DEND");
    exact(await shell.exec("csvformat -U 3", { stdin: 'h\n""\n' }), "h\n", "Error: single empty field record must be quoted\n", 1);
  } finally { await shell.dispose(); }
});
