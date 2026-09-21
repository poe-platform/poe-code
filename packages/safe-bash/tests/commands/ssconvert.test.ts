import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { gunzipSync } from "node:zlib";
import { createZipCodec } from "@poe-code/office-package";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { createMountFileSystem } from "../../src/fs/mount/index.js";
import { FsError, isErrnoCode } from "../../src/contracts/index.js";
import { createSsconvertCommand, ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { createEngine, createResourceIO, perlSampleFunctions, pythonSampleFunctions, exportRangeForSheet, renderCellText, type Workbook, type Codec, type ExternalFormulaRequest, type TextFormatMode } from "poe-code/ssconvert";

test("ssconvert filter preserves ASCII header matching and empty STRING criteria through XML replay", async () => {
  for (const [header, field, condition, tail] of [
    ["Ärea", "ärea", "&gt;3", '"The given criteria are invalid.",\n'],
    ["Score", "score", "&gt;3", "Score,\n4,\n"],
    ["Ärea", "Ärea", "&gt;3", "Ärea,\n4,\n"],
    ["Score", "Score", "", '"No matching records were found.",\n'],
  ]) {
    const source = `<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">Input</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>Input</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="60">${header}</gnm:Cell><gnm:Cell Row="1" Col="0" ValueType="40">4</gnm:Cell><gnm:Cell Row="0" Col="2" ValueType="60">${field}</gnm:Cell><gnm:Cell Row="1" Col="2" ValueType="60">${condition}</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>`;
    const volume = Volume.fromJSON({ "/input.xml": source, "/keep": "keep" });
    const binding = { ...options, codecs: [], limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100000 } };
    const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
    const sdk = createEngine(binding);
    const toolTest = ["advanced-filter", "x:A1:A2", "y:C1:C2"];
    const flags = toolTest.map(value => `--tool-test=${value}`).join(" ");
    const chunks: Uint8Array[] = [];
    try {
      const command = await shell.exec(`ssconvert ${flags} -T Gnumeric_stf:stf_csv /input.xml fd://1`);
      assert.equal(command.exitCode, 0); assert.equal(command.stderr, "");
      assert.equal(command.stdout, '"Advanced Filter:",\n"Source Range:",Input!A1:A2\n"Criteria Range:",Input!C1:C2\n' + tail);
      const direct = await sdk.convert({ input: { kind: "stream", filename: "input.xml", source: [new TextEncoder().encode(source)] },
        destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } }, exportType: "Gnumeric_stf:stf_csv", toolTest }, { signal: new AbortController().signal });
      assert.equal(direct.exitCode, 0); assert.deepEqual(direct.diagnostics, []);
      assert.deepEqual(command.stdoutBytes, new Uint8Array(Buffer.concat(chunks)));
      assert.equal((await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /input.xml /checkpoint.xml")).exitCode, 0);
      const replay = await shell.exec(`ssconvert ${flags} -T Gnumeric_stf:stf_csv /checkpoint.xml fd://1`);
      assert.equal(replay.exitCode, 0); assert.equal(replay.stderr, ""); assert.deepEqual(replay.stdoutBytes, command.stdoutBytes);
      assert.equal(volume.readFileSync("/input.xml", "utf8"), source); assert.equal(volume.readFileSync("/keep", "utf8"), "keep");
      assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/checkpoint.xml", "/input.xml", "/keep"]);
    } finally { await sdk.dispose(); await shell.dispose(); }
  }
});

test("ssconvert statistical tools share command/SDK bytes and checkpoint replay namespaces", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Input", cells: [[1,2],[2,5],[3,5],[4,9]].flatMap((values, row) => values.map((value, column) => ({ row, column, value: { kind: "number" as const, value } }))) }] };
  const codec: Codec = { id: "moments-fixture", description: "Original statistical command fixture", extensions: ["fixture"], probeContent: () => true,
    async read(bytes) { return new TextDecoder().decode(bytes) === "original" ? book : JSON.parse(new TextDecoder().decode(bytes)) as Workbook; },
    async write(value) { return new TextEncoder().encode(JSON.stringify(value)); } };
  for (const tool of ["regression", "anova", "anova2", "descriptive-statistics", "correlation", "covariance", "principal-components", "moving-average", "exponential-smoothing", "histogram", "frequency-tables", "fourier-analysis", "sampling", "ranking", "normality-test", "auto-expression", "chi-squared-test", "sign-test", "sign-test-two-samples", "one-mean-test", "wilcoxon-signed-rank-test", "wilcoxon-signed-rank-test-two-samples", "wilcoxon-mann-whitney", "f-test", "t-test-paired", "t-test-equal-variances", "t-test-unequal-variances", "kaplan-meier", "z-test", "advanced-filter", "fill-series"]) {
    const volume = Volume.fromJSON({ "/input.fixture": "original", "/keep": "keep" });
    const binding = { ...options, codecs: [codec], random: { next: () => 0.25 }, limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 10000, sheets: 10, operations: 1000000 } };
    const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
    const sdk = createEngine(binding);
    const pairTools = ["regression", "sign-test-two-samples", "wilcoxon-signed-rank-test-two-samples", "wilcoxon-mann-whitney", "f-test", "t-test-paired", "t-test-equal-variances", "t-test-unequal-variances", "kaplan-meier", "z-test", "advanced-filter"];
    const properties = pairTools.includes(tool) ? ["x:$A$1:$A$4", "y:$B$1:$B$4"] : tool === "fill-series" ? ["start-value:2", "step-value:3", "stop-value:11"] : ["data:$A$1:$B$4"];
    if (tool === "auto-expression") properties.push("function:SUM");
    if (tool === "sampling") properties.push("size:3", "number:2");
    if (tool === "histogram" || tool === "frequency-tables") properties.push("n:3");
    const args = [tool, ...properties].map(value => `--tool-test='${value}'`).join(" ");
    const chunks: Uint8Array[] = [];
    try {
      const command = await shell.exec(`ssconvert ${args} /input.fixture /command.fixture`);
      const direct = await sdk.convert({ input: { kind: "stream", filename: "input.fixture", source: [new TextEncoder().encode("original")] },
        destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
        exportType: "moments-fixture", toolTest: [tool, ...properties] }, { signal: new AbortController().signal });
      assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ""); assert.equal(command.stdout, "");
      assert.equal(direct.exitCode, command.exitCode); assert.deepEqual(direct.diagnostics, []);
      assert.deepEqual(new Uint8Array(volume.readFileSync("/command.fixture") as Uint8Array), chunks[0]);
      assert.equal((await shell.exec("ssconvert /input.fixture /checkpoint.fixture")).exitCode, 0);
      const replay = await shell.exec(`ssconvert ${args} /checkpoint.fixture /replay.fixture`);
      assert.equal(replay.exitCode, 0, replay.stderr);
      assert.deepEqual(volume.readFileSync("/replay.fixture"), volume.readFileSync("/command.fixture"));
      assert.equal(volume.readFileSync("/input.fixture", "utf8"), "original"); assert.equal(volume.readFileSync("/keep", "utf8"), "keep");
      assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/checkpoint.fixture", "/command.fixture", "/input.fixture", "/keep", "/replay.fixture"]);
    } finally { await sdk.dispose(); await shell.dispose(); }
  }
});

test("ssconvert clipboard keeps partial merges through original, checkpoint and replay VFS execution", async () => {
  const source = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">Original</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>Original</gnm:Name><gnm:Cells><gnm:Cell Row="1" Col="1" ValueType="40">7</gnm:Cell></gnm:Cells><gnm:MergedRegions><gnm:Merge>B2:D4</gnm:Merge></gnm:MergedRegions></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const volume = Volume.fromJSON({ "/original.xml": source, "/keep": "keep" });
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands({ ...options, codecs: [],
    limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } }));
  try {
    const original = await shell.exec("ssconvert --clipboard=application/x-gnumeric --export-range=C3:D4 /original.xml /selection.xml");
    assert.equal(original.exitCode, 0, original.stderr);
    const bytes = volume.readFileSync("/selection.xml");
    assert.ok(String(bytes).includes("<gnm:Merge>[C-1]0:B2</gnm:Merge>"));
    const checkpoint = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /original.xml /checkpoint.xml");
    assert.equal(checkpoint.exitCode, 0, checkpoint.stderr);
    const replay = await shell.exec("ssconvert --clipboard=application/x-gnumeric --export-range=C3:D4 /checkpoint.xml /replay.xml");
    assert.equal(replay.exitCode, 0, replay.stderr);
    assert.deepEqual(volume.readFileSync("/replay.xml"), bytes);
    const rejected = await shell.exec("ssconvert --clipboard=text/rtf --export-range=A1 /original.xml /keep");
    assert.equal(rejected.exitCode, 1); assert.equal(rejected.stderr, "Failed to get clipboard data.\n");
    assert.equal(volume.readFileSync("/keep", "utf8"), "keep");
    assert.equal(volume.readFileSync("/original.xml", "utf8"), source);
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/checkpoint.xml", "/keep", "/original.xml", "/replay.xml", "/selection.xml"]);
  } finally { await shell.dispose(); }
});

test("ssconvert hidden clipboard shares SDK serialization, failures and VFS namespace effects", async () => {
  const source = "1,2\n3,4\n";
  for (const target of ["UTF8_STRING", "application/x-gnumeric", "text/html", "Biff8", "text/plain"]) {
    const volume = Volume.fromJSON({ "/input.csv": source, "/keep": "keep" });
    const binding = { ...options, codecs: [], limits: { ...options.limits,
      inputBytes: 10000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 } };
    const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
    const engine = createEngine(binding);
    const chunks: Uint8Array[] = [];
    try {
      const command = await shell.exec(`ssconvert --clipboard='${target}' --export-range=B2 /input.csv /output`);
      if (target === "text/plain") {
        assert.equal(command.exitCode, 1); assert.equal(command.stderr, "Failed to get clipboard data.\n");
        assert.deepEqual(volume.toJSON(), { "/input.csv": source, "/keep": "keep" });
      } else {
        const sdk = await engine.convert({ input: { kind: "stream", filename: "input.csv", source: [new TextEncoder().encode(source)] },
          destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
          clipboard: target, exportRangeExpression: "B2" }, { signal: new AbortController().signal });
        assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stdout, "");
        assert.equal(sdk.exitCode, command.exitCode);
        assert.equal(command.stderr, sdk.diagnostics.map(d => d.message + "\n").join(""));
        assert.deepEqual(new Uint8Array(volume.readFileSync("/output") as Uint8Array), chunks[0]);
        assert.equal(volume.readFileSync("/keep", "utf8"), "keep");
        assert.equal(volume.readFileSync("/input.csv", "utf8"), source);
        assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/input.csv", "/keep", "/output"]);
      }
    } finally { engine.dispose(); }
  }
});

test("ssconvert hidden resize shares SDK status, diagnostics, data loss and replay in memfs", async () => {
  const original = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="256">Small</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet Visibility="GNM_SHEET_VISIBILITY_HIDDEN"><gnm:Name>Small</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0">=A200</gnm:Cell><gnm:Cell Row="199" Col="0" ValueType="40">7</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const named = original.replace("<gnm:Cells>", "<gnm:Names><gnm:Name><gnm:name>Relative</gnm:name><gnm:value>A200</gnm:value><gnm:position>A1</gnm:position></gnm:Name></gnm:Names><gnm:Cells>");
  const splitMerge = original.replace("<gnm:Cells>", "<gnm:MergedRegions><gnm:Merge>A127:B130</gnm:Merge></gnm:MergedRegions><gnm:Cells>");
  for (const [expression, source] of [["128x128tail", original], ["128x128tail", named], ["129x128", original], ["128X128", original], ["128x128", splitMerge]] as const) {
    const volume = Volume.fromJSON({ "/resize.gnumeric": source!, "/keep": "untouched" });
    const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
    const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
    try {
      const command = await shell.exec(`ssconvert --verbose --resize=${expression} -T Gnumeric_XmlIO:sax:0 /resize.gnumeric /round.xml`);
      const chunks: Uint8Array[] = [];
      const sdk = await engine.convert({ input: { kind: "stream", filename: "resize.gnumeric", source: [new TextEncoder().encode(source)] },
        resizeExpression: expression, verbose: true, exportType: "Gnumeric_XmlIO:sax:0",
        destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
      assert.equal(command.exitCode, 0, command.stderr); assert.equal(sdk.exitCode, command.exitCode);
      assert.equal(command.stderr, sdk.diagnostics.map(d => d.message + "\n").join(""));
      if (source === splitMerge) assert.ok(command.stderr.includes("Resizing of sheet Small failed\n"));
      assert.deepEqual(new Uint8Array(volume.readFileSync("/round.xml") as Uint8Array), chunks[0]);
      const xml = String(volume.readFileSync("/round.xml", "utf8"));
      if (expression === "128x128tail") {
        assert.ok(xml.includes('gnm:Cols="128" gnm:Rows="128"'));
        assert.ok(xml.includes("#REF!")); assert.ok(!xml.includes('Row="199"'));
        assert.ok(xml.includes('Visibility="GNM_SHEET_VISIBILITY_HIDDEN"'));
      } else { assert.ok(xml.includes('gnm:Cols="256" gnm:Rows="256"')); assert.ok(xml.includes('Row="199"')); }
      const replay = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /round.xml /replay.xml");
      assert.equal(replay.exitCode, 0, replay.stderr);
      if (source === named) {
        assert.ok(xml.includes("<gnm:value>A72</gnm:value>"));
        assert.ok(String(volume.readFileSync("/replay.xml", "utf8")).includes("<gnm:value>A72</gnm:value>"));
      }
      assert.equal(volume.readFileSync("/resize.gnumeric", "utf8"), source);
      assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
      assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/keep", "/replay.xml", "/resize.gnumeric", "/round.xml"]);
    } finally { await engine.dispose(); await shell.dispose(); }
  }
});

test("ssconvert DIF and SYLK share SDK bytes, diagnostics, file effects and checkpoint replay", async () => {
  for (const [name, source, importer, saver] of [
    ["book.dif", 'DATA\n0,0\n""\n-1,0\nBOT\n0,4\nV\n0,1\nTRUE\n-1,0\nEOD\n', "Gnumeric_dif:dif", "Gnumeric_dif:dif"],
    ["book.bin", 'ID;POriginal\nC;Y1;X1;K4\nC;X2;K5;ERC[-1]+1\nE\n', "Gnumeric_sylk:sylk", "Gnumeric_sylk:sylk"]
  ] as const) {
    const volume = Volume.fromJSON({ [`/${name}`]: source!, "/keep": "untouched" });
    const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
    const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
    try {
      const command = await shell.exec(`ssconvert -T ${saver} /${name} fd://1`);
      const chunks: Uint8Array[] = [];
      const sdk = await engine.convert({ input: { kind: "stream", filename: `/${name}`, source: [new TextEncoder().encode(source)] }, exportType: saver,
        destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
      assert.equal(command.exitCode, 0, command.stderr); assert.equal(sdk.exitCode, command.exitCode);
      assert.equal(command.stdout, chunks.map(b => new TextDecoder().decode(b)).join(""));
      assert.equal(command.stderr, sdk.diagnostics.map(d => d.message + "\n").join(""));
      const forced = await shell.exec(`ssconvert -I ${importer} -T ${saver} /${name} fd://1`);
      assert.equal(forced.stdout, command.stdout); assert.equal(forced.stderr, command.stderr);
      const saved = await shell.exec(`ssconvert -T Gnumeric_XmlIO:sax:0 /${name} /checkpoint.xml`);
      assert.equal(saved.exitCode, 0, saved.stderr);
      const original = await shell.exec(`ssconvert --recalc -T Gnumeric_stf:stf_csv /${name} fd://1`);
      const replay = await shell.exec("ssconvert --recalc -T Gnumeric_stf:stf_csv /checkpoint.xml fd://1");
      assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.stdout, original.stdout);
      assert.deepEqual(Object.keys(volume.toJSON()).sort(), [`/${name}`, "/checkpoint.xml", "/keep"].sort());
      assert.equal(volume.readFileSync(`/${name}`, "utf8"), source); assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
      volume.writeFileSync("/bad.dif", "DATA\n0,0\n");
      const denied = await shell.exec("ssconvert -I Gnumeric_dif:dif -T Gnumeric_stf:stf_csv /bad.dif /keep");
      assert.equal(denied.exitCode, 1); assert.match(denied.stderr, /Unexpected end of file at line 3 while reading header/);
      assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    } finally { await engine.dispose(); await shell.dispose(); }
  }
});

test("ssconvert HTML import shares SDK bytes, inert resources and replay namespace effects", async () => {
  const original = '<html><body><table><tr><td rowspan=2>4<td>6<tr><td>a<script>throw 1</script><img src="https://invalid/image">b</table></body></html>';
  const volume = Volume.fromJSON({ "/book.html": original, "/keep": "untouched" });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
  const reads: string[] = [], fs = filesystem(volume);
  const tracked = new Proxy(fs, { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false }; return key === "readFile" ? async (path: string, supplied?: Parameters<typeof fs.readFile>[1]) => { reads.push(path); return await fs.readFile(path, supplied); } : Reflect.get(target, key); } });
  const shell = new Shell({ fs: tracked }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  try {
    const command = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /book.html /round.xml");
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ""); assert.equal(command.stdout, "");
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", filename: "book.html", source: [new TextEncoder().encode(original)] }, exportType: "Gnumeric_XmlIO:sax:0",
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/round.xml") as Uint8Array), chunks[0]);
    const forced = await shell.exec("ssconvert -I Gnumeric_html:html -T Gnumeric_stf:stf_csv /book.html fd://1");
    assert.equal(forced.exitCode, 0, forced.stderr); assert.equal(forced.stderr, ""); assert.equal(forced.stdout, "4,6\n,ab\n");
    const replay = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /round.xml fd://1");
    assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.stderr, ""); assert.equal(replay.stdout, forced.stdout);
    assert.deepEqual(reads, ["/book.html", "/book.html", "/round.xml"]);
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.equal(volume.readFileSync("/book.html", "utf8"), original);
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/book.html", "/keep", "/round.xml"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert HTML parser warnings preserve native stderr bytes without an added blank line", async () => {
  const volume = Volume.fromJSON({ "/book.html": "<table><tr><td>&#0;</td></tr></table>" });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  try {
    const result = await shell.exec("ssconvert /book.html fd://1 -T Gnumeric_stf:stf_csv");
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, "\n");
    assert.equal(result.stderr, "/book.html:1: HTML parser error : htmlParseCharRef: invalid xmlChar value 0\n<table><tr><td>&#0;</td></tr></table>\n                   ^\n");
    assert.deepEqual(Object.keys(volume.toJSON()), ["/book.html"]);
  } finally { await shell.dispose(); }
});

test("ssconvert HTML4 title and textarea recovery uses the shared command and SDK engine", async () => {
  const original = '<html><head><title><b>X</b>&amp;</title></head><body><table><tr><td><textarea>a<script>throw 1</script><b>x</b>b</textarea><td>A&#;B</table></body></html>';
  const volume = Volume.fromJSON({ "/book.html": original, "/keep": "untouched" });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  try {
    const result = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /book.html fd://1");
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, ",X\n,&\naxb,AB\n");
    assert.equal(result.stderr, '/book.html:1: HTML parser error : htmlParseCharRef: invalid xmlChar value 0\ny><table><tr><td><textarea>a<script>throw 1</script><b>x</b>b</textarea><td>A&#;\n' + ' '.repeat(79) + '^\n');
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(original)], filename: "/book.html" }, exportType: "Gnumeric_stf:stf_csv",
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, result.exitCode);
    assert.equal(chunks.map(chunk => new TextDecoder().decode(chunk)).join(""), result.stdout);
    assert.equal(sdk.diagnostics.map(diagnostic => diagnostic.message).join(""), result.stderr);
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/book.html", "/keep"]);
    assert.equal(volume.readFileSync("/book.html", "utf8"), original);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert empty HTML import fails with native status and preserves the destination", async () => {
  const volume = Volume.fromJSON({ "/empty.html": "<table></table>", "/result.csv": "previous result", "/keep": "untouched" });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const before = volume.toJSON();
  try {
    const result = await shell.exec("ssconvert /empty.html /result.csv");
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Loading file:///empty.html failed\n");
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("ssconvert HTML cell admission rejects before acquiring destination authority", async () => {
  const original = '<table><tr><td>one<td>two</table>';
  const volume = Volume.fromJSON({ "/book.html": original, "/result.csv": "previous result", "/secret": "private" });
  const before = volume.toJSON(), reads: string[] = [], fs = filesystem(volume);
  const tracked = new Proxy(fs, { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
    if (key === "readFile") return async (path: string, supplied?: Parameters<typeof fs.readFile>[1]) => {
      reads.push(path); return await fs.readFile(path, supplied);
    };
    if (key === "writeFile" || key === "rename" || key === "unlink") return () => { throw new Error("destination acquired before HTML admission"); };
    return Reflect.get(target, key);
  } });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, cells: 1 } };
  const shell = new Shell({ fs: tracked }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  try {
    const result = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /book.html /result.csv");
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
    assert.equal(result.stderr, "ssconvert HTML cells limit exceeded\n");
    await assert.rejects(engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(original)], filename: "book.html" },
      exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write() { throw new Error("SDK destination acquired"); } } } },
    { signal: new AbortController().signal }), { code: "resource-limit", message: "ssconvert HTML cells limit exceeded" });
    assert.deepEqual(reads, ["/book.html"]); assert.deepEqual(volume.toJSON(), before);
    const recovered = await shell.exec("ssconvert --list-importers");
    assert.equal(recovered.exitCode, 0); assert.match(recovered.stderr, /Gnumeric_html:html/);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert HTML nested sheet names and metadata survive command checkpoint and SDK replay", async () => {
  const original = '<table><caption>Sales &amp; Costs</caption><tr><td style="color:red" x:num="99">4<table><caption>Detail</caption><tr><td>6</table>z</table><table><tr><td>tail</table>';
  const volume = Volume.fromJSON({ "/book.html": original, "/keep": "untouched" });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  const signal = new AbortController().signal;
  try {
    const checkpoint = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /book.html /checkpoint.xml");
    assert.equal(checkpoint.exitCode, 0, checkpoint.stderr); assert.equal(checkpoint.stderr, "");
    const restored = await engine.readWorkbook({ kind: "stream", filename: "checkpoint.xml", source: [new Uint8Array(volume.readFileSync("/checkpoint.xml") as Uint8Array)] }, {}, { signal });
    assert.deepEqual(restored.sheets.map(sheet => sheet.name), ["Sales &amp; Costs", "Detail"]);
    assert.deepEqual(restored.sheets.map(sheet => sheet.cells.map(cell => [cell.row, cell.column, { ...cell.value }])), [
      [[0, 0, { kind: "string", value: "4[see sheet Detail]z" }], [1, 0, { kind: "string", value: "tail" }]],
      [[0, 0, { kind: "number", value: 6 }]]
    ]);
    for (const input of ["/book.html", "/checkpoint.xml"]) {
      const replay = await shell.exec(`ssconvert -T Gnumeric_stf:stf_csv -O sheet=Detail ${input} fd://1`);
      assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.stdout, "6\n"); assert.equal(replay.stderr, "");
    }
    assert.equal(volume.readFileSync("/book.html", "utf8"), original);
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/book.html", "/checkpoint.xml", "/keep"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert SpreadsheetML import shares SDK bytes, content probes and replay namespace effects", async () => {
  const ns = "urn:schemas-microsoft-com:office:spreadsheet";
  const original = `<Workbook xmlns="${ns}" xmlns:ss="${ns}"><Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="Number">4</Data></Cell><Cell ss:Formula="=RC[-1]+2"><Data ss:Type="Number">99</Data></Cell></Row></Table></Worksheet></Workbook>`;
  const volume = Volume.fromJSON({ "/book.xml": original, "/keep": "untouched" });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  try {
    const command = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /book.xml /round.xml");
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ""); assert.equal(command.stdout, "");
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", filename: "book.xml", source: [new TextEncoder().encode(original)] }, exportType: "Gnumeric_XmlIO:sax:0",
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/round.xml") as Uint8Array), chunks[0]);
    const replay = await shell.exec("ssconvert --recalc -T Gnumeric_stf:stf_csv /round.xml fd://1");
    assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.stderr, ""); assert.equal(replay.stdout, "4,6\n");
    const forced = await shell.exec("ssconvert -I Gnumeric_Excel:excel_xml -T Gnumeric_stf:stf_csv /book.xml fd://1");
    assert.equal(forced.exitCode, 0, forced.stderr); assert.equal(forced.stdout, "4,6\n");
    const listing = await shell.exec("ssconvert --list-importers");
    assert.equal(listing.exitCode, 0); assert.match(listing.stderr, /Gnumeric_Excel:excel_xml/);
    assert.equal(volume.readFileSync("/book.xml", "utf8"), original);
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/book.xml", "/keep", "/round.xml"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert malformed SpreadsheetML fails before publishing an output", async () => {
  const volume = Volume.fromJSON({ "/bad.xml": '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet', "/keep": "untouched" });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  try {
    const result = await shell.exec("ssconvert -I Gnumeric_Excel:excel_xml /bad.xml /out.csv");
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /XML document not well formed!/);
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/bad.xml", "/keep"]);
  } finally { await shell.dispose(); }
});

test("ssconvert SpreadsheetML rejects entity authority and preserves an existing destination", async () => {
  const ns = "urn:schemas-microsoft-com:office:spreadsheet";
  const input = `<!DOCTYPE Workbook [<!ENTITY secret SYSTEM "file:///secret">]><Workbook xmlns="${ns}" xmlns:ss="${ns}"><Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="String">&secret;</Data></Cell></Row></Table></Worksheet></Workbook>`;
  const volume = Volume.fromJSON({ "/book.xml": input, "/secret": "must not be read", "/result.csv": "previous result" });
  const reads: string[] = [];
  const fs = filesystem(volume);
  const tracked = new Proxy(fs, { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
    if (key === "readFile") return async (path: string, supplied?: Parameters<typeof fs.readFile>[1]) => { reads.push(path); return await fs.readFile(path, supplied); };
    return Reflect.get(target, key, target);
  } });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
  const shell = new Shell({ fs: tracked }).use(ssconvertCommands(binding));
  const before = volume.toJSON();
  try {
    const result = await shell.exec("ssconvert -I Gnumeric_Excel:excel_xml -T Gnumeric_stf:stf_csv /book.xml /result.csv");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "ssconvert host denies XML DTD and entity declarations\n");
    assert.deepEqual(reads, ["/book.xml"]);
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("ssconvert XLSX template import shares command/SDK engine, bytes and replay effects", async () => {
  const ss = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
  const zip = createZipCodec(); const signal = new AbortController().signal;
  const bounds = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
    maxMembers: 20, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
  const parts = { "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="S" sheetId="1" r:id="s"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/s.xml"/></Relationships>`,
    "xl/worksheets/s.xml": `<worksheet xmlns="${ss}"><sheetData><row><c t="inlineStr"><is><t>hello</t></is></c><c><f>1+2</f><v>3</v></c></row></sheetData></worksheet>` };
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "deflate" }, bounds, signal));
  const original = await zip.writeZipArchive({ entries, comment: new Uint8Array() }, bounds, signal);
  const volume = Volume.fromJSON({ "/keep": "untouched" }); volume.writeFileSync("/book.xltx", original);
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)); const engine = createEngine(binding);
  try {
    const command = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /book.xltx /round.xml");
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ""); assert.equal(command.stdout, "");
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", filename: "book.xltx", source: [original] }, exportType: "Gnumeric_XmlIO:sax:0",
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/round.xml") as Uint8Array), chunks[0]);
    const replay = await shell.exec("ssconvert --recalc -T Gnumeric_stf:stf_csv /round.xml fd://1");
    assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.stderr, ""); assert.equal(replay.stdout, "hello,3\n");
    assert.deepEqual(new Uint8Array(volume.readFileSync("/book.xltx") as Uint8Array), original);
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/book.xltx", "/keep", "/round.xml"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert Gnumeric XML codecs share command/SDK bytes and preserve replay and namespace effects", async () => {
  const source = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Sheets><gnm:Sheet><gnm:Name>Original Ω</gnm:Name><gnm:PrintInformation><gnm:Header Left="report" Middle="&amp;[TAB]" Right=""/></gnm:PrintInformation><gnm:Cells><gnm:Cell Row="2" Col="3" ValueType="40">7</gnm:Cell><gnm:Cell Row="4" Col="1">=D3+2</gnm:Cell></gnm:Cells><gnm:MergedRegions><gnm:Merge>A1:B2</gnm:Merge></gnm:MergedRegions><gnm:SheetLayout TopLeft="C3"><gnm:FreezePanes FrozenTopLeft="A1" UnfrozenTopLeft="B2"/></gnm:SheetLayout></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const indexed = source.replace("<gnm:Sheets>", '<gnm:Calculation DateConvention="Apple:1904"/><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">Original Ω</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets>');
  const volume = Volume.fromJSON({ "/original.xml": indexed, "/keep": "untouched" });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const engine = createEngine(binding);
  try {
    const command = await shell.exec("ssconvert /original.xml /round.gnumeric");
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ""); assert.equal(command.stdout, "");
    const compressed = new Uint8Array(volume.readFileSync("/round.gnumeric") as Uint8Array);
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", filename: "/original.xml", source: [new TextEncoder().encode(indexed)] },
      exportType: "Gnumeric_XmlIO:sax:0", destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
    assert.deepEqual(new Uint8Array(gunzipSync(compressed)), chunks[0]);
    const replay = await shell.exec("ssconvert --recalc /round.gnumeric /replay.xml");
    assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.stderr, "");
    const stdout = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /replay.xml fd://1");
    assert.equal(stdout.exitCode, 0, stdout.stderr); assert.equal(stdout.stderr, "");
    assert.match(stdout.stdout, /gnm:PrintInformation/); assert.match(stdout.stdout, /gnm:FreezePanes/); assert.match(stdout.stdout, /A1:B2/);
    const round = await engine.readWorkbook({ kind: "stream", filename: "/replay.xml", source: [stdout.stdoutBytes] }, {}, { signal: new AbortController().signal });
    assert.equal(round.dateSystem, "1904");
    assert.equal(round.sheets[0]!.name, "Original Ω"); assert.equal(round.sheets[0]!.cells[1]!.formula, "=D3+2");
    assert.equal(round.sheets[0]!.cells[1]!.cachedResult, undefined);
    const before = volume.toJSON();
    const denied = await shell.exec("ssconvert -I Gnumeric_XmlIO:sax -T Gnumeric_XmlIO:sax:0 /keep /replay.xml");
    assert.equal(denied.exitCode, 1); assert.match(denied.stderr, /Invalid Gnumeric XML/); assert.deepEqual(volume.toJSON(), before);
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched"); assert.equal(volume.readFileSync("/original.xml", "utf8"), indexed);
    volume.writeFileSync("/unknown.xml", indexed.replace('<gnm:Cells>', '<gnm:Cells><gnm:Unknown/>'));
    const warning = await shell.exec("ssconvert -T Gnumeric_XmlIO:sax:0 /unknown.xml fd://1");
    assert.equal(warning.exitCode, 0);
    assert.equal(warning.stderr, "Unexpected element 'gnm:Unknown' in state : \n\tWorkbook -> Sheets -> Sheet -> Cells\n");
    volume.writeFileSync("/inconsistent.xml", source);
    const unchanged = volume.toJSON();
    const inconsistent = await shell.exec("ssconvert -I Gnumeric_XmlIO:sax -T Gnumeric_XmlIO:sax:0 /inconsistent.xml /replay.xml");
    assert.equal(inconsistent.exitCode, 1);
    assert.equal(inconsistent.stderr, "E File has inconsistent SheetNameIndex element.\n");
    assert.equal(inconsistent.stdout, "");
    assert.deepEqual(volume.toJSON(), unchanged);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert number/date text modes share SDK bytes, styles, order and memfs effects", async () => {
  const fixture: Workbook = { dateSystem: "1900", calculationMode: "manual", sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 45292.5 }, format: "yyyy-mm-dd", style: { font: "Sans", wrapping: true } },
    { row: 1, column: 0, value: { kind: "number", value: -12.5 }, format: "[Red]0.00" },
    { row: 2, column: 0, value: { kind: "boolean", value: true } },
    { row: 3, column: 0, value: { kind: "error", value: "#DIV/0!" } },
    { row: 4, column: 0, value: { kind: "number", value: 1.25 }, format: "0." + "0".repeat(101) + "E+00" }
  ] }] };
  const original = structuredClone(fixture);
  const volume = Volume.fromJSON({ "/input": "original-format-fixture", "/keep": "untouched" });
  const codec: Codec = { id: "format-fixture", description: "Original in-memory number-format fixture", extensions: ["format-fixture"],
    probeContent: () => true, async read() { return fixture; },
    exportOptionRules: { format: { kind: "enum", values: ["automatic", "raw", "preserve"] } },
    async write(book, values, context) {
      assert.ok(context.formatting, "Actual command engine supplies formatting capability");
      const mode = (values[0]?.slice("format=".length) ?? "automatic") as TextFormatMode;
      const lines = [];
      for (const cell of book.sheets[0]!.cells) lines.push(await renderCellText(cell, book, context, mode));
      return new TextEncoder().encode(lines.join("\n") + "\n");
    } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, inputBytes: 10000, outputBytes: 10000, workbookWork: 10000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  const expected = { automatic: "2024/01/01 12:00:00\n-12.5\nTRUE\n#DIV/0!\n1.25\n", raw: "45292.5\n-12.5\nTRUE\n#DIV/0!\n1.25\n",
    preserve: "2024-01-01\n−12.50\nTRUE\n#DIV/0!\n1.25" + "0".repeat(99) + "E+00\n" };
  try {
    for (const mode of ["automatic", "raw", "preserve"] as const) {
      const command = await shell.exec(`ssconvert -T format-fixture -O format=${mode} /input /${mode}.format-fixture`);
      assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stdout, ""); assert.equal(command.stderr, "");
      const chunks: Uint8Array[] = [];
      const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original-format-fixture")] },
        destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
        exportType: codec.id, exportOptions: [`format=${mode}`] }, { signal: new AbortController().signal });
      assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
      assert.deepEqual(chunks[0], new Uint8Array(volume.readFileSync(`/${mode}.format-fixture`) as Uint8Array));
      assert.equal(new TextDecoder().decode(chunks[0]), expected[mode]);
    }
    assert.deepEqual(fixture, original);
    assert.deepEqual(volume.toJSON(), { "/input": "original-format-fixture", "/keep": "untouched",
      "/automatic.format-fixture": expected.automatic, "/raw.format-fixture": expected.raw, "/preserve.format-fixture": expected.preserve });
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert scientific TEXT precision retains original, checkpoint and replay bytes", async () => {
  const volume = Volume.fromJSON({ "/input": "scientific-original", "/keep": "untouched" });
  const fixture: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1.25 } },
    { row: 0, column: 1, formula: '=TEXT(A1,"0.' + "0".repeat(101) + 'E+00")', formulaDirty: true,
      value: { kind: "blank" }, style: { protection: { locked: true }, rotation: 45 } }
  ] }] };
  const original = structuredClone(fixture);
  const codec: Codec = { id: "scientific", description: "Original scientific precision fixture", extensions: ["scientific"],
    probeContent: () => true, async read(bytes) {
      const text = new TextDecoder().decode(bytes);
      return text === "scientific-original" ? fixture : JSON.parse(text) as Workbook;
    }, async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, cells: 100, inputBytes: 10000, outputBytes: 10000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  const chunks: Uint8Array[] = [];
  const destination = { kind: "stream" as const, sink: { async write(bytes: Uint8Array) { chunks.push(new Uint8Array(bytes)); } } };
  const invocation = { signal: new AbortController().signal };
  try {
    const command = await shell.exec("ssconvert -T scientific /input fd://1");
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, "");
    const checkpoint = JSON.parse(command.stdout) as Workbook;
    const display = "1.25" + "0".repeat(99);
    assert.deepEqual(checkpoint.sheets[0]!.cells[1]!.cachedResult, { kind: "string", value: display + "E+00" });
    const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("scientific-original")] }, destination, exportType: "scientific" }, invocation);
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
    assert.equal(new TextDecoder().decode(chunks.pop()), command.stdout);
    const replay = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(command.stdout)] }, destination,
      exportType: "scientific", updateExpressions: ["A1=12.5"] }, invocation);
    assert.equal(replay.exitCode, 0); assert.deepEqual(replay.diagnostics, []);
    const updated = JSON.parse(new TextDecoder().decode(chunks.pop())) as Workbook;
    assert.deepEqual(updated.sheets[0]!.cells[1]!.cachedResult, { kind: "string", value: display + "E+01" });
    assert.deepEqual(updated.sheets[0]!.cells[1]!.style, fixture.sheets[0]!.cells[1]!.style);
    assert.deepEqual(fixture, original);
    assert.deepEqual(volume.toJSON(), { "/input": "scientific-original", "/keep": "untouched" });
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert statistical families share command/SDK bytes, random capability and replay", async () => {
  const volume = Volume.fromJSON({ "/input": "statistics-original", "/keep": "untouched" });
  const number = (value: number) => ({ kind: "number" as const, value });
  const formulas = ["=AVERAGE(A1:A3)", "=PERCENTILE(A1:A3,0.25)", "=R.PNORM(0,0,1)",
    "=PROBBLOCK(2,2)", "=INTERPOLATION({1;2;3},{10;20;20},1.5)", "=RANDUNIFORM(2,6)", "=VAR(1)"];
  const fixture: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    ...[1, 3, 8].map((value, row) => ({ row, column: 0, value: number(value) })),
    ...formulas.map((formula, column) => ({ row: 4, column, formula, formulaDirty: true, value: number(99) }))
  ] }] };
  const codec: Codec = { id: "statistics", description: "Original statistical capability fixture", extensions: ["statistics"], probeContent: () => true,
    async read(bytes) { const text = new TextDecoder().decode(bytes); return text === "statistics-original" ? fixture : JSON.parse(text) as Workbook; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  let draws = 0;
  const binding = { ...options, codecs: [codec], random: { next() { draws++; return .25; } },
    limits: { ...options.limits, inputBytes: 10000, outputBytes: 10000, cells: 100, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  const outputs: Uint8Array[] = [];
  const destination = { kind: "stream" as const, sink: { async write(bytes: Uint8Array) { outputs.push(new Uint8Array(bytes)); } } };
  const invocation = { signal: new AbortController().signal };
  try {
    const command = await shell.exec("ssconvert -T statistics /input fd://1");
    assert.equal(command.exitCode, 0, command.stderr);
    assert.equal(command.stderr, "");
    assert.equal(draws, 1);
    const checkpoint = JSON.parse(command.stdout) as Workbook;
    assert.deepEqual(checkpoint.sheets[0]!.cells.filter(cell => cell.row === 4).map(cell => cell.cachedResult),
      [number(4), number(2), number(.5), number(.4), number(15), number(3), { kind: "error", value: "#DIV/0!" }]);
    draws = 0;
    const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("statistics-original")] }, destination, exportType: "statistics" }, invocation);
    assert.equal(sdk.exitCode, 0);
    assert.deepEqual(sdk.diagnostics, []);
    assert.equal(draws, 1);
    assert.equal(new TextDecoder().decode(outputs.pop()), command.stdout);
    const replay = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(command.stdout)] }, destination, exportType: "statistics", updateExpressions: ["A2=6"] }, invocation);
    assert.equal(replay.exitCode, 0);
    assert.deepEqual(replay.diagnostics, []);
    const updated = JSON.parse(new TextDecoder().decode(outputs.pop())) as Workbook;
    assert.deepEqual(updated.sheets[0]!.cells.find(cell => cell.row === 4 && cell.column === 0)!.cachedResult, number(5));
    assert.deepEqual(updated.sheets[0]!.cells.find(cell => cell.row === 4 && cell.column === 1)!.cachedResult, number(3.5));
    assert.deepEqual(volume.toJSON(), { "/input": "statistics-original", "/keep": "untouched" });
    assert.deepEqual(fixture.sheets[0]!.cells.filter(cell => cell.row === 4).map(cell => cell.value), formulas.map(() => number(99)));
  } finally { await engine.dispose(); await shell.dispose(); }
});

for (const scenario of ["missing random capability", "rejection budget"] as const) {
  test(`ssconvert statistical ${scenario} preserves output namespace and SDK error`, async () => {
    const volume = Volume.fromJSON({ "/input": "original", "/output.statistics": "keep", "/keep": "untouched" });
    const formula = scenario === "rejection budget" ? "=RANDNORM(0,1)" : "=RANDUNIFORM(0,1)";
    const codec: Codec = { id: "statistics", description: "Original bounded random fixture", extensions: ["statistics"], probeContent: () => true,
      async read() { return { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 99 } }] }] }; },
      async write() { throw new Error("Random failure must occur before writer acquisition"); } };
    const binding = { ...options, codecs: [codec], limits: { ...options.limits, workbookWork: 50 },
      ...(scenario === "rejection budget" ? { random: { next: () => .5 } } : {}) };
    const diagnostic = scenario === "rejection budget" ? "ssconvert workbook work limit exceeded" : "ssconvert random functions require an explicit random source";
    const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
    try {
      const command = await shell.exec("ssconvert -T statistics /input /output.statistics");
      assert.equal(command.exitCode, 1);
      assert.equal(command.stdout, "");
      assert.equal(command.stderr, diagnostic + "\n");
      await assert.rejects(engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original")] },
        destination: { kind: "stream", sink: { async write() { throw new Error("Unexpected output write"); } } }, exportType: "statistics" },
        { signal: new AbortController().signal }), { message: diagnostic });
      assert.deepEqual(volume.toJSON(), { "/input": "original", "/output.statistics": "keep", "/keep": "untouched" });
    } finally { await engine.dispose(); await shell.dispose(); }
  });
}

test("ssconvert shares all numeric groups, array matrices and replay through command and SDK", async () => {
  const volume = Volume.fromJSON({ "/input": "numeric-original", "/keep": "untouched" });
  const number = (value: number) => ({ kind: "number" as const, value });
  const formulas = ["=COMBIN(7,3)", '=IMSUM("2+i","3-i")', '=CONVERT(2,"km","m")', "=NT_PHI(36)", "=FLT.RADIX()", "=BITAND(-1,1/0)", "=SUM(A1,1)", "=BESSELK(-1,0)", "=BESSELK(0,0)", "=ILOG(0.5,4)", "=ODD(9007199254740992)", "=EVEN(FLT.NEXTAFTER(0,1))", "=GAMMA(0.125)", "=BESSELJ(100,1)", "=BESSELY(17,0.000001)", "=BESSELJ(1,-200)"];
  const fixture: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [...formulas.map((formula, column) => ({ row: 0, column, formula, formulaDirty: true, value: number(99) })),
    ...[2, 3].flatMap(row => [0, 1].map(column => ({ row, column, formulaGroup: "identity", formulaDirty: true, value: number(99) })))],
    formulaGroups: [{ id: "identity", kind: "array", expression: "=MUNIT(2)", range: { startRow: 2, endRow: 3, startColumn: 0, endColumn: 1 } }] }] };
  const codec: Codec = { id: "numeric", description: "Original numeric replay fixture", extensions: ["numeric"], probeContent: () => true,
    async read(bytes) { const text = new TextDecoder().decode(bytes); return text === "numeric-original" ? fixture : JSON.parse(text) as Workbook; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, cells: 100, inputBytes: 10000, outputBytes: 10000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  try {
    const command = await shell.exec("ssconvert -T numeric /input fd://1");
    assert.equal(command.exitCode, 0, command.stderr);
    assert.equal(command.stderr, "sf-bessel: trouble in bessel_k\n");
    const checkpoint = JSON.parse(command.stdout) as Workbook;
    assert.deepEqual(checkpoint.sheets[0]!.cells.filter(cell => cell.row === 0).map(cell => cell.cachedResult), [number(35), number(5), number(2000), number(12), number(2), { kind: "error", value: "#DIV/0!" }, number(36), { kind: "error", value: "#NUM!" }, { kind: "error", value: "#NUM!" }, number(0), number(9007199254740992), number(2), number(7.533941598797612), number(-.07714535201411217), number(-.09263693163577924), { kind: "error", value: "#NUM!" }]);
    assert.deepEqual(checkpoint.sheets[0]!.cells.filter(cell => cell.formulaGroup === "identity").map(cell => [cell.row, cell.column, cell.value]), [[2, 0, number(1)], [2, 1, number(0)], [3, 0, number(0)], [3, 1, number(1)]]);
    const outputs: Uint8Array[] = [];
    const destination = { kind: "stream" as const, sink: { async write(bytes: Uint8Array) { outputs.push(new Uint8Array(bytes)); } } };
    const invocation = { signal: new AbortController().signal };
    const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("numeric-original")] }, destination, exportType: "numeric" }, invocation);
    assert.equal(sdk.exitCode, 0);
    assert.deepEqual(sdk.diagnostics.map(diagnostic => diagnostic.message), ["sf-bessel: trouble in bessel_k"]);
    assert.equal(new TextDecoder().decode(outputs.pop()), command.stdout);
    const replay = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(command.stdout)] }, destination, exportType: "numeric", updateExpressions: ["A1=9"] }, invocation);
    assert.equal(replay.exitCode, 0);
    assert.deepEqual(replay.diagnostics, []);
    const updated = JSON.parse(new TextDecoder().decode(outputs.pop())) as Workbook;
    assert.deepEqual(updated.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 6)!.cachedResult, number(10));
    assert.deepEqual(updated.sheets[0]!.cells.filter(cell => cell.formulaGroup === "identity"), checkpoint.sheets[0]!.cells.filter(cell => cell.formulaGroup === "identity"));
    assert.deepEqual(volume.toJSON(), { "/input": "numeric-original", "/keep": "untouched" });
    assert.deepEqual(fixture.sheets[0]!.cells.map(cell => cell.value), Array.from({ length: formulas.length + 4 }, () => number(99)));
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert shares logical/text/info/lookup/database formulas and persisted dynamic links across command and SDK", async () => {
  const volume = Volume.fromJSON({ "/input": "original", "/keep": "untouched" });
  const number = (value: number) => ({ kind: "number" as const, value });
  const fixture: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 1, column: 4, formula: '=SUM(INDIRECT(LEFT(D1,5)))', formulaDirty: true, value: number(99) },
    { row: 1, column: 5, formula: '=IFERROR(IF(ISNUMBER(E2),UPPER("ok"),"bad"),"error")', formulaDirty: true, value: number(99) },
    { row: 1, column: 6, formula: '=DSUM(Data!A1:B3,"Value",Data!D1:D2)', formulaDirty: true, value: number(99) },
    { row: 0, column: 0, value: number(1) }, { row: 0, column: 1, value: number(8) }, { row: 0, column: 2, value: number(3) },
    { row: 0, column: 3, value: { kind: "string", value: "A1:C1suffix" } },
    { row: 2, column: 4, formula: '=TEXTAFTER("aςb","Σ",1,1)', formulaDirty: true, value: number(99) },
    { row: 2, column: 5, formula: '=ISODD(" 3")', formulaDirty: true, value: number(99) },
    { row: 2, column: 6, formula: '=SEARCH("","abc",4)', formulaDirty: true, value: number(99) }
  ] }, { id: "d", name: "Data", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Kind" } }, { row: 0, column: 1, value: { kind: "string", value: "Value" } },
    { row: 1, column: 0, value: { kind: "string", value: "a" } }, { row: 1, column: 1, value: number(7) },
    { row: 2, column: 0, value: { kind: "string", value: "b" } }, { row: 2, column: 1, value: number(5) },
    { row: 0, column: 3, value: { kind: "string", value: "Kind" } }, { row: 1, column: 3, value: { kind: "string", value: "=a" } }
  ] }] };
  const codec: Codec = { id: "fixture", description: "Original five-plugin dynamic replay fixture", extensions: ["fixture"], probeContent: () => true,
    async read(bytes) { const text = new TextDecoder().decode(bytes); return text === "original" ? fixture : JSON.parse(text) as Workbook; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, cells: 100, inputBytes: 10000, outputBytes: 10000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  try {
    const command = await shell.exec("ssconvert -T fixture /input fd://1");
    assert.equal(command.exitCode, 0, command.stderr);
    assert.equal(command.stderr, "");
    const checkpoint = JSON.parse(command.stdout) as Workbook;
    assert.deepEqual(checkpoint.sheets[0]!.cells.slice(0, 3).map(cell => cell.cachedResult), [number(12), { kind: "string", value: "OK" }, number(7)]);
    assert.deepEqual(checkpoint.sheets[0]!.cells.filter(cell => cell.row === 2).map(cell => cell.cachedResult), [
      { kind: "string", value: "b" }, { kind: "boolean", value: false }, number(4)
    ]);
    assert.equal(checkpoint.sheets[0]!.cells[0]!.formula, fixture.sheets[0]!.cells[0]!.formula);
    const outputs: Uint8Array[] = [];
    const destination = { kind: "stream" as const, sink: { async write(bytes: Uint8Array) { outputs.push(new Uint8Array(bytes)); } } };
    const invocation = { signal: new AbortController().signal };
    const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original")] }, destination, exportType: "fixture" }, invocation);
    assert.equal(sdk.exitCode, 0);
    assert.deepEqual(sdk.diagnostics, []);
    assert.equal(new TextDecoder().decode(outputs.pop()), command.stdout);
    const replay = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(command.stdout)] }, destination, exportType: "fixture", updateExpressions: ["B1=9"] }, invocation);
    assert.equal(replay.exitCode, 0);
    assert.deepEqual(replay.diagnostics, []);
    const updated = JSON.parse(new TextDecoder().decode(outputs.pop())) as Workbook;
    assert.deepEqual(updated.sheets[0]!.cells[0]!.cachedResult, number(13));
    assert.deepEqual(updated.sheets[0]!.cells[1]!.cachedResult, { kind: "string", value: "OK" });
    assert.deepEqual(updated.sheets[0]!.cells.filter(cell => cell.row === 2).map(cell => [cell.formula, cell.cachedResult]),
      checkpoint.sheets[0]!.cells.filter(cell => cell.row === 2).map(cell => [cell.formula, cell.cachedResult]));
    assert.deepEqual(volume.toJSON(), { "/input": "original", "/keep": "untouched" });
    assert.deepEqual(fixture.sheets[0]!.cells[0]!.value, number(99));
  } finally { await engine.dispose(); await shell.dispose(); }
});

for (const [header, expectedDraws] of [["=RAND()", 1], ["=RAND()+D1*0", 2]] as const) {
  test(`ssconvert TABLE retains the copied volatile header through command and SDK: ${header}`, async () => {
    const volume = Volume.fromJSON({ "/input": "original", "/keep": "untouched" });
    const fixture: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
      { row: 0, column: 0, formula: "=IF(A2=E1,1,0)", formulaDirty: true, value: { kind: "number", value: 9 } },
      { row: 0, column: 3, value: { kind: "number", value: 10 } },
      { row: 0, column: 4, value: { kind: "number", value: 20 } },
      { row: 1, column: 1, formulaGroup: "t", formulaDirty: true, value: { kind: "number", value: 9 } },
      { row: 0, column: 1, value: { kind: "number", value: 2 } },
      { row: 1, column: 0, formula: header, formulaDirty: true, value: { kind: "number", value: 99 } }
    ], formulaGroups: [{ id: "t", kind: "array", expression: "=TABLE(D1,E1)",
      range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } }] }] };
    const codec: Codec = { id: "fixture", description: "Original volatile-header cache fixture", extensions: ["fixture"],
      probeContent: () => true, async read() { return fixture; },
      async write(book) { return new TextEncoder().encode(`${JSON.stringify(book.sheets[0]!.cells.find(cell => cell.formulaGroup === "t")!.value)}\n`); } };
    let draws = 0;
    const binding = { ...options, codecs: [codec], limits: { ...options.limits, workbookWork: 10000 },
      random: { next() { return ++draws / 100; } } };
    const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
    try {
      const command = await shell.exec("ssconvert -T fixture /input fd://1");
      assert.equal(command.exitCode, 0, command.stderr);
      assert.equal(command.stderr, "");
      assert.equal(command.stdout, '{"kind":"number","value":1}\n');
      assert.equal(draws, expectedDraws);
      draws = 0;
      const outputs: Uint8Array[] = [];
      const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original")] },
        destination: { kind: "stream", sink: { async write(bytes) { outputs.push(new Uint8Array(bytes)); } } }, exportType: "fixture" },
        { signal: new AbortController().signal });
      assert.equal(sdk.exitCode, 0);
      assert.deepEqual(sdk.diagnostics, []);
      assert.equal(new TextDecoder().decode(outputs[0]), command.stdout);
      assert.equal(draws, expectedDraws);
      assert.deepEqual(volume.toJSON(), { "/input": "original", "/keep": "untouched" });
      assert.deepEqual(fixture.sheets[0]!.cells[5]!.value, { kind: "number", value: 99 });
    } finally { await engine.dispose(); await shell.dispose(); }
  });
}

test("ssconvert updates computed range interiors through the command and SDK, retaining replayable caches", async () => {
  const volume = Volume.fromJSON({ "/input": "original", "/keep": "untouched" });
  const fixture: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 1, column: 3, formula: "=SUM(IF(TRUE,A1,A2):(C1))", formulaDirty: false,
      value: { kind: "number", value: 4 }, cachedResult: { kind: "number", value: 4 } },
    { row: 0, column: 0, value: { kind: "number", value: 1 } },
    { row: 0, column: 2, value: { kind: "number", value: 3 } }
  ] }] };
  const codec: Codec = { id: "fixture", description: "Original computed-range update fixture", extensions: ["fixture"],
    probeContent: () => true,
    async read(bytes) { return new TextDecoder().decode(bytes) === "original" ? fixture : JSON.parse(new TextDecoder().decode(bytes)) as Workbook; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, inputBytes: 10000, outputBytes: 10000, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  try {
    const original = await shell.exec("ssconvert --set B1=8 -T fixture /input fd://1");
    assert.equal(original.exitCode, 0, original.stderr);
    assert.equal(original.stderr, "");
    const checkpoint = JSON.parse(original.stdout) as Workbook;
    assert.deepEqual(checkpoint.sheets[0]!.cells[0]!.cachedResult, { kind: "number", value: 12 });
    const outputs: Uint8Array[] = [];
    const destination = { kind: "stream" as const, sink: { async write(bytes: Uint8Array) { outputs.push(new Uint8Array(bytes)); } } };
    const invocation = { signal: new AbortController().signal };
    const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original")] },
      destination, exportType: "fixture", updateExpressions: ["B1=8"] }, invocation);
    assert.equal(sdk.exitCode, 0);
    assert.deepEqual(sdk.diagnostics, []);
    assert.equal(new TextDecoder().decode(outputs[0]), original.stdout);
    outputs.length = 0;
    const replay = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(original.stdout)] }, destination, exportType: "fixture" }, invocation);
    assert.equal(replay.exitCode, 0);
    assert.deepEqual(replay.diagnostics, []);
    assert.equal(new TextDecoder().decode(outputs[0]), original.stdout);
    assert.deepEqual(volume.toJSON(), { "/input": "original", "/keep": "untouched" });
    assert.equal(fixture.sheets[0]!.cells[0]!.formulaDirty, false);
    assert.deepEqual(fixture.sheets[0]!.cells[0]!.cachedResult, { kind: "number", value: 4 });
  } finally { await engine.dispose(); await shell.dispose(); }
});

const options = {
  codecs: [
    {
      id: "fixture",
      description: "Original fixture",
      extensions: ["fixture"],
      async exportOptions(values: readonly string[]) { return [...values]; },
      probeContent: () => true,
      async read(bytes: Uint8Array) {
        return {
          sheets: [
            {
              id: "s",
              name: "Sheet",
              cells: [
                {
                  row: 0,
                  column: 0,
                  value: { kind: "string" as const, value: new TextDecoder().decode(bytes) }
                }
              ]
            }
          ]
        };
      },
      async write(book: import("poe-code/ssconvert").Workbook, values: readonly string[]) {
        const cell = book.sheets[0]!.cells[0]!;
        return new TextEncoder().encode(
          `${cell.value.kind === "string" ? cell.value.value : ""}:${values.join(",")}`
        );
      }
    }
  ],
  limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 2, operations: 10 },
  environment: { env: {}, locale: "C", timezone: "UTC" }
};

test("ssconvert dependency calculation shares exact command/SDK bytes, caches and namespace effects", async () => {
  const volume = Volume.fromJSON({ "/input": "original", "/keep": "untouched" });
  const fixture: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 2 } },
    { row: 1, column: 0, value: { kind: "number", value: 4 } },
    { row: 1, column: 1, formula: '=IF(A1>0,PRODUCT(A1:A2),1/0)', formulaDirty: true, value: { kind: "blank" } },
    { row: 1, column: 2, formula: '=A1:A2+"3"', formulaDirty: true, value: { kind: "blank" } },
    { row: 1, column: 3, formula: '=0^0', formulaDirty: true, value: { kind: "blank" } }
  ] }] };
  const codec: Codec = { id: "fixture", description: "Original calculation core fixture", extensions: ["fixture"],
    probeContent: () => true, async read() { return fixture; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, outputBytes: 4000, inputBytes: 4000, workbookWork: 10000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), sdk = createEngine(binding);
  try {
    const command = await shell.exec("ssconvert -T fixture /input fd://1");
    assert.equal(command.exitCode, 0, command.stderr);
    assert.equal(command.stderr, "");
    const chunks: Uint8Array[] = [];
    const result = await sdk.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original")] },
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } }, exportType: "fixture" },
      { signal: new AbortController().signal });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(command.stdout, new TextDecoder().decode(chunks[0]));
    const book = JSON.parse(command.stdout) as Workbook;
    assert.deepEqual(book.sheets[0]!.cells.slice(2).map(cell => cell.cachedResult), [
      { kind: "number", value: 8 }, { kind: "number", value: 7 }, { kind: "error", value: "#NUM!" }
    ]);
    assert.deepEqual(fixture.sheets[0]!.cells.slice(2).map(cell => cell.value), Array.from({ length: 3 }, () => ({ kind: "blank" })));
    assert.deepEqual(volume.toJSON(), { "/input": "original", "/keep": "untouched" });
  } finally { await sdk.dispose(); await shell.dispose(); }
});

test("ssconvert external formulas call only the explicitly injected resolver with cancellation", async () => {
  const volume = Volume.fromJSON({ "/input": "original" });
  const codec: Codec = { id: "fixture", description: "Original authorized external fixture", extensions: ["fixture"],
    probeContent: () => true, async read(): Promise<Workbook> { return { sheets: [{ id: "s", name: "Sheet", cells: [
      { row: 0, column: 0, formula: "='[authorized.xls]Sheet1'!A1+1", formulaDirty: true, value: { kind: "blank" } }
    ] }] }; }, async write(book) { return new TextEncoder().encode(JSON.stringify(book.sheets[0]!.cells[0]!.value)); } };
  const resolutions: ExternalFormulaRequest[] = [];
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, inputBytes: 2000, outputBytes: 2000 },
    externalReferences: { resolve(request: ExternalFormulaRequest, signal: AbortSignal) {
      signal.throwIfAborted(); resolutions.push(request);
      assert.equal(request.kind, "reference");
      if (request.kind === "reference") { assert.equal(request.first.workbook, "authorized.xls"); assert.equal(request.first.sheet, "Sheet1"); }
      assert.ok(Object.isFrozen(request));
      return { kind: "number" as const, value: 9 };
    } } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), sdk = createEngine(binding);
  try {
    const command = await shell.exec("ssconvert -T fixture /input fd://1");
    assert.equal(command.exitCode, 0, command.stderr);
    assert.equal(command.stdout, '{"kind":"number","value":10}');
    const chunks: Uint8Array[] = [];
    assert.equal((await sdk.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original")] },
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } }, exportType: "fixture" },
      { signal: new AbortController().signal })).exitCode, 0);
    assert.equal(command.stdout, new TextDecoder().decode(chunks[0]));
    assert.equal(resolutions.length, 2);
    assert.deepEqual(resolutions[0], resolutions[1]);
    assert.deepEqual(volume.toJSON(), { "/input": "original" });
  } finally { await sdk.dispose(); await shell.dispose(); }
});

test("ssconvert formula syntax shares unary/power/omission behavior with the SDK", async () => {
  const volume = Volume.fromJSON({ "/input": "original", "/keep": "keep" });
  const codec: Codec = { id: "fixture", description: "Original formula grammar fixture", extensions: ["fixture"],
    probeContent: () => true, async read() { return { sheets: [{ id: "s", name: "Sheet", cells: [] }] }; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, outputBytes: 2000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), sdk = createEngine(binding);
  try {
    const expressions = ["B2==-2^2+2^3^2", "C2==SUM(,B2,)"];
    const result = await shell.exec("ssconvert --set='B2==-2^2+2^3^2' --set='C2==SUM(,B2,)' -T fixture /input fd://1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output: Uint8Array[] = [];
    await sdk.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original")] },
      destination: { kind: "stream", sink: { async write(bytes) { output.push(new Uint8Array(bytes)); } } },
      exportType: "fixture", updateExpressions: expressions }, { signal: new AbortController().signal });
    assert.equal(result.stdout, new TextDecoder().decode(output[0]));
    const book = JSON.parse(result.stdout) as Workbook;
    assert.deepEqual(book.sheets[0]!.cells.map(cell => cell.cachedResult), [{ kind: "number", value: 516 }, { kind: "number", value: 516 }]);
    assert.deepEqual(volume.toJSON(), { "/input": "original", "/keep": "keep" });
  } finally { await sdk.dispose(); await shell.dispose(); }
});

test("ssconvert resize rewrites formulas through CLI and SDK while retaining manual caches", async () => {
  const volume = Volume.fromJSON({ "/input": "original" });
  const cache = { kind: "number" as const, value: 7 };
  const codec: Codec = { id: "fixture", description: "Original resize grammar fixture", extensions: ["fixture"],
    probeContent: () => true, async read(): Promise<Workbook> { return { calculationMode: "manual", sheets: [{ id: "s", name: "Sheet",
      size: { rows: 256, columns: 256 }, cells: [{ row: 0, column: 0, value: cache, cachedResult: cache, formula: "=Future(A120:A140,A140)" }] }] }; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, outputBytes: 2000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), sdk = createEngine(binding);
  try {
    const result = await shell.exec("ssconvert --resize=128x128 -T fixture /input fd://1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output: Uint8Array[] = [];
    await sdk.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original")] },
      destination: { kind: "stream", sink: { async write(bytes) { output.push(new Uint8Array(bytes)); } } },
      exportType: "fixture", resize: { rows: 128, columns: 128 } }, { signal: new AbortController().signal });
    assert.equal(result.stdout, new TextDecoder().decode(output[0]));
    assert.deepEqual((JSON.parse(result.stdout) as Workbook).sheets[0]!.cells[0], {
      row: 0, column: 0, value: cache, cachedResult: cache, formula: "=Future(A120:A128,#REF!)", formulaDirty: true });
  } finally { await sdk.dispose(); await shell.dispose(); }
});

test("ssconvert ordered text updates share SDK calculation and first-error effects", async () => {
  const volume = Volume.fromJSON({ "/in": "fixture", "/keep.fixture": "keep" });
  const codec: Codec = { id: "fixture", description: "Original calculation fixture", extensions: ["fixture"],
    probeContent: () => true, async read() { return { sheets: [{ id: "s", name: "Sheet", cells: [
      { row: 0, column: 0, value: { kind: "number", value: 1 } },
      { row: 1, column: 0, formula: "=A1+1", value: { kind: "number", value: 2 }, cachedResult: { kind: "number", value: 2 } }
    ] }] }; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book.sheets[0]!.cells)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, outputBytes: 1000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const sdk = createEngine(binding);
  try {
    const result = await shell.exec("ssconvert --set A1=5 --set A1=8 --set 'A3==A2+1' -T fixture /in fd://1");
    assert.equal(result.exitCode, 0, result.stderr);
    const chunks: Uint8Array[] = [];
    await sdk.convert({ input: { kind: "stream", source: [new TextEncoder().encode("fixture")] },
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
      exportType: "fixture", updateExpressions: ["A1=5", "A1=8", "A3==A2+1"] }, { signal: new AbortController().signal });
    assert.equal(result.stdout, new TextDecoder().decode(chunks[0]));
    const cells = JSON.parse(result.stdout) as { value: unknown; cachedResult?: unknown }[];
    assert.deepEqual(cells.map(cell => cell.value), [
      { kind: "number", value: 8 }, { kind: "number", value: 9 }, { kind: "number", value: 10 }
    ]);
    const failed = await shell.exec("ssconvert --set A1=5 --set 'Named=8' --set broken -T fixture /in /keep.fixture");
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.stderr, "Failed to set cell Named=8\n");
    assert.equal(failed.stdout, "");
    assert.deepEqual(volume.toJSON(), { "/in": "fixture", "/keep.fixture": "keep" });
  } finally { await sdk.dispose(); await shell.dispose(); }
});

test("ssconvert virtual spans normalize on endpoint sheets before active-view updates", async () => {
  const volume = Volume.fromJSON({ "/in": "original", "/keep": "keep" });
  const updates: unknown[] = [];
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands({ ...options,
    cellText: { async setText(book, range, text) { updates.push({ range, text }); return book; } },
    codecs: [{ id: "fixture", description: "Original unequal span", extensions: ["fixture"],
      saveScope: "sheet", honorsExportRange: true, probeContent: () => true,
      async read(): Promise<Workbook> { return { activeSheet: "small", sheets: [
        { id: "large", name: "Large", cells: [], size: { rows: 256, columns: 256 } },
        { id: "small", name: "Small", cells: [], size: { rows: 128, columns: 128 } }
      ] }; },
      async write(book, _options, _context, selection) {
        const range = exportRangeForSheet(selection!.range!, book, selection!.sheets[0]!)!;
        return new TextEncoder().encode(`${range.sheet}:${range.startRow},${range.startColumn}:${range.endRow},${range.endColumn}\n`);
      }
    }]
  }));
  try {
    const result = await shell.exec("ssconvert -T fixture --set='Large:Small!DY129=span' --export-range='Large:Small!DY129' /in fd://1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "large:0,0:128,128\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(updates, [{ range: { sheet: "small", startRow: 0, startColumn: 0,
      endRow: 128, endColumn: 128 }, text: "span" }]);
    const invalid = await shell.exec("ssconvert -T fixture --export-range='Large:Small!DY129 trailing' /in /keep");
    assert.equal(invalid.exitCode, 1);
    assert.equal(invalid.stdout, "");
    assert.equal(invalid.stderr, "Invalid range specified.\n");
    assert.deepEqual(volume.toJSON(), { "/in": "original", "/keep": "keep" });
  } finally { await shell.dispose(); }
});

test("ssconvert shares qualified, axis and split-range selection with the SDK", async () => {
  const volume = Volume.fromJSON({ "/in": "original", "/keep": "keep" });
  const ranges: unknown[] = [];
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands({ ...options,
    limits: { ...options.limits, sheets: 3, operations: 30 },
    codecs: [
      { id: "input", description: "Original input", extensions: [], probeContent: () => true,
        async read(): Promise<Workbook> { return { activeSheet: "b", sheets: [
          { id: "a", name: "First", cells: [], size: { rows: 128, columns: 128 } },
          { id: "b", name: "A= B", cells: [], size: { rows: 128, columns: 128 } }
        ] }; } },
      { id: "Gnumeric_stf:stf_csv", description: "Original writer", extensions: [],
        async write(book, _options, _context, selection) {
          ranges.push(selection);
          const sheet = selection!.sheets[0]!;
          return new TextEncoder().encode(selection!.range && !exportRangeForSheet(selection!.range, book, sheet) ? "" : `${sheet}\n`);
        } }
    ]
  }));
  try {
    const qualified = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv -O sheet=First --export-range='\"A= B\"!$B:$C' /in fd://1");
    assert.equal(qualified.exitCode, 0);
    assert.equal(qualified.stdout, "b\n");
    assert.equal(qualified.stderr, "");
    assert.deepEqual(ranges, [{ sheets: ["b"], range: { sheet: "b", startRow: 0, endRow: 127, startColumn: 1, endColumn: 2 } }]);
    const split = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv -S -O 'sheet=First active-sheet=false sheet=First' --export-range=First!A1 /in /out-%n");
    assert.equal(split.exitCode, 0);
    assert.equal(split.stderr, "");
    assert.deepEqual(volume.toJSON(), { "/in": "original", "/keep": "keep", "/out-0": "a\n", "/out-1": "", "/out-2": "a\n" });
    const invalid = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv --export-range='A1:B2 trailing' /in /keep");
    assert.equal(invalid.exitCode, 1);
    assert.equal(invalid.stderr, "Invalid range specified.\n");
    assert.equal(invalid.stdout, "");
    assert.equal(volume.readFileSync("/keep", "utf8"), "keep");
  } finally { await shell.dispose(); }
});

test("ssconvert dispatches text handlers and ordered common options through the SDK engine", async () => {
  const volume = Volume.fromJSON({ "/in": "original", "/keep": "keep" });
  const selected: string[][] = [];
  const codec: Codec = {
    id: "Gnumeric_stf:stf_assistant", description: "Injected text exporter", extensions: [],
    async write(_book, values, _context, selection) {
      selected.push([...selection!.sheets]);
      return new TextEncoder().encode(values.join("\n"));
    }
  };
  const configuration = { ...options, codecs: [
    { id: "input", description: "Original input", extensions: [], probeContent: () => true,
      async read(): Promise<Workbook> { return { activeSheet: "b", sheets: [
        { id: "a", name: "First", cells: [] }, { id: "b", name: "Last", cells: [] }
      ] }; } }, codec
  ] };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(configuration));
  try {
    const pairs = "separator='|'sheet=Last sheet=First active-sheet=ignored separator=','";
    const result = await shell.exec(`ssconvert -T Gnumeric_stf:stf_assistant -O "${pairs}" /in fd://1`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, pairs);
    assert.deepEqual(selected, [["b", "a", "b"]]);
    const invalid = await shell.exec("ssconvert -T Gnumeric_stf:stf_assistant -O 'eol=wrong broken' /in /keep");
    assert.equal(invalid.exitCode, 1);
    assert.equal(invalid.stderr, "ssconvert: eol must be one of unix, mac, and windows\n");
    assert.equal(invalid.stdout, "");
    assert.deepEqual(volume.toJSON(), { "/in": "original", "/keep": "keep" });
  } finally { await shell.dispose(); }
});

test("ssconvert graph dispatch uses image IDs and C numeric resolution through injected rendering", async () => {
  const volume = Volume.fromJSON({ "/in.fixture": "original" });
  const resolutions: number[] = [];
  const formats: (string | undefined)[] = [];
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands({ ...options,
    rendering: { async *exportGraphs(_book, graph) {
      resolutions.push(graph.resolution!);
      formats.push(graph.format);
      yield* [];
    } }
  }));
  try {
    for (const value of [undefined, "0x1p2tail", "10000", "1"] as const) {
      const result = await shell.exec(`ssconvert --export-graphs -T png ${value === undefined ? "" : `-O resolution=${value}`} /in.fixture /graph.png`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
    }
    assert.deepEqual(resolutions, [100, 4, 10000, 1]);
    assert.deepEqual(formats, ["png", "png", "png", "png"]);
    const result = await shell.exec("ssconvert --export-graphs -T png -O resolution=10001 /in.fixture /graph.png");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'ssconvert: Invalid export option "resolution=10001" for image export\n');
    assert.deepEqual(volume.toJSON(), { "/in.fixture": "original" });
  } finally { await shell.dispose(); }
});

test("ssconvert uses file URI bytes, literal dash and explicit stdin including empty input", async () => {
  const volume = Volume.fromJSON({ "/work/a #.fixture": "file", "/work/-": "literal" });
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands(options));
  for (const command of basicCommands()) shell.register(command);
  try {
    const file = await shell.exec("ssconvert -T fixture 'file:///work/a%20%23.fixture' fd://1");
    assert.equal(file.exitCode, 0);
    assert.equal(file.stdout, "file:");
    const dash = await shell.exec("ssconvert -T fixture ./- fd://1");
    assert.equal(dash.stdout, "literal:");
    const piped = await shell.exec("printf stream | ssconvert -T fixture fd://0 fd://1");
    assert.equal(piped.exitCode, 0);
    assert.equal(piped.stdout, "stream:");
    const empty = await shell.exec("ssconvert -T fixture fd://0 fd://1");
    assert.equal(empty.exitCode, 0);
    assert.equal(empty.stdout, ":");
    assert.deepEqual(volume.toJSON(), { "/work/a #.fixture": "file", "/work/-": "literal" });
  } finally { await shell.dispose(); }
});

test("ssconvert reads and publishes binary bytes across mounted VFS paths", async () => {
  const source = Volume.fromJSON({ "/in.fixture": "original" });
  const target = new Volume();
  const fs = createMountFileSystem({ root: new MemoryFileSystem(), mounts: {
    "/source": filesystem(source), "/target": filesystem(target)
  } });
  const shell = new Shell({ fs, cwd: "/source" }).use(ssconvertCommands({ ...options,
    codecs: [{ ...options.codecs[0]!, async write() { return new Uint8Array([0, 255, 128]); } }]
  }));
  try {
    const result = await shell.exec("ssconvert -T fixture file:///source/in.fixture ../target/out.fixture");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(target.readFileSync("/out.fixture"), Buffer.from([0, 255, 128]));
    assert.deepEqual(source.toJSON(), { "/in.fixture": "original" });
  } finally { await shell.dispose(); }
});

test("ssconvert inherited terminals share SDK parsing without virtual file effects", async () => {
  const volume = Volume.fromJSON({ "/work/keep": "original" });
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" })
    .use(ssconvertCommands(options));
  try {
    const { parseCommand } = await import("poe-code/ssconvert");
    for (const args of [["--help"], ["--help-all"], ["--help-gtk"],
      ["--help-libspreadsheet"], ["-L", "/other", "--version"],
      ["--libspreadsheet-version"], ["--gtk-display=:999", "--version"],
      ["--gtk-module=missing", "--version"], ["--screen=0"], ["--usage"]]) {
      const expected = parseCommand(args);
      assert.equal(expected.kind, "terminal");
      if (expected.kind !== "terminal") throw Error("terminal expected");
      const actual = await shell.exec(`ssconvert ${args.join(" ")}`);
      assert.equal(actual.exitCode, expected.exitCode);
      assert.equal(actual.stdout, expected.stdout);
      assert.equal(actual.stderr, expected.stderr);
      assert.deepEqual(volume.toJSON(), { "/work/keep": "original" });
    }
  } finally { await shell.dispose(); }
});

test("ssconvert abbreviated inherited aliases preserve native channels and namespace", async () => {
  const volume = Volume.fromJSON({ "/work/keep": "original" });
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" })
    .use(ssconvertCommands(options));
  try {
    const version = await shell.exec("ssconvert --l-version");
    assert.equal(version.exitCode, 0);
    assert.equal(version.stdout, "gnumeric version '1.12.61'\ndatadir := '/opt/ssconvert-reference/share/gnumeric/1.12.61'\nlibdir := '/opt/ssconvert-reference/lib/gnumeric/1.12.61'\n");
    assert.equal(version.stderr, "");
    const missing = await shell.exec("ssconvert --gt-name");
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stdout, "");
    assert.equal(missing.stderr, "Missing argument for --name\nRun 'ssconvert --help' to see a full list of available command line options.\n");
    assert.deepEqual(volume.toJSON(), { "/work/keep": "original" });
  } finally { await shell.dispose(); }
});

test("ssconvert binds owned virtual configuration roots at registration", async () => {
  const roots = { dataDir: "/bound/data", libDir: "/bound/lib" };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(ssconvertCommands({
    ...options, profile: { configurationRoots: roots }
  }));
  roots.dataDir = "/mutated";
  try {
    const result = await shell.exec("ssconvert --version");
    assert.equal(result.stdout, "ssconvert version '1.12.61'\ndatadir := '/bound/data'\nlibdir := '/bound/lib'\n");
  } finally { await shell.dispose(); }
});

test("ssconvert virtual invocation discovers content, resolves competing savers and honors forced IDs", async () => {
  const volume = Volume.fromJSON({ "/work/misleading.xlsx": "ODF", "/work/output.xlsx": "keep" });
  const imported: string[] = [];
  const codec = (id: string, content: string, direction: "read" | "write"): Codec => ({
    id, description: "Original fixture", extensions: [],
    ...(direction === "read" ? {
      probeContent: (bytes: Uint8Array) => new TextDecoder().decode(bytes) === content,
      async read() { imported.push(id); return { sheets: [{ id: "s", name: "s", cells: [] }] }; }
    } : { async write() { return new TextEncoder().encode(id); } })
  });
  const codecs = [
    codec("Gnumeric_Excel:xlsx", "XLSX", "read"),
    codec("Gnumeric_OpenCalc:openoffice", "ODF", "read"),
    codec("Gnumeric_Excel:xlsx", "", "write"),
    codec("Gnumeric_Excel:xlsx2", "", "write"),
    codec("Gnumeric_OpenCalc:openoffice", "", "write")
  ];
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands({ ...options, codecs }));
  try {
    const discovered = await shell.exec("ssconvert misleading.xlsx output.xlsx");
    assert.equal(discovered.exitCode, 0, discovered.stderr);
    assert.deepEqual(imported, ["Gnumeric_OpenCalc:openoffice"]);
    assert.equal(volume.readFileSync("/work/output.xlsx", "utf8"), "Gnumeric_Excel:xlsx2");
    const forced = await shell.exec("ssconvert -I Gnumeric_Excel:xlsx -T Gnumeric_OpenCalc:openoffice misleading.xlsx output.xlsx");
    assert.equal(forced.exitCode, 0, forced.stderr);
    assert.deepEqual(imported, ["Gnumeric_OpenCalc:openoffice", "Gnumeric_Excel:xlsx"]);
    assert.equal(volume.readFileSync("/work/output.xlsx", "utf8"), "Gnumeric_OpenCalc:openoffice");
    const listing = await shell.exec("ssconvert --list-importers");
    assert.equal(listing.exitCode, 0);
    assert.equal(listing.stdout, "");
    assert.equal(listing.stderr,
      "ID                           | Description\n" +
      "Gnumeric_Excel:excel         | MS Excel? (*.xls)\n" +
      "Gnumeric_Excel:excel_enc     | MS Excel? (*.xls) requiring encoding specification\n" +
      "Gnumeric_Excel:excel_xml     | MS Excel? 2003 SpreadsheetML\n" +
      "Gnumeric_Excel:xlsx          | ECMA 376 / Office Open XML [MS Excel? 2007/2010] (*.xlsx)\n" +
    "Gnumeric_OpenCalc:openoffice | Open Document Format (*.sxc, *.ods)\n" +
    "Gnumeric_QPro:qpro           | Quattro Pro (*.wb1, *.wb2, *.wb3)\nGnumeric_XmlIO:sax           | Gnumeric XML (*.gnumeric)\n" +
    "Gnumeric_applix:applix       | Applix (*.as)\n" +
    "Gnumeric_dif:dif             | Data Interchange Format (*.dif)\n" +
    "Gnumeric_html:html           | HTML (*.html, *.htm)\n" +
    "Gnumeric_lotus:lotus         | Lotus 123 (*.wk1, *.wks, *.123)\nGnumeric_mps:mps             | Linear and integer program (*.mps) file format\nGnumeric_oleo:oleo           | GNU Oleo (*.oleo)\nGnumeric_paradox:paradox     | Paradox database or primary index file (*.db, *.px)\nGnumeric_plan_perfect:pln    | Plan Perfect Format (PLN) import\nGnumeric_psiconv:psiconv     | Psion (*.psisheet)\n" +
    "Gnumeric_sc:sc               | SC/xspread\n" +
    "Gnumeric_stf:stf_csvtab      | Comma or tab separated values (CSV/TSV)\n" +
    "Gnumeric_sylk:sylk           | MultiPlan (SYLK)\nGnumeric_xbase:xbase         | Xbase (*.dbf) file format\n");
    const rejected = await shell.exec("ssconvert misleading.xlsx output.XLSX");
    assert.equal(rejected.exitCode, 2);
    assert.equal(rejected.stderr, "Unable to guess exporter to use for 'file:///work/output.XLSX'.\nTry --list-exporters to see a list of possibilities.\n");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/work/misleading.xlsx", "/work/output.xlsx"]);
  } finally { await shell.dispose(); }
});
test("ssconvert uses main GOption byte grammar before any namespace changes", async () => {
  const volume = Volume.fromJSON({ "/work/input.fixture": "original" });
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands({
    ...options, profile: { help: "help\n", version: "version\n" }
  }));
  try {
    const version = await shell.exec("ssconvert $'\\xff' --version=1");
    assert.equal(version.exitCode, 0);
    assert.equal(version.stdout, "version\n");
    assert.equal(version.stderr, "");
    const unknown = await shell.exec("ssconvert --version --unknown");
    assert.equal(unknown.exitCode, 1);
    assert.equal(unknown.stderr, "Unknown option --unknown\nRun 'ssconvert --help' to see a full list of available command line options.\n");
    const conflict = await shell.exec("ssconvert -S --merge-to= --list-exporters");
    assert.equal(conflict.exitCode, 1);
    assert.equal(conflict.stderr, "--export-file-per-sheet and --merge-to are incompatible\n");
    assert.deepEqual(volume.toJSON(), { "/work/input.fixture": "original" });
    const conversion = await shell.exec("ssconvert input.fixture -T fixture -O first --export-options=last");
    assert.equal(conversion.exitCode, 0, conversion.stderr);
    assert.equal(volume.readFileSync("/work/input.fixture", "utf8"), "original:last");
  } finally { await shell.dispose(); }
});
test("ssconvert split local URI templates share canonical artifacts and namespace with the SDK", async () => {
  const volume = Volume.fromJSON({ "/input.fixture": "original", "/keep": "untouched" });
  const binding = { ...options, codecs: [{ ...options.codecs[0]!, saveScope: "sheet" as const }] };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const engine = createEngine({ ...binding, filesystem: createResourceIO({ cwd: "/", filesystem: {
    async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
    async write(path, bytes) { volume.writeFileSync(path, bytes); }
  } }) });
  try {
    const command = await shell.exec("ssconvert -S -T fixture /input.fixture file://localhost/missing/../out-%n.fixture");
    assert.equal(command.exitCode, 0);
    assert.equal(command.stdout, ""); assert.equal(command.stderr, "");
    assert.deepEqual(command.stdoutBytes, new Uint8Array());
    assert.deepEqual(command.stderrBytes, new Uint8Array());
    const commandBytes = new Uint8Array(volume.readFileSync("/out-0.fixture") as Uint8Array);
    const result = await engine.convert({ input: { kind: "resource", uri: "/input.fixture" },
      destination: { kind: "resource", uri: "file://localhost/missing/../out-%n.fixture" },
      perSheet: true, exportType: "fixture" }, { signal: new AbortController().signal });
    assert.equal(result.exitCode, 0);
    assert.equal(result.artifacts[0]?.uri, "file:///out-0.fixture");
    assert.deepEqual(new Uint8Array(volume.readFileSync("/out-0.fixture") as Uint8Array), commandBytes);
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/input.fixture", "/keep", "/out-0.fixture"]);
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert native graph templates use the shared engine through the virtual command", async () => {
  const volume = Volume.fromJSON({ "/input.fixture": "original", "/keep": "untouched" });
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands({ ...options,
    rendering: { async *exportGraphs() {
      yield { uri: "/wrong", sheet: "s", objectName: "図 #%", bytes: new Uint8Array([65]), mediaType: "image/svg+xml" };
      yield { uri: "/wrong", sheet: "s", objectName: "Other", bytes: new Uint8Array([66]), mediaType: "image/svg+xml" };
    } }
  }));
  try {
    const result = await shell.exec("ssconvert --export-graphs /input.fixture '/%n-%s-%o.svg'");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, ""); assert.equal(result.stdout, "");
    assert.deepEqual(volume.toJSON(), { "/input.fixture": "original", "/keep": "untouched",
      "/0-Sheet-図 #%.svg": "A", "/1-Sheet-Other.svg": "B" });
  } finally { await shell.dispose(); }
});

function filesystem(volume: Volume) {
  const base = new MemoryFileSystem();
  return new Proxy(base, {
    get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
      if (key === "lstat" || key === "stat")
        return async (path: string) => {
          try {
            const stat = key === "lstat" ? volume.lstatSync(path) : volume.statSync(path);
            return { type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", size: Number(stat.size),
              mode: Number(stat.mode), mtimeMs: stat.mtimeMs, atimeMs: stat.atimeMs, ctimeMs: stat.ctimeMs };
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && isErrnoCode(error.code))
              throw new FsError(error.code, { path });
            throw error;
          }
        };
      if (key === "readFile")
        return async (path: string, supplied?: { signal?: AbortSignal }) => {
          supplied?.signal?.throwIfAborted();
          return new Uint8Array(volume.readFileSync(path) as Uint8Array);
        };
      if (key === "writeFile")
        return async (path: string, bytes: Uint8Array, supplied?: { signal?: AbortSignal; flag?: "w" | "wx"; mode?: number }) => {
          supplied?.signal?.throwIfAborted();
          volume.writeFileSync(path, bytes, supplied);
        };
      if (key === "rename") return async (source: string, destination: string) => { volume.renameSync(source, destination); };
      if (key === "unlink") return async (path: string) => { volume.unlinkSync(path); };
      if (key === "readlink") return async (path: string) => String(volume.readlinkSync(path));
      if (key === "chmod") return async (path: string, mode: number) => { volume.chmodSync(path, mode); };
      if (key === "access") return async (path: string, mode?: number) => { volume.accessSync(path, mode); };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
test("ssconvert opt-in command uses shell VFS and shared domain exporter", async () => {
  const volume = Volume.fromJSON({ "/work/a b.fixture": "original" });
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" });
  try {
    assert.equal(shell.commands.has("ssconvert"), false);
    shell.use(ssconvertCommands(options));
    const result = await shell.exec("ssconvert -O first -O last 'a b.fixture' output.fixture");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(volume.readFileSync("/work/output.fixture", "utf8"), "original:last");
    assert.throws(() => ssconvertCommands(options).setup(shell), /already registered/);
  } finally {
    await shell.dispose();
  }
});
test("ssconvert forwards exactly the invocation exports without configured leaks or PWD injection", async () => {
  const volume = Volume.fromJSON({ "/input.fixture": "original" });
  const observed: Readonly<Record<string, string>>[] = [];
  const codec: Codec = {
    ...options.codecs[0]!,
    async read(bytes, context) {
      observed.push(context.environment.env);
      return options.codecs[0]!.read(bytes);
    }
  };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands({
    ...options, codecs: [codec], environment: { ...options.environment, env: { CONFIGURED: "private" } }
  }));
  shell.commands.register({ name: "exact-env", async execute(context) {
    return context.invoke!("ssconvert", ["/input.fixture", "/output.fixture"], {
      replaceEnv: true, env: { EXPORTED: "value" }
    });
  } });
  try {
    const result = await shell.exec("exact-env");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(observed, [{ EXPORTED: "value" }]);
    assert.equal(volume.readFileSync("/output.fixture", "utf8"), "original:");
  } finally { await shell.dispose(); }
});

test("ssconvert admits eager VFS reads against the shell input budget", async () => {
  let admitted: number | undefined;
  const base = new MemoryFileSystem();
  const fs = new Proxy(base, {
    get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
      if (key === "readFile")
        return async (_path: string, supplied: { maxBytes: number }) => {
          admitted = supplied.maxBytes;
          return new TextEncoder().encode("a");
        };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const result = await createSsconvertCommand(options).execute({
    command: "ssconvert",
    args: ["input.fixture", "output.fixture"],
    fs,
    cwd: "/",
    env: {},
    signal: new AbortController().signal,
    stdin: {
      async *[Symbol.asyncIterator]() {
        yield* [];
      }
    },
    stdout: { async write() {} },
    stderr: { async write() {} },
    inputBudget: { maxBytes: 2, check() {} }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(admitted, 2);
});
test("ssconvert releases invocation ownership when engine construction rejects limits", async () => {
  const signal = new AbortController().signal;
  const add = signal.addEventListener.bind(signal),
    remove = signal.removeEventListener.bind(signal);
  const listeners = new Set<Parameters<typeof signal.addEventListener>[1]>();
  signal.addEventListener = (...[type, listener, supplied]: Parameters<typeof add>) => {
    if (type === "abort" && listener) listeners.add(listener);
    add(type, listener, supplied);
  };
  signal.removeEventListener = (...[type, listener, supplied]: Parameters<typeof remove>) => {
    if (type === "abort" && listener) listeners.delete(listener);
    remove(type, listener, supplied);
  };
  await assert.rejects(
    async () =>
      createSsconvertCommand({ ...options, limits: { ...options.limits, inputBytes: -1 } }).execute(
        {
          command: "ssconvert",
          args: [],
          fs: new MemoryFileSystem(),
          cwd: "/",
          env: {},
          signal,
          stdin: {
            async *[Symbol.asyncIterator]() {
              yield* [];
            }
          },
          stdout: { async write() {} },
          stderr: { async write() {} }
        }
      ),
    /Invalid ssconvert limit/
  );
  assert.equal(listeners.size, 0);
});
test("ssconvert solver validation shares SDK diagnostics and preserves replay namespace", async () => {
  const volume = Volume.fromJSON({ "/work/input.fixture": "original", "/work/keep": "keep" });
  const codec: Codec = { ...options.codecs[0]!,
    async read(bytes) { const text = new TextDecoder().decode(bytes); return text === "original" ? { sheets: [{ id: "s", name: "Sheet", cells: [] }] } : JSON.parse(text) as Workbook; },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, inputBytes: 10000, outputBytes: 10000 } };
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands(binding));
  const engine = createEngine(binding);
  try {
    const command = await shell.exec("ssconvert --solve input.fixture output.fixture");
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", filename: "input.fixture", source: [new TextEncoder().encode("original")] }, solve: true,
      exportType: "fixture", destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
    assert.equal(command.exitCode, 0, command.stderr);
    assert.equal(command.stderr, "Solver: Invalid solver target\n");
    assert.equal(sdk.exitCode, command.exitCode);
    assert.equal(sdk.diagnostics.map(d => d.message + "\n").join(""), command.stderr);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/output.fixture") as Uint8Array), chunks[0]);
    const replay = await shell.exec("ssconvert --solve output.fixture replay.fixture");
    assert.equal(replay.exitCode, 0); assert.equal(replay.stderr, command.stderr);
    assert.deepEqual(volume.readFileSync("/work/replay.fixture"), volume.readFileSync("/work/output.fixture"));
    assert.equal(volume.readFileSync("/work/input.fixture", "utf8"), "original");
    assert.equal(volume.readFileSync("/work/keep", "utf8"), "keep");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/work/input.fixture", "/work/keep", "/work/output.fixture", "/work/replay.fixture"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});
test("ssconvert SDK and virtual command preserve the same sparse workbook records", async () => {
  const book: Workbook = {
    sheets: [
      {
        id: "s",
        name: "表 🧪",
        visibility: "very-hidden",
        cells: [
          { row: 0, column: 0, value: { kind: "blank" }, style: { fill: "red" } },
          { row: 0, column: 1, value: { kind: "string", value: "" } },
          {
            row: 1,
            column: 0,
            value: { kind: "number", value: 60 },
            formula: "59+1",
            cachedResult: { kind: "number", value: 60 }
          }
        ],
        rows: [{ index: 3, hidden: true }]
      }
    ],
    activeSheet: "s",
    dateSystem: "1900",
    calculationMode: "manual",
    names: [
      { name: "Δ", expression: "1" },
      { name: "Δ", sheet: "s", expression: "2" }
    ],
    properties: { title: "original" }
  };
  const volume = Volume.fromJSON({ "/work/input.fixture": JSON.stringify(book) });
  const codec: Codec = {
    id: "fixture",
    description: "Original in-memory workbook fixture",
    extensions: ["fixture"],
    probeContent: () => true,
    async read(bytes) {
      return JSON.parse(new TextDecoder().decode(bytes)) as Workbook;
    },
    async write(value) {
      return new TextEncoder().encode(JSON.stringify(value));
    }
  };
  const binding = {
    ...options,
    codecs: [codec],
    limits: { ...options.limits, inputBytes: 4096, outputBytes: 4096 }
  };
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands(binding));
  const engine = createEngine({
    ...binding,
    filesystem: {
      async read(uri) {
        return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)];
      },
      async write(uri, bytes) {
        volume.writeFileSync(uri, bytes);
      }
    }
  });
  try {
    const cli = await shell.exec("ssconvert input.fixture cli.fixture");
    const sdk = await engine.convert(
      {
        input: { kind: "resource", uri: "/work/input.fixture" },
        destination: { kind: "resource", uri: "/work/sdk.fixture" }
      },
      { signal: new AbortController().signal }
    );
    assert.equal(cli.exitCode, sdk.exitCode);
    assert.equal(cli.stdout, "");
    assert.equal(cli.stderr, "");
    assert.equal(
      volume.readFileSync("/work/cli.fixture", "utf8"),
      volume.readFileSync("/work/sdk.fixture", "utf8")
    );
    assert.deepEqual(JSON.parse(volume.readFileSync("/work/cli.fixture", "utf8") as string), book);
  } finally {
    await engine.dispose();
    await shell.dispose();
  }
});
test("ssconvert conflicting workbook names fail before destination namespace effects", async () => {
  const volume = Volume.fromJSON({
    "/work/input.fixture": "fixture",
    "/work/output.fixture": "untouched"
  });
  const codec: Codec = {
    id: "fixture",
    description: "Conflicting original fixture",
    extensions: ["fixture"],
    probeContent: () => true,
    async read() {
      return {
        sheets: [{ id: "s", name: "Sheet", cells: [] }],
        names: [
          { name: "n", expression: "1" },
          { name: "n", expression: "2" }
        ]
      };
    },
    async write() {
      throw new Error("Writer must not run");
    }
  };
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(
    ssconvertCommands({ ...options, codecs: [codec] })
  );
  try {
    const result = await shell.exec("ssconvert input.fixture output.fixture");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Conflicting named expression\n");
    assert.equal(volume.readFileSync("/work/output.fixture", "utf8"), "untouched");
  } finally {
    await shell.dispose();
  }
});

test("ssconvert hidden codec accessor denial matches SDK and preserves destination", async () => {
  let getterCalls = 0, writerCalls = 0;
  const codec: Codec = {
    id: "fixture",
    description: "Original hidden accessor negative control",
    extensions: ["fixture"],
    probeContent: () => true,
    async read() {
      return {
        sheets: [{ id: "s", name: "Sheet", cells: [] }],
        properties: Object.defineProperty({}, "secret", {
          get() {
            getterCalls++;
            return "borrowed";
          }
        })
      };
    },
    async write() {
      writerCalls++;
      return new Uint8Array();
    }
  };
  const binding = { ...options, codecs: [codec] };
  const volume = Volume.fromJSON({ "/work/input.fixture": "fixture", "/work/output.fixture": "keep" });
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands(binding));
  const engine = createEngine(binding);
  try {
    const cli = await shell.exec("ssconvert input.fixture output.fixture");
    assert.equal(cli.exitCode, 1);
    assert.equal(cli.stdout, "");
    assert.equal(cli.stderr, "Unsupported workbook accessor\n");
    await assert.rejects(engine.readWorkbook(
      { kind: "stream", source: [new TextEncoder().encode("fixture")], filename: "input.fixture" },
      {}, { signal: new AbortController().signal }
    ), { code: "invalid-request", message: "Unsupported workbook accessor", exitCode: 1 });
    assert.equal(getterCalls, 0);
    assert.equal(writerCalls, 0);
    assert.equal(volume.readFileSync("/work/output.fixture", "utf8"), "keep");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/work/input.fixture", "/work/output.fixture"]);
  } finally {
    await engine.dispose();
    await shell.dispose();
  }
});

test("ssconvert virtual fd stdout preserves data bytes and warnings without VFS effects", async () => {
  const volume = Volume.fromJSON({ "/work/input.fixture": "original" });
  const payloads = [new TextEncoder().encode('"original,value",2\n'), new Uint8Array([0, 255, 128, 10])];
  for (const payload of payloads) {
    const codec: Codec = { ...options.codecs[0]!,
      async read(bytes, context) {
        await context.diagnostic?.({ code: "original", severity: "warning", message: "Original warning" });
        return { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0,
          value: { kind: "string", value: new TextDecoder().decode(bytes) } }] }] };
      },
      async write() { return new Uint8Array(payload); }
    };
    const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands({ ...options, codecs: [codec] }));
    try {
      const converted = await shell.exec("ssconvert -v -T fixture input.fixture fd://1");
      assert.equal(converted.exitCode, 0, converted.stderr);
      assert.deepEqual(converted.stdoutBytes, payload);
      assert.equal(converted.stderr, "Original warning\n");
      assert.deepEqual(volume.toJSON(), { "/work/input.fixture": "original" });
    } finally { await shell.dispose(); }
  }
});

test("ssconvert virtual image enum listing and invalid expressions use stderr", async () => {
  const volume = Volume.fromJSON({ "/work/input.fixture": "original" });
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands(options));
  try {
    const listing = await shell.exec("ssconvert --list-image-formats");
    assert.equal(listing.exitCode, 0);
    assert.equal(listing.stdout, "");
    assert.equal(listing.stderr, "ID   | Description\nsvg  | SVG (vector graphics)\npng  | PNG (raster graphics)\njpeg | JPEG (photograph)\npdf  | PDF (portable document format)\nps   | PS (postscript)\nemf  | EMF (extended metafile)\nwmf  | WMF (windows metafile)\neps  | EPS (encapsulated postscript)\n");
    for (const [argument, diagnostic] of [
      ["--set=bad", "Failed to set cell bad\n"], ["--export-range=bad", "Invalid range specified.\n"],
      ["--goal-seek=bad", "Invalid range specified.\n"]
    ]) {
      const result = await shell.exec(`ssconvert ${argument} input.fixture output.fixture`);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, diagnostic);
      assert.deepEqual(volume.toJSON(), { "/work/input.fixture": "original" });
    }
  } finally { await shell.dispose(); }
});

test("ssconvert actual virtual merge preserves notices and native duplicate names", async () => {
  const volume = Volume.fromJSON({ "/work/one.fixture": "first", "/work/two.fixture": "second" });
  const codec: Codec = { ...options.codecs[0]!, async write(book) {
    return new TextEncoder().encode(book.sheets.map(sheet => sheet.name).join(","));
  } };
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands({ ...options, codecs: [codec] }));
  try {
    const result = await shell.exec("ssconvert -M output.fixture one.fixture two.fixture");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Adding sheets from file:///work/one.fixture\nAdding sheets from file:///work/two.fixture\n");
    assert.equal(volume.readFileSync("/work/output.fixture", "utf8"), "Sheet,Sheet(2)");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/work/one.fixture", "/work/output.fixture", "/work/two.fixture"]);
  } finally { await shell.dispose(); }
});

test("ssconvert native publication breaks hardlinks and preserves terminal symlinks and mode", async () => {
  for (const alias of ["hardlink", "symlink", "same"] as const) {
    const volume = Volume.fromJSON({ "/work/input.fixture": "original" });
    volume.chmodSync("/work/input.fixture", 0o640);
    if (alias === "hardlink") volume.linkSync("/work/input.fixture", "/work/output.fixture");
    if (alias === "symlink") volume.symlinkSync("input.fixture", "/work/output.fixture");
    const before = volume.statSync("/work/input.fixture").ino;
    const output = alias === "same" ? "input.fixture" : "output.fixture";
    const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands(options));
    try {
      const result = await shell.exec(`ssconvert -O changed input.fixture ${output}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(volume.readFileSync(`/work/${output}`, "utf8"), "original:changed");
      assert.equal(Number(volume.statSync(`/work/${output}`).mode) & 0o777, 0o640);
      assert.notEqual(volume.statSync(`/work/${output}`).ino, before);
      if (alias === "hardlink") assert.equal(volume.readFileSync("/work/input.fixture", "utf8"), "original");
      if (alias === "symlink") assert.equal(volume.lstatSync("/work/output.fixture").isSymbolicLink(), true);
      assert.deepEqual(volume.readdirSync("/work").sort(), alias === "same"
        ? ["input.fixture"] : ["input.fixture", "output.fixture"]);
    } finally { await shell.dispose(); }
  }
});

test("ssconvert loading diagnostics retain the resolved virtual filename", async () => {
  const volume = Volume.fromJSON({ "/work/keep": "original" });
  const shell = new Shell({ fs: filesystem(volume), cwd: "/work" }).use(ssconvertCommands(options));
  try {
    const result = await shell.exec("ssconvert missing.fixture output.fixture");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "E /work/missing.fixture: No such file or directory\n");
    assert.deepEqual(volume.toJSON(), { "/work/keep": "original" });
  } finally { await shell.dispose(); }
});

for (const dateSystem of ["1900", "1904"] as const) {
  test(`ssconvert shares date/finance/calendar clocks and ${dateSystem} metadata with SDK and replay`, async () => {
    const volume = Volume.fromJSON({ "/input": "date-finance-original", "/keep": "untouched" });
    const number = (value: number) => ({ kind: "number" as const, value });
    const formulas = ["=DATE(2024,1,1)", "=NOW()", "=PV(0,10,-100)", "=IRR({-100;110})", "=EASTERSUNDAY(2024)", "=HDATE_YEAR(2024,1,1)", '=OPT_BS("c",100,100,1,.05,.2,.05)', "=DAY(60)", "=WORKDAY(A1,1)", '=DATEVALUE("2/29/2024")', "=YEARFRAC(A1,DATE(2025,1,1),-.5)", "=DATE2HDATE()", "=DATE2HDATE_HEB()", "=DATE2JULIAN()"];
    const fixture: Workbook = { dateSystem, sheets: [{ id: "s", name: "Sheet", cells: formulas.map((formula, column) => ({ row: 0, column, formula, formulaDirty: true, value: number(99) })) }] };
    const codec: Codec = { id: "date-finance", description: "Original shared-engine date fixture", extensions: ["fixture"], probeContent: () => true,
      async read(bytes) { return new TextDecoder().decode(bytes) === "date-finance-original" ? fixture : JSON.parse(new TextDecoder().decode(bytes)) as Workbook; },
      async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
    const binding = { ...options, codecs: [codec], clock: { now: () => Date.UTC(2024, 0, 1, 12) },
      environment: { ...options.environment, timezone: "America/New_York" },
      limits: { ...options.limits, cells: 100, inputBytes: 10000, outputBytes: 10000, workbookWork: 100000 } };
    const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), sdk = createEngine(binding);
    try {
      const command = await shell.exec("ssconvert -T date-finance /input fd://1");
      assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, "");
      const chunks: Uint8Array[] = [];
      const destination = { kind: "stream" as const, sink: { async write(bytes: Uint8Array) { chunks.push(new Uint8Array(bytes)); } } };
      const result = await sdk.convert({ input: { kind: "stream", source: [new TextEncoder().encode("date-finance-original")] }, destination, exportType: "date-finance" }, { signal: new AbortController().signal });
      assert.equal(result.exitCode, 0); assert.deepEqual(result.diagnostics, []);
      assert.equal(new TextDecoder().decode(chunks.pop()), command.stdout);
      const book = JSON.parse(command.stdout) as Workbook, base = dateSystem === "1900" ? 45292 : 43830;
      assert.equal(book.dateSystem, dateSystem); assert.deepEqual(book.sheets[0]!.cells.map(c => c.formula), formulas);
      assert.deepEqual(book.sheets[0]!.cells[0]!.cachedResult, number(base));
      assert.deepEqual(book.sheets[0]!.cells[1]!.cachedResult, number(base + 7 / 24));
      assert.deepEqual(book.sheets[0]!.cells[2]!.cachedResult, number(1000));
      assert.deepEqual(book.sheets[0]!.cells[5]!.cachedResult, number(5784));
      assert.deepEqual(book.sheets[0]!.cells[9]!.cachedResult, number(base + 59));
      assert.deepEqual(book.sheets[0]!.cells[10]!.cachedResult, { kind: "error", value: "#NUM!" });
      assert.deepEqual(book.sheets[0]!.cells[11]!.cachedResult, { kind: "string", value: "20 Tebet 5784" });
      assert.deepEqual(book.sheets[0]!.cells[12]!.cachedResult, { kind: "string", value: "כ׳ בְּטֵבֵת התשפ״ד" });
      assert.deepEqual(book.sheets[0]!.cells[13]!.cachedResult, number(2460311));
      const replay = await sdk.convert({ input: { kind: "stream", source: [new TextEncoder().encode(command.stdout)] }, destination, exportType: "date-finance", updateExpressions: ["A1=9"] }, { signal: new AbortController().signal });
      assert.equal(replay.exitCode, 0); assert.deepEqual(replay.diagnostics, []);
      const updated = JSON.parse(new TextDecoder().decode(chunks.pop())) as Workbook;
      assert.equal(updated.dateSystem, dateSystem); assert.deepEqual(updated.sheets[0]!.cells[0]!.value, number(9));
      assert.deepEqual(updated.sheets[0]!.cells[8]!.cachedResult, number(10));
      assert.deepEqual(updated.sheets[0]!.cells[9]!.cachedResult, number(base + 59));
      assert.deepEqual(updated.sheets[0]!.cells[10]!.cachedResult, { kind: "error", value: "#NUM!" });
      assert.deepEqual(updated.sheets[0]!.cells[11]!.cachedResult, { kind: "string", value: "20 Tebet 5784" });
      assert.deepEqual(updated.sheets[0]!.cells[12]!.cachedResult, { kind: "string", value: "כ׳ בְּטֵבֵת התשפ״ד" });
      assert.deepEqual(updated.sheets[0]!.cells[13]!.cachedResult, number(2460311));
      assert.deepEqual(volume.toJSON(), { "/input": "date-finance-original", "/keep": "untouched" });
      assert.deepEqual(fixture.sheets[0]!.cells.map(c => c.value), Array.from({ length: formulas.length }, () => number(99)));
    } finally { await sdk.dispose(); await shell.dispose(); }
  });
}

test("both XLSX writer profiles share SDK bytes, virtual namespace effects and reopen replay", async () => {
  const volume = Volume.fromJSON({ "/input.csv": "label,=1+2\n", "/keep": "untouched" });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 1000000, outputBytes: 1000000,
    cells: 1000, workbookWork: 1000000 }, clock: { now: () => Date.UTC(2000, 0, 1) } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)); const engine = createEngine(binding);
  try {
    for (const profile of ["xlsx", "xlsx2"]) {
      const command = await shell.exec(`ssconvert --recalc -T Gnumeric_Excel:${profile} /input.csv /${profile}.xlsx`);
      assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ""); assert.equal(command.stdout, "");
      const output: Uint8Array[] = [];
      const sdk = await engine.convert({ input: { kind: "stream", filename: "input.csv", source: [new TextEncoder().encode("label,=1+2\n")] },
        recalc: true, exportType: `Gnumeric_Excel:${profile}`, destination: { kind: "stream", sink: { async write(bytes) { output.push(new Uint8Array(bytes)); } } } },
        { signal: new AbortController().signal });
      assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
      assert.deepEqual(new Uint8Array(volume.readFileSync(`/${profile}.xlsx`) as Uint8Array), output[0]);
      const replay = await shell.exec(`ssconvert -T Gnumeric_stf:stf_csv /${profile}.xlsx fd://1`);
      assert.equal(replay.exitCode, 0, replay.stderr); assert.equal(replay.stderr, ""); assert.equal(replay.stdout, "label,3\n");
      const unsupported = await shell.exec(`ssconvert -T Gnumeric_Excel:${profile} -O sheet=input.csv /input.csv /selected.xlsx`);
      assert.equal(unsupported.exitCode, 1); assert.equal(unsupported.stderr, `Selected exporter (Gnumeric_Excel:${profile}) does not have the ability to export a subset of sheets.\n`);
      assert.equal(volume.existsSync("/selected.xlsx"), false);
    }
    const defaults = await shell.exec("ssconvert --recalc /input.csv /default.xlsx");
    assert.equal(defaults.exitCode, 0, defaults.stderr);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/default.xlsx") as Uint8Array), new Uint8Array(volume.readFileSync("/xlsx2.xlsx") as Uint8Array));
    assert.equal(volume.readFileSync("/input.csv", "utf8"), "label,=1+2\n"); assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/default.xlsx", "/input.csv", "/keep", "/xlsx.xlsx", "/xlsx2.xlsx"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert HTML exporters share SDK bytes, default saver, range scope and replay namespace", async () => {
  const original = '<table><caption>First</caption><tr><td>2<td>=2+3</table><table><caption>Second</caption><tr><td>9</table>';
  const volume = Volume.fromJSON({ "/book.html": original, "/keep": "untouched" });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  try {
    for (const format of ["html32", "html40", "html40frag", "xhtml", "xhtml_range"]) {
      const command = await shell.exec(`ssconvert -T Gnumeric_html:${format} /book.html fd://1`);
      assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, "");
      const chunks: Uint8Array[] = [];
      const sdk = await engine.convert({ input: { kind: "stream", filename: "book.html", source: [new TextEncoder().encode(original)] }, exportType: `Gnumeric_html:${format}`,
        destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } } }, { signal: new AbortController().signal });
      assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
      assert.equal(chunks.map(bytes => new TextDecoder().decode(bytes)).join(""), command.stdout);
      assert.equal(command.stdout.includes("<caption>First</caption>"), format !== "xhtml_range");
      assert.equal(command.stdout.includes("<caption>Second</caption>"), format !== "xhtml_range");
      assert.ok(command.stdout.includes(">5</td>"));
    }
    const defaultSaver = await shell.exec("ssconvert /book.html /result.html");
    assert.equal(defaultSaver.exitCode, 0, defaultSaver.stderr);
    const xhtml = await shell.exec("ssconvert -T Gnumeric_html:xhtml /book.html fd://1");
    assert.equal(volume.readFileSync("/result.html", "utf8"), xhtml.stdout);
    const selected = await shell.exec("ssconvert -T Gnumeric_html:html40frag -O 'sheet=Second sheet=First sheet=Second' /book.html fd://1");
    assert.equal(selected.exitCode, 0, selected.stderr);
    assert.ok(selected.stdout.indexOf("<caption>Second") < selected.stdout.indexOf("<caption>First"));
    assert.equal(selected.stdout.split("<caption>Second</caption>").length, 3);
    const range = await shell.exec("ssconvert -T Gnumeric_html:xhtml_range --export-range=First!A1 /book.html fd://1");
    assert.equal(range.exitCode, 0, range.stderr); assert.ok(range.stdout.includes(">5</td>"));
    assert.equal(range.stdout.split("<table ").length, 2);
    const before = volume.toJSON();
    const rejected = await shell.exec("ssconvert -T Gnumeric_html:xhtml_range -S /book.html /part-%n.html");
    assert.equal(rejected.exitCode, 1); assert.equal(rejected.stdout, "");
    assert.equal(rejected.stderr, "Selected exporter (Gnumeric_html:xhtml_range) does not have the ability to split a workbook into sheets.\n");
    assert.deepEqual(volume.toJSON(), before);
    const replay = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /result.html fd://1");
    assert.equal(replay.exitCode, 0, replay.stderr);
    assert.equal(volume.readFileSync("/book.html", "utf8"), original);
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/book.html", "/keep", "/result.html"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test("ssconvert HTML output admission preserves destination bytes and namespace", async () => {
  const volume = Volume.fromJSON({ "/book.html": "<table><tr><td>7</table>", "/result.html": "previous", "/keep": "untouched" });
  const before = volume.toJSON();
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 20, workbookWork: 100000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  try {
    const result = await shell.exec("ssconvert -T Gnumeric_html:xhtml /book.html /result.html");
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
    assert.equal(result.stderr, "ssconvert HTML output bytes limit exceeded\n");
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("ssconvert repeated hidden goal seek shares command/SDK roots, reports and VFS effects", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula: "=B1*2", value: { kind: "number", value: 0 } },
    { row: 0, column: 1, value: { kind: "number", value: 1 } },
    { row: 0, column: 2, value: { kind: "number", value: 8 } },
    { row: 0, column: 5, formula: "=B1+G1", value: { kind: "number", value: 0 } },
    { row: 0, column: 6, value: { kind: "number", value: 1 } },
    { row: 0, column: 7, value: { kind: "number", value: 10 } },
    { row: 0, column: 10, formula: "=B1+G1", value: { kind: "number", value: 0 } }
  ] }] };
  const codec: Codec = { id: "goal", description: "Original linear roots", extensions: ["goal"],
    probeContent: () => true, async read() { return book; },
    async write(result) { return new TextEncoder().encode(JSON.stringify(result)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, cells: 30, inputBytes: 10000, outputBytes: 10000 } };
  const volume = Volume.fromJSON({ "/input.goal": "original", "/keep": "untouched" });
  const fs = filesystem(volume);
  const shell = new Shell({ fs, cwd: "/" }).use(ssconvertCommands(binding));
  const engine = createEngine({ ...binding, filesystem: { async read() { return [new Uint8Array([1])]; },
    async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  try {
    const cli = await shell.exec("ssconvert --goal-seek=A1:E1 --goal-seek=F1:J1 input.goal cli.goal");
    assert.equal(cli.exitCode, 0); assert.equal(cli.stderr, "");
    await engine.convert({ input: { kind: "resource", uri: "/input.goal" },
      destination: { kind: "resource", uri: "/sdk.goal" }, goalSeekExpressions: ["A1:E1", "F1:J1"] }, { signal: new AbortController().signal });
    assert.deepEqual(volume.readFileSync("/cli.goal"), volume.readFileSync("/sdk.goal"));
    const result = JSON.parse(volume.readFileSync("/cli.goal", "utf8") as string) as Workbook;
    assert.deepEqual(result.sheets[0]!.cells.find(c => c.column === 1)!.value, { kind: "number", value: 4 });
    assert.deepEqual(result.sheets[0]!.cells.find(c => c.column === 6)!.value, { kind: "number", value: 6.000000000000001 });
    assert.deepEqual(result.sheets[0]!.cells.find(c => c.column === 10)!.value, { kind: "number", value: 10 });
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/cli.goal", "/input.goal", "/keep", "/sdk.goal"]);
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.equal(book.sheets[0]!.cells[1]!.value.kind === "number" && book.sheets[0]!.cells[1]!.value.value, 1);
    const invalid = await shell.exec("ssconvert --goal-seek=bad input.goal invalid.goal");
    assert.equal(invalid.exitCode, 1);
    assert.equal(invalid.stderr, "Invalid range specified.\n");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/cli.goal", "/input.goal", "/keep", "/sdk.goal"]);
  } finally { engine.dispose(); await shell.dispose(); }
});

test("ssconvert goal seek preserves solved dependencies through XML checkpoint and replay", async () => {
  const source = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">Original</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>Original</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0">=B1*2</gnm:Cell><gnm:Cell Row="0" Col="1" ValueType="40">1</gnm:Cell><gnm:Cell Row="0" Col="2" ValueType="40">8</gnm:Cell><gnm:Cell Row="0" Col="5">=B1+G1</gnm:Cell><gnm:Cell Row="0" Col="6" ValueType="40">1</gnm:Cell><gnm:Cell Row="0" Col="7" ValueType="40">10</gnm:Cell><gnm:Cell Row="0" Col="10">=B1+G1</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const volume = Volume.fromJSON({ "/original.xml": source, "/keep": "untouched" });
  const shell = new Shell({ fs: filesystem(volume), cwd: "/" }).use(ssconvertCommands({ ...options, codecs: [],
    limits: { ...options.limits, cells: 100, inputBytes: 100000, outputBytes: 100000 } }));
  const goals = "--goal-seek=A1:E1 --goal-seek=F1:J1";
  try {
    for (const command of [
      `ssconvert ${goals} -T Gnumeric_XmlIO:sax:0 /original.xml /checkpoint.xml`,
      "ssconvert -T Gnumeric_stf:stf_csv /checkpoint.xml /original.csv",
      `ssconvert ${goals} -T Gnumeric_stf:stf_csv /checkpoint.xml /replay.csv`
    ]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
    }
    assert.deepEqual(volume.readFileSync("/replay.csv"), volume.readFileSync("/original.csv"));
    assert.equal(volume.readFileSync("/replay.csv", "utf8"), "8,4,8,,,10,6.000000000000001,10,,,10\n");
    const before = volume.toJSON();
    const invalid = await shell.exec("ssconvert --goal-seek=invalid -T Gnumeric_stf:stf_csv /checkpoint.xml /keep");
    assert.equal(invalid.exitCode, 1);
    assert.equal(invalid.stderr, "Invalid range specified.\n");
    assert.deepEqual(volume.toJSON(), before);
  } finally { await shell.dispose(); }
});

test("ssconvert solver shares successful result and startup diagnostics with SDK byte I/O", async () => {
  for (const [modelType, classification] of [['0', 'linear'], ['+0', 'linear'], ['01', 'quadratic'], ['+2', 'nonlinear']] as const) {
  const original = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">Model</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>Model</gnm:Name><gnm:Solver Target="$B$1" Inputs="$A$1" ModelType="0"/><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="40">2</gnm:Cell><gnm:Cell Row="0" Col="1">=A1*2</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const input = original.replace('ModelType="0"', `ModelType="${modelType}"`);
  const volume = Volume.fromJSON({ '/model.gnumeric': input, '/keep': 'keep' });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 10000, outputBytes: 10000, workbookWork: 10000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const engine = createEngine(binding);
  try {
    const command = await shell.exec('ssconvert --solve -T Gnumeric_XmlIO:sax:0 /model.gnumeric /keep');
    assert.equal(command.exitCode, 0, command.stderr);
    assert.equal(command.stderr, classification === 'quadratic' ? 'Solver: Failed to create solver\n' : classification === 'linear' ? 'Solver: Solver ran, but failed\n' : '');
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: 'stream', filename: 'model.gnumeric', source: [new TextEncoder().encode(input)] }, solve: true,
      exportType: 'Gnumeric_XmlIO:sax:0', destination: { kind: 'stream', sink: { async write(bytes) { chunks.push(bytes.slice()); } } } }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, 0);
    assert.equal(sdk.diagnostics.map(d => d.message).join('\n'), classification === 'quadratic' ? 'Solver: Failed to create solver' : classification === 'linear' ? 'Solver: Solver ran, but failed' : '');
    assert.equal(volume.readFileSync('/model.gnumeric', 'utf8'), input);
    assert.equal(volume.readFileSync('/keep', 'utf8'), new TextDecoder().decode(Buffer.concat(chunks)));
    const resultBook = await engine.readWorkbook({ kind: 'stream', source: chunks }, {}, { signal: new AbortController().signal });
    assert.equal(Object.getPrototypeOf(resultBook.sheets[0]!.cells.find(c => c.row === 0 && c.column === 0)!.value), null);
    assert.deepEqual({ ...resultBook.sheets[0]!.cells.find(c => c.row === 0 && c.column === 0)!.value }, { kind: 'number', value: classification === 'nonlinear' ? 0 : 2 });
    const replay = await shell.exec('ssconvert --solve -T Gnumeric_XmlIO:sax:0 /keep /replay.gnumeric');
    assert.equal(replay.exitCode, 0);
    assert.equal(replay.stderr, command.stderr);
  } finally { await engine.dispose(); await shell.dispose(); }
  }
});

test('ssconvert solves LPs and exports both reports through the shared SDK, checkpoint and replay', async () => {
  const cells = [[0, 0, '0'], [1, 0, '0'], [0, 1, '=3*A1+2*A2'], [1, 1, '=A1+A2'], [0, 2, '4'], [1, 2, '2'], [2, 2, '3']]
    .map(([row, column, value]) => `<gnm:Cell Row="${row}" Col="${column}"${String(value).startsWith('=') ? '' : ' ValueType="40"'}>${value}</gnm:Cell>`).join('');
  const constraints = [['B2', 'C1'], ['A1', 'C2'], ['A2', 'C3']].map(([lhs, rhs]) => `<gnm:Constr Type="1" lhs="${lhs}" rhs="${rhs}"/>`).join('');
  const input = `<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">Sheet</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>Sheet</gnm:Name><gnm:Solver Target="B1" Inputs="A1:A2" ModelType="0" ProblemType="1" ProgramR="1" SensitivityR="1">${constraints}</gnm:Solver><gnm:Cells>${cells}</gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>`;
  const volume = Volume.fromJSON({ '/input.xml': input, '/keep': 'untouched' });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, workbookWork: 1000000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const engine = createEngine(binding), signal = new AbortController().signal;
  try {
    const command = await shell.exec('ssconvert --solve -T Gnumeric_XmlIO:sax:0 /input.xml /result.xml');
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ''); assert.equal(command.stdout, '');
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: 'stream', filename: 'input.xml', source: [new TextEncoder().encode(input)] }, solve: true,
      exportType: 'Gnumeric_XmlIO:sax:0', destination: { kind: 'stream', sink: { async write(bytes) { chunks.push(bytes.slice()); } } } }, { signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
    assert.deepEqual(new Uint8Array(volume.readFileSync('/result.xml') as Uint8Array), new Uint8Array(Buffer.concat(chunks)));
    const result = await engine.readWorkbook({ kind: 'stream', source: chunks }, {}, { signal });
    assert.deepEqual(result.sheets.map(s => s.name), ['Sheet', 'Solver (1)', 'Solver (2)']);
    assert.equal(Object.getPrototypeOf(result.sheets[0]!.cells.find(c => c.row === 0 && c.column === 0)!.value), null);
    assert.deepEqual({ ...result.sheets[0]!.cells.find(c => c.row === 0 && c.column === 0)!.value }, { kind: 'number', value: 2 });
    assert.equal(Object.getPrototypeOf(result.sheets[0]!.cells.find(c => c.row === 1 && c.column === 0)!.value), null);
    assert.deepEqual({ ...result.sheets[0]!.cells.find(c => c.row === 1 && c.column === 0)!.value }, { kind: 'number', value: 2 });
    assert.equal(Object.getPrototypeOf(result.sheets[1]!.cells.find(c => c.row === 2 && c.column === 2)!.value), null);
    assert.deepEqual({ ...result.sheets[1]!.cells.find(c => c.row === 2 && c.column === 2)!.value }, { kind: 'number', value: 10 });
    const headerStyle = result.sheets[1]!.cells.find(c => c.row === 0 && c.column === 0)!.style!.gnumeric as { children: { name: string; attributes: { name: string; value: string }[] }[] };
    assert.equal(headerStyle.children.find(node => node.name === 'Font')!.attributes.find(a => a.name === 'Bold')!.value, '1');
    assert.equal(Object.getPrototypeOf(result.sheets[2]!.cells.find(c => c.row === 7 && c.column === 2)!.value), null);
    assert.deepEqual({ ...result.sheets[2]!.cells.find(c => c.row === 7 && c.column === 2)!.value }, { kind: 'number', value: 2 });
    assert.ok(result.sheets.slice(1).every(s => s.cells.every(c => c.formula === undefined)));
    const checkpoint = await shell.exec('ssconvert -T Gnumeric_XmlIO:sax:0 /result.xml /checkpoint.xml');
    assert.equal(checkpoint.exitCode, 0, checkpoint.stderr);
    const replay = await shell.exec('ssconvert --solve -T Gnumeric_XmlIO:sax:0 /checkpoint.xml /replay.xml');
    assert.equal(replay.exitCode, 0); assert.equal(replay.stderr, 'Solver: Invalid solver target\n');
    assert.equal(volume.readFileSync('/input.xml', 'utf8'), input); assert.equal(volume.readFileSync('/keep', 'utf8'), 'untouched');
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ['/checkpoint.xml', '/input.xml', '/keep', '/replay.xml', '/result.xml']);
  } finally { await engine.dispose(); await shell.dispose(); }
});

test('ssconvert analytic Newton limit shares SDK bytes, feasible reports and checkpoint namespace', async () => {
  const input = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">Sheet</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>Sheet</gnm:Name><gnm:Solver Target="B1" Inputs="A1:A2" ModelType="2" ProblemType="0" MaxIter="1" ProgramR="1"><gnm:Constr Type="1" lhs="B2" rhs="C1"/></gnm:Solver><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="40">0</gnm:Cell><gnm:Cell Row="1" Col="0" ValueType="40">0</gnm:Cell><gnm:Cell Row="0" Col="1">=(A1-3)^2+(A2-2)^2</gnm:Cell><gnm:Cell Row="1" Col="1">=A1+A2</gnm:Cell><gnm:Cell Row="0" Col="2" ValueType="40">2.5</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const volume = Volume.fromJSON({ '/newton.xml': input, '/keep': 'untouched' });
  const binding = { ...options, codecs: [], limits: { ...options.limits, inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, workbookWork: 1000000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const engine = createEngine(binding), signal = new AbortController().signal;
  try {
    const command = await shell.exec('ssconvert --solve -T Gnumeric_XmlIO:sax:0 /newton.xml /result.xml');
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stdout, '');
    assert.equal(command.stderr, 'Solver reached time or iteration limit\n');
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: 'stream', filename: 'newton.xml', source: [new TextEncoder().encode(input)] }, solve: true,
      exportType: 'Gnumeric_XmlIO:sax:0', destination: { kind: 'stream', sink: { async write(bytes) { chunks.push(bytes.slice()); } } } }, { signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics.map(d => d.message), ['Solver reached time or iteration limit']);
    assert.deepEqual(new Uint8Array(volume.readFileSync('/result.xml') as Uint8Array), new Uint8Array(Buffer.concat(chunks)));
    const book = await engine.readWorkbook({ kind: 'stream', source: chunks }, {}, { signal });
    const variables = book.sheets[0]!.cells.filter(c => c.column === 0).map(c => c.value);
    for (const [i, expected] of [1.261706618671816, 0.8411377457812107].entries()) {
      const value = variables[i]!; assert.equal(value.kind, 'number');
      if (value.kind === 'number') assert.ok(Math.abs(value.value - expected) < 1e-12);
      assert.equal(Object.getPrototypeOf(value), null);
    }
    assert.equal(book.sheets[1]!.name, 'Solver (1)');
    assert.deepEqual({ ...book.sheets[1]!.cells.find(c => c.row === 2 && c.column === 4)!.value }, { kind: 'string', value: 'Feasible' });
    assert.ok(book.sheets[1]!.cells.every(c => c.formula === undefined));
    const checkpoint = await shell.exec('ssconvert -T Gnumeric_XmlIO:sax:0 /result.xml /checkpoint.xml');
    assert.equal(checkpoint.exitCode, 0); assert.equal(checkpoint.stderr, '');
    const replay = await shell.exec('ssconvert --solve -T Gnumeric_XmlIO:sax:0 /checkpoint.xml /replay.xml');
    assert.equal(replay.exitCode, 0); assert.equal(replay.stderr, 'Solver: Invalid solver target\n');
    assert.equal(volume.readFileSync('/keep', 'utf8'), 'untouched'); assert.equal(volume.readFileSync('/newton.xml', 'utf8'), input);
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ['/checkpoint.xml', '/keep', '/newton.xml', '/replay.xml', '/result.xml']);
  } finally { await engine.dispose(); await shell.dispose(); }
});


test("ssconvert hidden tool protocol preserves CLI/SDK bytes and replay namespace effects", async () => {
  const volume = Volume.fromJSON({ "/input.fixture": "original", "/keep": "untouched" });
  const codec: Codec = { id: "fixture", description: "Original analysis fixture", extensions: ["fixture"], probeContent: () => true,
    async read(bytes) { return new TextDecoder().decode(bytes) === "original" ? { sheets: [{ id: "s", name: "Input", cells:
      [1, 3, 5, 7].map((value, row) => ({ row, column: 0, value: { kind: "number" as const, value } })) }] } : JSON.parse(new TextDecoder().decode(bytes)); },
    async write(book) { return new TextEncoder().encode(JSON.stringify(book)); } };
  const binding = { ...options, codecs: [codec], limits: { ...options.limits, cells: 100, sheets: 10, operations: 100, inputBytes: 10000, outputBytes: 10000 } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding)), engine = createEngine(binding);
  try {
    const command = await shell.exec("ssconvert --tool-test=moving-average --tool-test=data:A1:A4 --tool-test=interval:2 /input.fixture /output.fixture");
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ""); assert.equal(command.stdout, "");
    const chunks: Uint8Array[] = [];
    const sdk = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original")] },
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } }, exportType: "fixture",
      toolTest: ["moving-average", "data:A1:A4", "interval:2"] }, { signal: new AbortController().signal });
    assert.equal(sdk.exitCode, 0); assert.deepEqual(sdk.diagnostics, []);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/output.fixture") as Uint8Array), chunks[0]);
    const replay = await shell.exec("ssconvert --tool-test=moving-average --tool-test=data:A1:A4 /output.fixture /replay.fixture");
    assert.equal(replay.exitCode, 0, replay.stderr);
    const book = JSON.parse(volume.readFileSync("/replay.fixture", "utf8") as string) as Workbook;
    assert.deepEqual(book.sheets.map(sheet => sheet.name), ["Input", "Moving Average (1)", "Moving Average (2)"]);
    const denied = await shell.exec("ssconvert -T fixture --tool-test=moving-average --tool-test=bad --tool-test=group-by:COL /input.fixture /keep");
    assert.equal(denied.exitCode, 1);
    assert.equal(denied.stderr, 'Ignoring tool test argument "bad"\nCannot parse "COL" as value for "group-by"\nAnalysis tool failed\n');
    assert.equal(volume.readFileSync("/keep", "utf8"), "untouched");
    assert.deepEqual(Object.keys(volume.toJSON()).sort(), ["/input.fixture", "/keep", "/output.fixture", "/replay.fixture"]);
  } finally { await engine.dispose(); await shell.dispose(); }
});


test("ssconvert optional JS function ports share command and SDK calculation without ambient registration", async () => {
  const source = '<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>Sheet</Name><Cells><Cell Row="0" Col="0">=PERL_ADDER(17,22)</Cell><Cell Row="0" Col="1">=PY_BITAND(12,6)</Cell></Cells></Sheet></Sheets></Workbook>';
  const volume = Volume.fromJSON({ "/input.xml": source, "/keep": "keep" });
  const binding = { ...options, codecs: [], limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 }, runtimeFunctions: { ...perlSampleFunctions, ...pythonSampleFunctions } };
  const shell = new Shell({ fs: filesystem(volume) }).use(ssconvertCommands(binding));
  const sdk = createEngine(binding);
  binding.runtimeFunctions.PERL_ADDER = { signature: "ff", implementation() { return { kind: "number", value: -1 }; } };
  const chunks: Uint8Array[] = [];
  try {
    const command = await shell.exec("ssconvert --recalc -T Gnumeric_stf:stf_csv /input.xml fd://1");
    assert.equal(command.exitCode, 0, command.stderr); assert.equal(command.stderr, ""); assert.equal(command.stdout, "39,4\n");
    const direct = await sdk.convert({ input: { kind: "stream", filename: "input.xml", source: [new TextEncoder().encode(source)] },
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } }, exportType: "Gnumeric_stf:stf_csv", recalc: true },
      { signal: new AbortController().signal });
    assert.equal(direct.exitCode, command.exitCode); assert.deepEqual(direct.diagnostics, []);
    assert.deepEqual(command.stdoutBytes, new Uint8Array(Buffer.concat(chunks)));
    assert.deepEqual(volume.toJSON(), { "/input.xml": source, "/keep": "keep" });
  } finally { await sdk.dispose(); await shell.dispose(); }
});
