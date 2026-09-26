import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, createResourceIO, runCommand } from "../index.js";

function fixture() {
  const volume = Volume.fromJSON({ "/input.csv": "1,2\n3,4\n", "/keep": "keep" });
  const engine = createEngine({ codecs: [], environment: { env: { PWD: "/" }, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 },
    filesystem: createResourceIO({ cwd: "/", filesystem: {
      async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { volume.writeFileSync(path, bytes); }
    } }) });
  async function cli(args: readonly string[]) {
    const stderr: string[] = [];
    const result = await runCommand(args, engine, { signal: new AbortController().signal,
      stdout: { async write() { throw new Error("unexpected stdout"); } },
      stderr: { async write(bytes) { stderr.push(new TextDecoder().decode(bytes)); } } });
    return { result, stderr };
  }
  return { volume, engine, cli };
}

it("uses the clipboard-specific output-open failure diagnostic", async () => {
  const f = fixture();
  expect(await f.cli(["--clipboard=UTF8_STRING", "--export-range=A1", "/input.csv", "/absent/output"])).toEqual({
    result: { exitCode: 1 }, stderr: ["Failed to write to file:///absent/output\n"]
  });
  expect(f.volume.toJSON()).toEqual({ "/input.csv": "1,2\n3,4\n", "/keep": "keep" });
});

it("ignores ordinary conversion flags after loading and exposes the same SDK serializer", async () => {
  const f = fixture();
  const command = await f.cli(["--clipboard=UTF8_STRING", "--export-range=A1", "-I", "unknown", "-T", "unknown",
    "-O", "invalid", "--resize=bad", "--solve", "--recalc", "-S", "/input.csv", "/output"]);
  expect(command.stderr).toEqual([]); expect(command.result.exitCode).toBe(0);
  const chunks: Uint8Array[] = [];
  const sdk = await f.engine.exportClipboard({ input: { kind: "resource", uri: "/input.csv" },
    destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
    target: "UTF8_STRING", range: { sheet: "s1", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } },
  { signal: new AbortController().signal });
  expect(sdk.exitCode).toBe(command.result.exitCode);
  expect(chunks).toEqual([new Uint8Array()]); expect(f.volume.readFileSync("/output")).toHaveLength(0);
});

it("requires two operands and a range, and keeps load/range/MIME diagnostic order", async () => {
  const f = fixture();
  for (const args of [["--clipboard=UTF8_STRING", "--export-range=A1", "/input.csv"], ["--clipboard=UTF8_STRING", "/input.csv", "/keep"]]) {
    expect(await f.cli(args)).toEqual({ result: { exitCode: 1 }, stderr: ["Usage: ssconvert [OPTION...] INFILE [OUTFILE]\n"] });
  }
  expect(await f.cli(["--clipboard=text/plain", "--export-range=bad", "/absent", "/keep"])).toEqual({
    result: { exitCode: 1 }, stderr: ["E /absent: No such file or directory\n"] });
  expect(await f.cli(["--clipboard=text/plain", "--export-range=bad", "/input.csv", "/keep"])).toEqual({
    result: { exitCode: 1 }, stderr: ["Invalid range specified.\n"] });
  expect(f.volume.readFileSync("/keep", "utf8")).toBe("keep");
});

it("auto-imports using the requested encoding and applies cell updates", async () => {
  const f = fixture();
  f.volume.writeFileSync("/latin.csv", new Uint8Array([233, 10]));
  const latin = await f.cli(["--clipboard=application/x-gnumeric", "--export-range=A1", "-E", "ISO-8859-1", "/latin.csv", "/latin.xml"]);
  expect(latin.result.exitCode).toBe(0); expect(latin.stderr).toEqual([]);
  expect(String(f.volume.readFileSync("/latin.xml", "utf8"))).toContain('<gnm:Cell Row="0" Col="0" ValueType="60">é</gnm:Cell>');
  const updated = await f.cli(["--clipboard=application/x-gnumeric", "--export-range=A1:B2", "--set", "B2=8", "/input.csv", "/updated.xml"]);
  expect(updated.result.exitCode).toBe(0); expect(updated.stderr).toEqual([]);
  expect(String(f.volume.readFileSync("/updated.xml", "utf8"))).toContain('<gnm:Cell Row="1" Col="1" ValueType="40">8</gnm:Cell>');
});

it("copies the active sheet for an unqualified range and focuses a qualified range", async () => {
  const f = fixture();
  const source = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName>First</gnm:SheetName><gnm:SheetName>Last</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets>' +
    ["First", "Last"].map((name, index) => `<gnm:Sheet><gnm:Name>${name}</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="40">${index + 1}</gnm:Cell></gnm:Cells></gnm:Sheet>`).join("") +
    '</gnm:Sheets><gnm:UIData SelectedTab="1"/></gnm:Workbook>';
  f.volume.writeFileSync("/active.gnumeric", source);
  for (const [range, value] of [["A1", 2], ["First!A1", 1]] as const) {
    const result = await f.cli(["--clipboard=application/x-gnumeric", `--export-range=${range}`, "/active.gnumeric", "/focus.xml"]);
    expect(result.result.exitCode).toBe(0); expect(result.stderr).toEqual([]);
    expect(String(f.volume.readFileSync("/focus.xml", "utf8"))).toContain(`<gnm:Cell Row="0" Col="0" ValueType="40">${value}</gnm:Cell>`);
  }
});

it("rejects oversized clipboard capability bytes before opening an output", async () => {
  let opened = 0, written = 0;
  const engine = createEngine({ codecs: [{ id: "fixture", description: "Original bounded fixture", extensions: [],
    probeContent: () => true, async read() { return { sheets: [{ id: "s", name: "One", cells: [] }] }; } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000, outputBytes: 100, cells: 100, sheets: 10, operations: 100 },
    clipboard: { async serialize() { return new Uint8Array(101); } },
    filesystem: { async read() { return []; }, async write() { written++; },
      async openOutput() { opened++; return { async write() { written++; }, async close() {}, async abort() {} }; } }
  });
  await expect(engine.convert({ input: { kind: "stream", source: [new Uint8Array([1])] },
    destination: { kind: "resource", uri: "/output" }, clipboard: "UTF8_STRING", exportRangeExpression: "A1" },
  { signal: new AbortController().signal })).rejects.toMatchObject({ code: "resource-limit" });
  expect({ opened, written }).toEqual({ opened: 0, written: 0 });
});

it.each([0, 1])("calculates dirty imported formula caches on load even when ManualRecalc=%s", async manual => {
  const f = fixture();
  const source = `<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Calculation ManualRecalc="${manual}"/><gnm:SheetNameIndex><gnm:SheetName>One</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>One</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="40" Value="99">=1+1</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>`;
  f.volume.writeFileSync("/formula.gnumeric", source);
  const result = await f.cli(["--clipboard=application/x-gnumeric", "--export-range=A1", "/formula.gnumeric", "/formula.xml"]);
  expect(result.result.exitCode).toBe(0); expect(result.stderr).toEqual([]);
  expect(String(f.volume.readFileSync("/formula.xml", "utf8"))).toContain('<gnm:Cell Row="0" Col="0" ExprID="1" ValueType="40" Value="2">=1+1</gnm:Cell>');
});

it("preserves the qualified native 1904 date-convention attribute", async () => {
  const f = fixture();
  const source = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Calculation DateConvention="Apple:1904"/><gnm:SheetNameIndex><gnm:SheetName>One</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>One</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="40">1</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  f.volume.writeFileSync("/date.gnumeric", source);
  const result = await f.cli(["--clipboard=application/x-gnumeric", "--export-range=A1", "/date.gnumeric", "/date.xml"]);
  expect(result.result.exitCode).toBe(0); expect(result.stderr).toEqual([]);
  expect(String(f.volume.readFileSync("/date.xml", "utf8"))).toContain('BaseRow="0" gnm:DateConvention="Apple:1904" FloatRadix="2"');
});

it("translates known errors from an injected output opener while retaining opaque failures", async () => {
  for (const error of [Object.assign(new Error("denied"), { code: "EACCES" }), new Error("opaque capability failure")]) {
    const engine = createEngine({ codecs: [{ id: "fixture", description: "Original opener fixture", extensions: [],
      probeContent: () => true, async read() { return { sheets: [{ id: "s", name: "One", cells: [] }] }; } }],
      environment: { env: { PWD: "/" }, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 1000, outputBytes: 1000, cells: 100, sheets: 10, operations: 100 },
      filesystem: { async read() { return []; }, async write() { throw new Error("unexpected write"); },
        async openOutput() { throw error; } } });
    const conversion = engine.convert({ input: { kind: "stream", source: [new Uint8Array([1])] },
      destination: { kind: "resource", uri: "/output" }, clipboard: "UTF8_STRING", exportRangeExpression: "A1" },
    { signal: new AbortController().signal });
    if ("code" in error) await expect(conversion).rejects.toMatchObject({ exitCode: 1, message: "Failed to write to file:///output" });
    else await expect(conversion).rejects.toBe(error);
  }
});

it.each([
  { startRow: -1, endRow: 0, startColumn: 0, endColumn: 0 },
  { startRow: 1, endRow: 0, startColumn: 0, endColumn: 0 },
  { startRow: 0, endRow: NaN, startColumn: 0, endColumn: 0 },
  { startRow: 0, endRow: 0, startColumn: 0, endColumn: Infinity }
])("rejects malformed SDK coordinates before MIME lookup or output effects: %j", async coordinates => {
  const f = fixture();
  await expect(f.engine.exportClipboard({ input: { kind: "resource", uri: "/input.csv" },
    destination: { kind: "resource", uri: "/keep" }, target: "UTF8_STRING", range: { sheet: "s1", ...coordinates } },
  { signal: new AbortController().signal })).rejects.toMatchObject({ exitCode: 1, message: "Invalid range specified." });
  expect(f.volume.readFileSync("/keep", "utf8")).toBe("keep");
});
