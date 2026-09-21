import { expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { createEngine, runCommand, type Codec, type RuntimeLimits } from "./index.js";
import { readGnumeric } from "./codecs/gnumeric.js";

const limits = { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 10, operations: 20 };
const book = { sheets: [{ id: "a", name: "A", cells: [] }, { id: "b", name: "B", cells: [] }] };
const codec: Codec = { id: "fixture", description: "Original fixture", extensions: ["csv"], saveScope: "sheet",
  probeContent: () => true, async read() { return book; }, async write() { return new Uint8Array([1]); } };
const operation = () => ({ signal: new AbortController().signal });
function engine(extra: Partial<RuntimeLimits>, codecs = [codec]) {
  return createEngine({ limits: { ...limits, ...extra }, codecs,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: { async read() { return [new Uint8Array([1])]; }, async write() { throw new Error("publication must not start"); } } });
}
it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid command output budget %s before admitting command work", value => {
    expect(() => engine({ commandOutputBytes: value })).toThrowError(
      new TypeError("Invalid ssconvert limit: commandOutputBytes"));
  });
it("refuses argument bytes before parsing even terminal actions", async () => {
  const errors: string[] = [];
  const result = await runCommand(["--help"], engine({ argumentBytes: 5 } as Partial<RuntimeLimits>), {
    ...operation(), stdout: { async write() { throw new Error("help must not be allocated"); } },
    stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } }
  });
  expect(result).toEqual({ exitCode: 1 });
  expect(errors).toEqual(["ssconvert argument bytes limit exceeded\n"]);
});
it("admits the complete split count before namespace acquisition", async () => {
  await expect(engine({ splitOutputs: 1 } as Partial<RuntimeLimits>).convert({
    input: { kind: "resource", uri: "/in.csv" }, destination: { kind: "resource", uri: "/out.csv" }, perSheet: true
  }, operation())).rejects.toMatchObject({ code: "resource-limit", message: "ssconvert split outputs limit exceeded" });
});
const xml = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Sheets/></gnm:Workbook>';
it.each([{ inflatedBytes: 16 }, { compressedBytes: 1 }, { xmlDepth: 1 }])("refuses Gnumeric boundary %j", async (extra) => {
  const importer: Codec = { ...codec, id: "xml", read: readGnumeric };
  await expect(engine(extra as Partial<RuntimeLimits>, [importer]).readWorkbook({ kind: "stream",
    source: [new Uint8Array(gzipSync(xml))] }, { importType: "xml" }, operation())).rejects.toMatchObject({ code: "resource-limit" });
});

it("applies XML depth and declaration policy to SpreadsheetML", async () => {
  const { readSpreadsheetML } = await import("./codecs/spreadsheetml.js");
  const importer: Codec = { ...codec, id: "xml", read: readSpreadsheetML };
  const text = '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="S" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Table/></Worksheet></Workbook>';
  await expect(engine({ xmlDepth: 1 }, [importer]).readWorkbook({ kind: "stream",
    source: [new TextEncoder().encode(text)] }, { importType: "xml" }, operation())).rejects.toMatchObject({ code: "resource-limit" });
  await expect(engine({}, [importer]).readWorkbook({ kind: "stream",
    source: [new TextEncoder().encode('<!DOCTYPE Workbook [<!ENTITY x "value">]>' + text)] },
    { importType: "xml" }, operation())).rejects.toMatchObject({ code: "capability-denied", message: "ssconvert host denies XML DTD and entity declarations" });
});
