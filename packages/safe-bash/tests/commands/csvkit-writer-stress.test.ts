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
const bytes = (text: string) => new TextEncoder().encode(text);
const exact = (result: { stdout: string; stderr: string; exitCode: number }, stdout: string) => {
  assert.deepEqual(bytes(result.stdout), bytes(stdout));
  assert.deepEqual(bytes(result.stderr), bytes(""));
  assert.equal(result.exitCode, 0);
};

test("csvgrep physical line_numbers survive filtering before csvcut emitted line_number ordinals", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const input = 'a,b\nignore,q\n"keep\nsecond",x\nignore,z\nkeep,y\n';
  try {
    exact(await shell.exec("csvgrep -l -c a -m keep", { stdin: input }),
      'line_numbers,a,b\n3,"keep\nsecond",x\n5,keep,y\n');
    exact(await shell.exec("csvgrep -l -c a -m keep | csvcut -l", { stdin: input }),
      'line_number,line_numbers,a,b\n1,3,"keep\nsecond",x\n2,5,keep,y\n');
  } finally { await shell.dispose(); }
});

test("csvformat invocation dialect cannot leak to csvcut or later csvformat", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const input = 'a,b\n"x,y","z""q"\n';
  try {
    exact(await shell.exec("csvformat -D ';' -U 1 -Q '\"'", { stdin: input }),
      '"a";"b"\n"x,y";"z""q"\n');
    exact(await shell.exec("csvcut", { stdin: input }), input);
    exact(await shell.exec("csvformat", { stdin: input }), input);
  } finally { await shell.dispose(); }
});

test("csvformat newer output quote modes quote supported string inputs", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const quoting of [4, 5]) {
      exact(await shell.exec(`csvformat -U ${quoting}`, { stdin: 'a,b\n,""\n' }),
        '"a","b"\n"",""\n');
    }
  } finally { await shell.dispose(); }
});

test("csvkit universal input normalization and LF output bytes remain intact through VFS redirection", async () => {
  const fs = new MemoryFileSystem();
  const input = bytes('a,b\r\n"x\r\ny",z\r\n');
  await fs.writeFile("/input.csv", input);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    exact(await shell.exec("csvcut /input.csv > /output.csv"), "");
    assert.deepEqual(await fs.readFile("/output.csv"), bytes('a,b\n"x\ny",z\n'));
    assert.deepEqual(await fs.readFile("/input.csv"), input);
  } finally { await shell.dispose(); }
});

test("csvformat preserves empty fields from input quoting modes 2/4/5", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    exact(await shell.exec("csvformat -u2", { stdin: '"a","b"\n,""\n' }), "a,b\n,\n");
    for (const quoting of [4, 5]) {
      const result = await shell.exec(`csvformat -u ${quoting}`, { stdin: '"a","b"\n,""\n' });
      exact(result, "a,b\n,\n");
    }
  } finally { await shell.dispose(); }
});

test("csvkit writer stress checks quote modes and embedded newline bytes through registered tools", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const encoder = new TextEncoder();
  try {
    for (const [command, stdin, stdout, stderr, status] of [
      ["csvformat", 'a,b\r\n"x\ry","p""q"\r\n', 'a,b\n"x\ny","p""q"\n', "", 0],
      ["csvformat -U 1", "a,b\nx,\n", '"a","b"\n"x",""\n', "", 0],
      ["csvformat -U 4", "a,b\n1,\n", '"a","b"\n"1",""\n', "", 0],
      ["csvformat -U 5", "a,b\n1,\n", '"a","b"\n"1",""\n', "", 0],
      ["csvformat -U 3 -P '~'", 'a,b\n"x,y","p""q"\n', 'a,b\nx~,y,p~"q\n', "", 0],
      ["csvformat -B -P '~'", 'a,b\n"x,y","p""q"\n', 'a,b\n"x,y",p~"q\n', "", 0],
      ["csvformat -U 3", 'a\n"x,y"\n', "a\n", "Error: need to escape, but no escapechar set\n", 1],
      ["csvformat", '\n\n""\n', '\n\n""\n', "", 0],
      ["csvformat -A", 'a,b\n"x\u001fy",z\n', 'a\u001fb\u001e"x\u001fy"\u001fz\u001e', "", 0],
      ["csvformat -U 2", "a\n1\n", '"a"\n1\n', "", 0]
    ] as const) {
      const result = await shell.exec(command, { stdin });
      assert.equal(result.exitCode, status, command);
      assert.deepEqual(result.stdoutBytes, encoder.encode(stdout), command);
      assert.deepEqual(result.stderrBytes, encoder.encode(stderr), command);
    }
  } finally { await shell.dispose(); }
});

test("csvkit writer stress distinguishes physical reader numbering from filtered writer ordinals", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const stdin = 'name,value\r\n"drop\r\nfirst",x\r\n"keep\r\nsecond",y\r\nkeep,z\r\n';
  try {
    const physical = await shell.exec("csvgrep -l -c name -m keep", { stdin });
    // The reader retains quoted CRLF; Agate replaces CR with LF rather than
    // collapsing the pair. Physical numbering still counts one physical line.
    assert.deepEqual(physical.stdoutBytes, new TextEncoder().encode('line_numbers,name,value\n4,"keep\n\nsecond",y\n5,keep,z\n'));
    assert.equal(physical.stderr, "");
    assert.equal(physical.exitCode, 0);
    const ordinal = await shell.exec("csvgrep -c name -m keep | csvcut -l", { stdin });
    assert.deepEqual(ordinal.stdoutBytes, new TextEncoder().encode('line_number,name,value\n1,"keep\n\nsecond",y\n2,keep,z\n'));
    assert.equal(ordinal.stderr, "");
    assert.equal(ordinal.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("csvkit writer stress invocation dialects and failed rows do not leak into the next command", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const encoder = new TextEncoder();
  try {
    await fs.writeFile("/input.csv", encoder.encode('a,b\n"x,y",z\n'));
    const custom = await shell.exec("csvformat -l -D ';' -U 1 -M END /input.csv > /custom.csv");
    assert.equal(custom.exitCode, 0, custom.stderr);
    assert.deepEqual(await fs.readFile("/custom.csv"), encoder.encode('"line_number";"a";"b"END"1";"x,y";"z"END'));
    const failed = await shell.exec("csvformat -l -U 3 /input.csv");
    assert.equal(failed.exitCode, 1);
    assert.deepEqual(failed.stdoutBytes, encoder.encode("line_number,a,b\n"));
    const next = await shell.exec("csvcut -l /input.csv");
    assert.equal(next.exitCode, 0, next.stderr);
    assert.deepEqual(next.stdoutBytes, encoder.encode('line_number,a,b\n1,"x,y",z\n'));
    assert.deepEqual(await fs.readFile("/input.csv"), encoder.encode('a,b\n"x,y",z\n'));
  } finally { await shell.dispose(); }
});
