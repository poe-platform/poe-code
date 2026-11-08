import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "safe-bash-command-csvkit";
import reference from "../../../../docs/csvkit/csvsort-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected locale formatting"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
  columnWarnings: { utilsPath: reference.warningUtilsPath }
};

async function check(command: string, stdin: string, stdout: string, stderr = "", status = 0): Promise<void> {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec(command, { stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout, stderr, status });
  } finally { await shell.dispose(); }
}

test("csvsort user edge: every frozen differential is preserved through actual shell literal argv", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [index, item] of reference.cases.entries()) {
      const command = ["csvsort", ...item.argv.map(value => "'" + value.replaceAll("'", "'\\''") + "'")].join(" ");
      const result = await shell.exec(command, { stdin: item.stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: item.stdout, stderr: item.stderr, status: item.status
      }, `frozen differential ${index}`);
    }
  } finally { await shell.dispose(); }
});

test("csvsort user edge: Python codepoint order distinguishes astral characters from UTF16 order", async () => {
  await check("csvsort -y0 -I -c key", "key,id\n𐀀,astral\n,private\n😀,emoji\nZ,ascii\n",
    "key,id\nZ,ascii\n,private\n𐀀,astral\n😀,emoji\n");
});

test("csvsort user edge: quoted multiline fields and escaped quotes survive sorting", async () => {
  await check("csvsort -y0 -c n", 'n,body\n10,"a\nb"\n2,"say ""hi"", now"\n',
    'n,body\n2,"say ""hi"", now"\n10,"a\nb"\n');
});

test("csvsort user edge: ignore case changes keys and preserves original output and reverse ties", async () => {
  await check("csvsort -y0 -I -i -r -c k", "k,id\nß,one\nSS,two\nss,three\na,last\n",
    "k,id\nß,one\nSS,two\nss,three\na,last\n");
});

test("csvsort user edge: later NaN keys are not compared after unequal first keys", async () => {
  await check("csvsort -y0 -c key,value", "key,value\nb,NaN\na,2\n", "key,value\na,2\nb,NaN\n");
  await check("csvsort -y0 -c key,value", "key,value\na,NaN\na,2\n", "",
    "InvalidOperation: [<class 'decimal.InvalidOperation'>]\n", 1);
  await check("csvsort -y0 -c value", "value,id\n,empty\nNaN,nan\n", "value,id\nNaN,nan\n,empty\n");
  await check("csvsort -y0 -r -c value", "value,id\n,empty\nNaN,nan\n", "value,id\n,empty\nNaN,nan\n");
});

test("csvsort user edge: selected null tuples fall through to later selected keys", async () => {
  await check("csvsort -y0 -c a,b", "a,b,id\n,10,first\n,2,second\n3,8,third\n,2,fourth\n",
    "a,b,id\n3,8,third\n,2,second\n,2,fourth\n,10,first\n");
});

test("csvsort user edge: leading zero protection changes inference without changing unrelated types", async () => {
  await check("csvsort -y0 --no-leading-zeroes -c zip", "zip,n\n02,10\n010,2\n1,3\n",
    "zip,n\n010,2\n02,10\n1,3\n");
});

test("csvsort user edge: names preserve raw headers even with warning provenance available", async () => {
  await check("csvsort -n -y0 -c nonexistent", "a,a,\n1,2,3,4\n", "  1: a\n  2: a\n  3: \n");
});

test("csvsort user edge: no data rows still outputs the parsed header", async () => {
  await check("csvsort -y0", "a,b\n", "a,b\n");
});

test("csvsort user edge: blanks and custom nulls alter ordering and normalize output", async () => {
  const input = "k,id\nNULL,first\n,empty\nz,last\nMISSING,custom\n";
  await check("csvsort -y0 -I --blanks --null-value MISSING -c k", input,
    "k,id\n,empty\nNULL,first\nz,last\n,custom\n");
  await check("csvsort -y0 -I --null-value MISSING -r -c k", input,
    "k,id\n,first\n,empty\n,custom\nz,last\n");
});

test("csvsort user edge: timezone aware equal instants keep input order and normalized offsets", async () => {
  await check("csvsort -y0 -c timestamp", "timestamp,id\n2024-01-01T01:00:00+01:00,first\n2024-01-01T00:00:00+00:00,second\n2023-12-31T23:00:00+00:00,earlier\n",
    "timestamp,id\n2023-12-31T23:00:00+00:00,earlier\n2024-01-01T01:00:00+01:00,first\n2024-01-01T00:00:00+00:00,second\n");
});

test("csvsort user edge: skip lines handles CRLF metadata and output uses LF", async () => {
  await check("csvsort -y0 -K2 -c n", "metadata\r\nmore metadata\r\nn,id\r\n10,a\r\n2,b\r\n", "n,id\n2,b\n10,a\n");
});

test("csvsort user edge: unsupported input quoting and unqualified verbose errors remain explicit blockers", async () => {
  await check("csvsort -y0 -u2", '"n"\n2\n', "",
    "csvkit: unsupported or unqualified: input quoting mode 2 numeric/null operation cells\n", 78);
  await check("csvsort -y0 -u2", "n\n2\n", "",
    "ValueError: could not convert string to float: 'n'\n", 1);
  await check("csvsort -y0 -v -c absent", "n\n2\n", "",
    "csvkit: unsupported or unqualified: frozen Python traceback frames and deployment identity\n", 78);
  await check("csvsort -y0 -v", "n\n10\n2\n", "n\n2\n10\n");
});
