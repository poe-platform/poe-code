import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "poe-code/csvkit";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected formatting"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const bytes = (value: string) => new TextEncoder().encode(value);
const exact = (result: { stdoutBytes: Uint8Array; stderr: string; exitCode: number }, stdout: string, stderr = "", exitCode = 0) => {
  assert.deepEqual(result.stdoutBytes, bytes(stdout));
  assert.equal(result.stderr, stderr);
  assert.equal(result.exitCode, exitCode);
};

test("csvformat stress ASV overrides output tabs, delimiter and arbitrary terminator without changing input", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    exact(await shell.exec("csvformat -d ';' -D 'xx' -T -M END -A", { stdin: "a;b\nx;y\n" }), "a\x1fb\x1ex\x1fy\x1e");
    exact(await shell.exec("csvformat -d ';' -D 'xx' -T -M END", { stdin: "a;b\nx;y\n" }), "a\tbENDx\tyEND");
    exact(await shell.exec("csvformat -D ';'", { stdin: 'a,b\n"x,y",z\n' }), "a;b\nx,y;z\n");
  } finally { await shell.dispose(); }
});

test("csvformat stress output header skipping follows generated header insertion and physical line skipping", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    exact(await shell.exec("csvformat -K 1 -H -E -l", { stdin: "# discarded\nx,y\nz,w\n" }), "line_number,x,y\n1,z,w\n");
    exact(await shell.exec("csvformat -K 1 -H -E", { stdin: "# discarded\nx,y\nz,w\n" }), "x,y\nz,w\n");
    exact(await shell.exec("csvformat -E", { stdin: "a,b\n" }), "");
    exact(await shell.exec("csvformat -E", { stdin: "" }), "", "StopIteration: \n", 1);
  } finally { await shell.dispose(); }
});

test("csvformat stress missing output escapes preserve completed records and virtual file bytes", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const input = 'a,b\n"x,y",z\n';
  await fs.writeFile("/in.csv", bytes(input));
  try {
    exact(await shell.exec("csvformat -U 3 /in.csv > /out.csv"), "", "Error: need to escape, but no escapechar set\n", 1);
    assert.deepEqual(await fs.readFile("/out.csv"), bytes("a,b\n"));
    assert.deepEqual(await fs.readFile("/in.csv"), bytes(input));
    exact(await shell.exec("csvformat -U 3 -P '\\' /in.csv"), "a,b\nx\\,y,z\n");
  } finally { await shell.dispose(); }
});

test("csvformat stress custom quote and no-doublequote affect only output", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    exact(await shell.exec("csvformat -Q \"'\" -U 1 -B -P '\\'", { stdin: 'a,b\n"x,y",it\'s\n' }), "'a','b'\n'x,y','it\\'s'\n");
    exact(await shell.exec("csvformat -B", { stdin: 'a,b\nx,"z""q"\n' }), "a,b\n", "Error: need to escape, but no escapechar set\n", 1);
    exact(await shell.exec("csvformat", { stdin: 'a,b\nx,"z""q"\n' }), 'a,b\nx,"z""q"\n');
  } finally { await shell.dispose(); }
});

test("csvformat stress nonnumeric output materializes number and text independently of quoted input", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    exact(await shell.exec("csvformat -U 2 -E", { stdin: 'number,text,empty\n"1.2300",true,\n2.00,false,NULL\n' }), '1.2300,"true",""\n2.00,"false",""\n');
    exact(await shell.exec("csvformat -U 2 -L de_DE", { stdin: 'number,text\n"1,7",yes\n"2,8",no\n' }), '"number","text"\n1.7,"yes"\n2.8,"no"\n');
    exact(await shell.exec("csvformat -U 2 -E", { stdin: "number,text\n" }), "");
    exact(await shell.exec("csvformat -U 2 -H -E", { stdin: "1.25,true\n2.50,false\n" }), '1.25,"true"\n2.50,"false"\n');
    exact(await shell.exec("csvformat -U 2", { stdin: "" }), "\n");
    exact(await shell.exec("csvformat -U 2 -H", { stdin: "" }), "\n");
    exact(await shell.exec("csvformat -U 2 -E", { stdin: "" }), "");
  } finally { await shell.dispose(); }
});

test("csvformat stress raw rows retain ragged widths, blanks and literal strings", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    exact(await shell.exec("csvformat -D ';'", { stdin: "a,b\n\nx,y,z\nNULL,001\n" }), "a;b\n\nx;y;z\nNULL;001\n");
    exact(await shell.exec("csvformat -D '' -M ''", { stdin: "a,b\nx,y\n" }), "a,b\nx,y\n");
    exact(await shell.exec("csvformat -M END", { stdin: "a,b\nD,E\n" }), 'a,bEND"D","E"END');
  } finally { await shell.dispose(); }
});

test("csvformat stress unsupported numeric/null input cells retain completed headers", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [quoting, stdin] of [[2, '"a","b"\n1,2\n'], [4, '"a","b"\n1,2\n'], [5, '"a","b"\nx,\n']] as const) {
      exact(await shell.exec(`csvformat -u ${quoting}`, { stdin }), "a,b\n",
        `csvkit: unsupported or unqualified: input quoting mode ${quoting} numeric/null operation cells\n`, 78);
    }
    exact(await shell.exec("csvformat -u5", { stdin: '"a","b"\n1,2\n' }), "a,b\n1,2\n");
  } finally { await shell.dispose(); }
});

test("csvformat stress invalid output delimiter rejects before consuming borrowed input", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let reads = 0;
  try {
    exact(await shell.exec("csvformat -D xx", { stdin: {
      [Symbol.asyncIterator]() {
        return { async next() { reads++; throw new Error("invalid writer must not read stdin"); } };
      }
    } }), "", 'TypeError: "delimiter" must be a unicode character, not a string of length 2\n', 1);
    assert.equal(reads, 0);
  } finally { await shell.dispose(); }
});
