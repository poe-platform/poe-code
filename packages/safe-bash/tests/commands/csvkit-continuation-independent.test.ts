import test from "node:test";
import assert from "node:assert/strict";
import { Volume } from "memfs";
import { utf8Codec } from "poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected formatting"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

const cases = [
  {
    name: "cut repeats selectors before removing only selected empty cells",
    command: "csvcut -c '3,1,3' -C 1 -x",
    stdin: "a,b,c\nkeep,x,\n,x,keep\n,,\n",
    stdout: "c,c\nkeep,keep\n"
  },
  {
    name: "zero-based generated headers survive projection and AND filtering",
    command: "csvcut -H --zero -c '2,0' | csvgrep --zero -c '0,1' -m keep",
    stdin: "keep,x,keep\nkeep,x,drop\ndrop,x,keep\n",
    stdout: "c,a\nkeep,keep\n"
  },
  {
    name: "OR inversion complements rows rather than each column",
    command: "csvgrep -c 1,2 -m hit -a -i | csvcut -c 3",
    stdin: "a,b,id\nhit,miss,one\nmiss,hit,two\nmiss,miss,three\nhit,hit,four\n",
    stdout: "id\nthree\n"
  },
  {
    name: "literal filter handles newline-bearing cells and numeric lexical identities",
    command: "csvgrep -c 2 -m 'two' | csvcut -c 1",
    stdin: "id,text\n0001,\"one\ntwo\"\n1,two\n002,one\n",
    stdout: "id\n0001\n1\n"
  },
  {
    name: "physical line numbers remain attached through filtering and projection",
    command: "csvgrep -l -c key -m keep | csvcut -c 1,3",
    stdin: "key,text\nkeep,\"first\nsecond\"\ndrop,x\nkeep,last\n",
    stdout: "line_numbers,text\n2,\"first\nsecond\"\n4,last\n"
  },
  {
    name: "Unicode expanded case keys preserve original reverse ties",
    command: "csvsort -I -y 0 -c 1 -i -r",
    stdin: "key,id\nß,first\nSS,second\nss,third\nT,last\n",
    stdout: "key,id\nT,last\nß,first\nSS,second\nss,third\n"
  },
  {
    name: "codepoint order differs from UTF-16 order",
    command: "csvsort -I -y 0 -c 1",
    stdin: "key\n𐀀\n\n",
    stdout: "key\n\n𐀀\n"
  },
  {
    name: "numeric sort consumes raw projection and keeps exact large integers",
    command: "csvcut -c 2,1 | csvsort -y 0 -c 1",
    stdin: "id,value\nlarge,9007199254740993\nsmall,9007199254740992\nnegative,-0.00001\n",
    stdout: "value,id\n-0.00001,negative\n9007199254740992,small\n9007199254740993,large\n"
  },
  {
    name: "reverse numeric sorting places null first and keeps null ties stable",
    command: "csvsort -y 0 -c 1 -r",
    stdin: "key,id\n2,first\nnull,missing-one\n2,second\n,missing-two\n1,last\n",
    stdout: "key,id\n,missing-one\n,missing-two\n2,first\n2,second\n1,last\n"
  },
  {
    name: "lexical blank retention changes ordering before filtering",
    command: "csvsort -I -y 0 --blanks -c 1 | csvgrep -c 2 -m row",
    stdin: "key,id\nnull,row-three\n,row-one\n2,row-two\n",
    stdout: "key,id\n,row-one\n2,row-two\nnull,row-three\n"
  },
  {
    name: "group collision creates two equal grouping cells before projection",
    command: "csvstack -g cohort -n group | csvcut -c 1,2,3",
    stdin: "group,value\nold,001\n",
    stdout: "group,group,value\ncohort,cohort,001\n"
  },
  {
    name: "stack ignores blank records but preserves one empty cell records",
    command: "csvstack",
    stdin: "a,b\n\n\"\"\n,\nvalue\n",
    stdout: "a,b\n,\n,\nvalue,\n"
  }
] as const;

for (const item of cases) test(`csvkit independent composition: ${item.name}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec(item.command, { stdin: item.stdin });
    assert.deepEqual({ stdout: result.stdoutBytes, stderr: result.stderrBytes, status: result.exitCode }, {
      stdout: new TextEncoder().encode(item.stdout), stderr: new Uint8Array(), status: 0
    });
  } finally { await shell.dispose(); }
});

for (const [quoting, stdout] of [[2, "a,b\n1.0,\n"], [4, "a,b\n1.0,\n"], [5, "a,b\n1,\n"]] as const)
  test(`csvkit independent csvcut preserves numeric/null cells for quoting ${quoting}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
    try {
      const result = await shell.exec(`csvcut -u ${quoting}`, { stdin: '"a","b"\n1,\n' });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout, stderr: "", status: 0 });
      assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(stdout));
      assert.deepEqual(result.stderrBytes, new Uint8Array());
    } finally { await shell.dispose(); }
  });

// These assertions verify honest refusals. They do not qualify csvkit parity.
for (const [command, stdout] of [["csvgrep -c 1 -m 1", "a,b\n"], ["csvsort -y 0", ""], ["csvstack", "a,b\n"]] as const)
  for (const quoting of [2, 4, 5]) test(`csvkit independent explicit BLOCKER: ${command} quoting ${quoting}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
    try {
      const result = await shell.exec(`${command} -u ${quoting}`, { stdin: '"a","b"\n1,\n' });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout, stderr: `csvkit: unsupported or unqualified: input quoting mode ${quoting} numeric/null operation cells\n`, status: 78
      });
    } finally { await shell.dispose(); }
  });

for (const [quoting, stdout] of [[2, "a,b\n1.0,\n"], [4, "a,b\n1.0,\n"], [5, "a,b\n1,\n"]] as const)
  test(`csvkit independent numeric/null projection: csvcut quoting ${quoting}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
    try {
      const result = await shell.exec(`csvcut -u ${quoting}`, { stdin: '"a","b"\n1,\n' });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout, stderr: "", status: 0
      });
    } finally { await shell.dispose(); }
  });

test("csvkit independent stack preserves source files and completed rows on surplus-field failure", async () => {
  const volume = Volume.fromJSON({ "/one.csv": "a,b\nleft,right\n", "/two.csv": "b,c\nnext,last\ntoo,many,cells\n" });
  const fs = new MemoryFileSystem();
  // Stat remains a genuine VFS operation; named content lives exclusively in memfs.
  for (const path of ["/one.csv", "/two.csv"]) await fs.writeFile(path, new Uint8Array(volume.readFileSync(path) as Buffer));
  fs.readFile = async path => new Uint8Array(volume.readFileSync(path) as Buffer);
  fs.readStream = path => (async function* () { yield new Uint8Array(volume.readFileSync(path) as Buffer); })();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvstack -l --filenames one.csv two.csv");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "line_number,group,a,b,c\n1,one.csv,left,right,\n2,two.csv,,next,last\n",
      stderr: "ValueError: dict contains fields not in fieldnames: None\n", status: 1
    });
    assert.deepEqual(volume.toJSON(), { "/one.csv": "a,b\nleft,right\n", "/two.csv": "b,c\nnext,last\ntoo,many,cells\n" });
  } finally { await shell.dispose(); }
});
