import {expect, it} from "vitest";
import {gzipSync} from "node:zlib";
import {createEngine} from "../engine.js";
import {readGnumeric, probeGnumeric} from "./gnumeric.js";
import {defaultSsconvertLimits, type CapabilityContext} from "@poe-code/spreadsheet-engine";
const context: CapabilityContext = {signal: new AbortController().signal, own() {}, limits: defaultSsconvertLimits,
  environment: {env: {}, locale: "C", timezone: "UTC"}};
function document(declaration: string, value: string) {
  return `${declaration}<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:Version Epoch="1" Major="12" Minor="61"/><gnm:SheetNameIndex><gnm:SheetName gnm:Cols="256" gnm:Rows="65536">S</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>S</gnm:Name><gnm:Cells><gnm:Cell Row="0" Col="0" ValueType="60">${value}</gnm:Cell></gnm:Cells></gnm:Sheet></gnm:Sheets></gnm:Workbook>`;
}
it.each(["utf8", "UTF8", "uTf8", "UTF-8"].flatMap(alias => [false,true].flatMap(bom => [false,true].map(gzip => ({alias,bom,gzip})))))("detects and reads $alias with BOM=$bom gzip=$gzip", async ({alias,bom,gzip}) => {
  const value = "café Ω 😀".repeat(200);
  const raw = new TextEncoder().encode((bom ? "\ufeff" : "") + document(`<?xml version="1.0" encoding="${alias}"?>`, value));
  const bytes = gzip ? new Uint8Array(gzipSync(raw)) : raw, buffer = new Uint8Array(257);
  const source = {size: bytes.length, async read(position: number, count: number) {
    const size = Math.min(count, buffer.length, bytes.length-position);
    buffer.set(bytes.subarray(position, position+size));return buffer.subarray(0,size);
  }};
  expect(await probeGnumeric(source, context)).toBe(true);
  const book = await readGnumeric(source, context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({kind: "string", value});
});
it("autodetects aliased XML through the public engine instead of importing its markup as text", async () => {
  const engine = createEngine();
  try {
    const bytes = new TextEncoder().encode(document('<?xml version="1.0" encoding="utf8"?>', "café Ω 😀"));
    const book = await engine.readWorkbook({kind: "stream", filename: "input.gnumeric", source: [bytes]}, {}, {signal: new AbortController().signal});
    expect(book.sheets[0]!.name).toBe("S");
    expect(book.sheets[0]!.cells[0]!.value).toEqual({kind: "string", value: "café Ω 😀"});
  } finally {await engine.dispose();}
});
it("does not reinterpret declaration-looking text in workbook content", async () => {
  const value = "encoding='utf8'";
  const book = await readGnumeric(new TextEncoder().encode(document('<?xml version="1.0"?>', value)), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({kind: "string", value});
});
it("still rejects malformed UTF8 bytes after accepting the alias", async () => {
  const source = new TextEncoder().encode(document('<?xml version="1.0" encoding="utf8"?>', "value"));
  const prefix = new TextEncoder().encode(document('<?xml version="1.0" encoding="utf8"?>', "").split('</gnm:Cell>')[0]).length;
  source[prefix] = 255;
  await expect(readGnumeric(source, context)).rejects.toThrow();
});
