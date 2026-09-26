import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import reference from "../../../../docs/csvkit/additional-operation-reference.json" with { type: "json" };
import workbookReference from "../../../../docs/csvkit/in2csv-reference.json" with { type: "json" };
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unmeasured locale formatting"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const stdinFormatError = reference.cases.find(item => item.command === "in2csv" && item.argv.length === 0)!.stderr;
const usage = stdinFormatError.slice(0, stdinFormatError.lastIndexOf("in2csv: error:"));

// Source: released csvkit 2.2.0 utilities/in2csv.py and convert.guess_format.
test("in2csv stress unknown extensions fail before consuming input or opening files", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    for (const path of ["/missing.geojson", "/missing.ndjson", "/missing.csv.gz", "/missing.ods", "/missing.xlsb"]) {
      const result = await shell.exec(`in2csv ${path}`, { stdin: { async *[Symbol.asyncIterator]() {
        assert.fail("format rejection must precede stdin acquisition");
        yield new Uint8Array();
      } } });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "", stderr: usage + "in2csv: error: Unable to automatically determine the format of the input file. Try specifying a format with --format.\n", status: 2 });
    }
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});

test("in2csv stress names means Excel sheet names and rejects non-Excel before input", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const expected = reference.cases.find(item => item.command === "in2csv" && item.argv.includes("-n"))!;
  try {
    const result = await shell.exec("in2csv -f csv -n", { stdin: { async *[Symbol.asyncIterator]() {
      assert.fail("names applicability must precede stdin acquisition");
      yield new Uint8Array();
    } } });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: expected.stdout, stderr: expected.stderr, status: expected.status });
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});

test("in2csv stress explicit format wins over schema and key while schema wins over key", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/schema.csv", new TextEncoder().encode("column,start,length\nname,1,3\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    for (const [command, stdin, stdout] of [
      ["in2csv -f csv -I -y0 -s /schema.csv -k rows", "a,b\nx,y\n", "a,b\nx,y\n"],
      ["in2csv -I -s /schema.csv -k rows", "abc\ndef\n", "name\nabc\ndef\n"],
      ["in2csv -I -k rows", '{"rows":[{"name":"alpha"}]}', "name\nalpha\n"]
    ] as const) {
      const result = await shell.exec(command, { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout, stderr: "", status: 0 }, command);
    }
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["schema.csv"]);
  } finally { await shell.dispose(); }
});

test("in2csv stress CSV fast path ignores sheet-only options and retains ragged rows", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("in2csv -f csv -I -y0 --sheet absent --reset-dimensions --encoding-xls invalid --use-sheet-names", { stdin: "a,b\nx,y,z\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "a,b\nx,y,z\n", stderr: "", status: 0 });
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});

// Frozen CPython 3.14.2 measurement: operation-observations-20260917.json,
// write-sheets-csv. Main stdout precedes the failing stdin workbook reopen.
test("in2csv stress non-Excel write-sheets preserves stdout before closed stdin failure", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("in2csv -f csv --write-sheets Sheet1 -I -y0", { stdin: "a\nx\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "a\nx\n", stderr: "ValueError: read of closed file\n", status: 1 });
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});

test("in2csv stress extension inference preserves CSV named-file NUL filtering and JS alias", async () => {
  const fs = new MemoryFileSystem();
  const csv = new TextEncoder().encode("a,b\r\nx\u0000,y\r");
  await fs.writeFile("/data.CSV", csv);
  await fs.writeFile("/data.js", new TextEncoder().encode('[{"name":"alpha"}]'));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const first = await shell.exec("in2csv -I -y0 /data.CSV");
    assert.deepEqual({ stdout: first.stdout, stderr: first.stderr, status: first.exitCode }, { stdout: "a,b\nx,y\n", stderr: "", status: 0 });
    const second = await shell.exec("in2csv -I /data.js");
    assert.deepEqual({ stdout: second.stdout, stderr: second.stderr, status: second.exitCode }, { stdout: "name\nalpha\n", stderr: "", status: 0 });
    assert.deepEqual(await fs.readFile("/data.CSV"), csv);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["data.CSV", "data.js"]);
  } finally { await shell.dispose(); }
});

// Fresh pinned CPython 3.14.2 measurements; research subprocesses are not tests.
test("in2csv stress GeoJSON preserves Python list repr and malformed-object diagnostics", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    for (const [features, stdout, stderr, status] of [
      [[{ properties: { x: ["é", true, null, { b: 1 }, ["a"]] }, geometry: null }], "id,x,geojson,type,longitude,latitude\n,\"['é', True, None, OrderedDict({'b': 1}), ['a']]\",null,,,\n", "", 0],
      [[{ properties: null, geometry: null }], "", "AttributeError: 'NoneType' object has no attribute 'keys'\n", 1],
      [[{ properties: [], geometry: null }], "", "AttributeError: 'list' object has no attribute 'keys'\n", 1],
      [null, "", "TypeError: 'NoneType' object is not iterable\n", 1],
      [{}, "id,geojson,type,longitude,latitude\n", "", 0],
      [{ foo: 1 }, "", "AttributeError: 'str' object has no attribute 'get'\n", 1],
      [[null], "", "AttributeError: 'NoneType' object has no attribute 'get'\n", 1],
      [[{ geometry: 3 }], "", "AttributeError: 'int' object has no attribute 'get'\n", 1],
      [[{ geometry: [] }], "id,geojson,type,longitude,latitude\n,[],,,\n", "", 0],
      [[{ geometry: { type: "Point", coordinates: null } }], "", "TypeError: 'NoneType' object is not subscriptable\n", 1],
      [[{ geometry: { type: "Point", coordinates: {} } }], "", "KeyError: slice(0, 2, None)\n", 1],
      [[{ geometry: { type: "Point", coordinates: 3 } }], "", "TypeError: 'int' object is not subscriptable\n", 1],
      [[{ geometry: { type: "Point", coordinates: "ab" } }], 'id,geojson,type,longitude,latitude\n,"{""type"": ""Point"", ""coordinates"": ""ab""}",Point,a,b\n', "", 0]
    ] as const) {
      const result = await shell.exec("in2csv -f geojson", { stdin: JSON.stringify({ type: "FeatureCollection", features }) });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout, stderr, status }, JSON.stringify(features));
    }
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});

test("in2csv stress GeoJSON normalizes JSON negative integer zero", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("in2csv -f geojson", { stdin: '{"type":"FeatureCollection","features":[{"id":-0,"properties":{"x":[-0]},"geometry":null}]}' });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "id,x,geojson,type,longitude,latitude\n0,[0],null,,,\n", stderr: "", status: 0 });
  } finally { await shell.dispose(); }
});

test("in2csv stress actual shell streams workbook CSV side files through VFS descriptors", async () => {
  const fs = new MemoryFileSystem();
  const workbook = Uint8Array.from(Buffer.from(workbookReference.binary["book.xlsx"], "base64"));
  await fs.writeFile("/book.xlsx", workbook);
  await fs.writeFile("/book_0.csv", new TextEncoder().encode("previous contents that must be truncated"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("in2csv --write-sheets Other,First /book.xlsx");
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: "n,text\n3,second\n", stderr: "", status: 0 });
    assert.deepEqual(await fs.readFile("/book_0.csv"), new TextEncoder().encode("n,text\n3,second\n"));
    assert.deepEqual(await fs.readFile("/book_1.csv"), new TextEncoder().encode("n,text\n2.5,é\n"));
    assert.deepEqual(await fs.readFile("/book.xlsx"), workbook);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["book.xlsx", "book_0.csv", "book_1.csv"]);
  } finally { await shell.dispose(); }
});
