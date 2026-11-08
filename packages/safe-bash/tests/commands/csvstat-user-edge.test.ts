import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import reference from "../../../../docs/csvkit/csvstat-reference.json" with { type: "json" };
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const freshFormats: Record<string, string> = { '["%.3f","1",true]': "1.000" };
const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber(value, locale, format, grouping) {
    assert.equal(locale, "C");
    const key = JSON.stringify([format, value, grouping]);
    const measured = freshFormats[key] ?? (reference.formats as Record<string, string>)[key];
    assert.notEqual(measured, undefined, `Unmeasured formatter input: ${format} ${value} ${grouping}`);
    return measured!;
  } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

// Fresh measurements from the requalified, hash-locked CPython 3.14.2 oracle.
const argumentCases = [
  { argv: ["-y0", "--type", "-c", "2,1,2"], stdin: "a,b\nx,y\n", stdout: "  2. b: Boolean\n  1. a: Text\n  2. b: Boolean\n", stderr: "", status: 0 },
  { argv: ["-y0", "--type", "-c", ","], stdin: "a,b\nx,y\n", stdout: "", stderr: "ColumnIdentifierError: Column '' is invalid. It is neither an integer nor a column name. Column names are: 'a', 'b'\n", status: 1 },
  { argv: ["-y0", "--count", "-K2"], stdin: "comment\ncomment\na\nx\n", stdout: "1\n", stderr: "", status: 0 },
  { argv: ["-y0", "--count", "--add-bom"], stdin: "a\nx\n", stdout: "\uFEFF1\n", stderr: "", status: 0 },
  { argv: ["-y0", "--names", "--add-bom", "--linenumbers"], stdin: "a,b\nx,y\n", stdout: "\uFEFF  1: a\n  2: b\n", stderr: "", status: 0 },
  { argv: ["-y0", "--csv", "--json", "--freq-count", "-1", "-I"], stdin: "a\nx\n", stdout: "column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,a,Text,False,1,1,,,,,,,1,,\n", stderr: "", status: 0 },
  { argv: ["-y0", "--csv", "--linenumbers", "--add-bom", "-I"], stdin: "a\nx\n", stdout: "\uFEFFcolumn_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq\n1,a,Text,False,1,1,,,,,,,1,,x\n", stderr: "", status: 0 },
  { argv: ["-y0", "--freq", "-I"], stdin: 'a\n"a""b"\n"c\\d"\n"two\nlines"\n', stdout: '{ "a"b": 1, "c\\d": 1, "two\nlines": 1 }\n', stderr: "", status: 0 },
  { argv: ["-y0", "--count", "--mean", "--names"], stdin: "a,b\nx,y\n", stdout: "  1: a\n  2: b\n", stderr: "", status: 0 },
  { argv: ["-y0", "--names", "-H", "--zero"], stdin: "", stdout: "", stderr: "RequiredHeaderError: You cannot use --no-header-row with the -n or --names options.\n", status: 1 },
  { argv: ["-y0", "--count", "-K5"], stdin: "a\nx\n", stdout: "-1\n", stderr: "", status: 0 },
  { argv: ["-y0", "--type", "--null-value", "NULL", "--", "-"], stdin: "a\nNULL\nnull\n", stdout: "Boolean\n", stderr: "", status: 0 }
];

// Exercise original frozen observations through the actual shell parser and
// registered command, independently of the domain engine's unit invocation.
for (const [index, item] of [...reference.cases, ...argumentCases].entries()) {
  test(`csvstat user frozen shell differential ${index}: ${item.argv.join(" ")}`, async () => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    try {
      const command = ["csvstat", ...item.argv].map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(" ");
      const result = await shell.exec(command, { stdin: item.stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: item.stdout, stderr: item.stderr, status: item.status });
      assert.deepEqual(await fs.readdir("/"), [], "stdin statistics must not create VFS files");
    } finally { await shell.dispose(); }
  });
}

test("csvstat user reordered zero-based selection preserves one-based output IDs and source bytes", async () => {
  const fs = new MemoryFileSystem();
  const input = new TextEncoder().encode("left,right\r\nalpha,beta\r\ngamma,delta\r\n");
  await fs.writeFile("/input.csv", input);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvstat -y0 --zero -c 1,0 --type /input.csv > /types.txt");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "", stderr: "", status: 0 });
    assert.deepEqual(await fs.readFile("/types.txt"), new TextEncoder().encode("  2. right: Text\n  1. left: Text\n"));
    assert.deepEqual(await fs.readFile("/input.csv"), input);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["input.csv", "types.txt"]);
  } finally { await shell.dispose(); }
});

test("csvstat user serializer pipelines retain Unicode names and omit unavailable metrics", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvstat -y0 --csv --json -c café | csvcut -c column_name,type,min,len,freq", {
      stdin: "café,other\néclair,x\néclair,y\n"
    });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "column_name,type,min,len,freq\ncafé,Text,,6,éclair\n", stderr: "", status: 0
    });
  } finally { await shell.dispose(); }
});
