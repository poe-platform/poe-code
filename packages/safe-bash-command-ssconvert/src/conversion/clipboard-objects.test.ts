import { expect, it } from "vitest";
import { createEngine, type Workbook } from "../index.js";

const namespace = "http://www.gnumeric.org/v10.dtd";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const pixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/AAoUHv8BpAE8tOS4KAAAAABJRU5ErkJggg==";
const object = { name: "SheetObjectImage", namespace, text: "", attributes: [
  { name: "ObjectBound", namespace: "", value: "C3:D4" }
], children: [{ name: "Content", namespace: "", text: png,
  attributes: [{ name: "image-type", namespace: "", value: "png" }], children: [] }] };
const book: Workbook = { sheets: [{ id: "s", name: "First", cells: [], unsupportedRecords: [{
  source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: {
    name: "Objects", namespace, text: "", attributes: [], children: [object]
  }
}] }] };

it("exports embedded PNG bytes without a desktop clipboard or native process", async () => {
  const engine = createEngine({ codecs: [{ id: "fixture", description: "Original image fixture", extensions: [],
    probeContent: () => true, async read() { return book; } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100, workbookWork: 100000 } });
  const chunks: Uint8Array[] = [];
  const result = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("original")] },
    destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
    clipboard: "image/png", exportRangeExpression: "C3:D4" }, { signal: new AbortController().signal });
  expect(result.exitCode).toBe(0); expect(result.diagnostics).toEqual([]);
  expect(chunks).toEqual([new Uint8Array(Buffer.from(png, "base64"))]);
});

it.each(["image/png", "image/jpeg", "image/bmp", "image/svg+xml", "image/x-wmf", "image/x-emf", "application/x-goffice-graph"])("recognizes native object target %s when no object was copied", async target => {
  const engine = createEngine({ codecs: [{ id: "fixture", description: "Original empty fixture", extensions: [],
    probeContent: () => true, async read() { return { sheets: [{ id: "s", name: "One", cells: [] }] }; } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 } });
  const chunks: Uint8Array[] = [];
  const result = await engine.convert({ input: { kind: "stream", source: [new Uint8Array([1])] },
    destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
    clipboard: target, exportRangeExpression: "A1" }, { signal: new AbortController().signal });
  expect(result.exitCode).toBe(0); expect(chunks).toEqual([new Uint8Array()]);
  expect(result.diagnostics.map(d => d.message)).toEqual(target === "application/x-goffice-graph" ?
    ["Unknown info type", "object_write: assertion 'cr->objects != NULL' failed"] :
    ["image_write: assertion 'cr->objects != NULL' failed"]);
});

it("serializes the native empty graph object with resolved defaults", async () => {
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100, workbookWork: 100000 } });
  const source = '<gnm:Workbook xmlns:gnm="http://www.gnumeric.org/v10.dtd"><gnm:SheetNameIndex><gnm:SheetName>One</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>One</gnm:Name><gnm:Objects><gnm:SheetObjectGraph ObjectBound="A1:B2"><GogObject type="GogGraph"/></gnm:SheetObjectGraph></gnm:Objects><gnm:Cells/></gnm:Sheet></gnm:Sheets></gnm:Workbook>';
  const chunks: Uint8Array[] = [];
  const result = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(source)] },
    destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
    clipboard: "application/x-goffice-graph", exportRangeExpression: "A1:B2" }, { signal: new AbortController().signal });
  expect(result.exitCode).toBe(0); expect(result.diagnostics.map(d => d.message)).toEqual(["Unknown info type"]);
  expect(new TextDecoder().decode(chunks[0])).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<GogObject type="GogGraph">
  <property name="height-pts">12.75</property>
  <property name="width-pts">48</property>
  <property name="theme-name">Default</property>
  <property name="padding-pts">7.086614173228346</property>
  <property name="style" type="GogStyle">
    <outline auto-dash="1" auto-width="1" auto-color="1"/>
    <fill type="none" auto-type="1" is-auto="1" auto-fore="1"/>
  </property>
  <property name="anchor">top-left</property>
  <property name="alignment">fill</property>
</GogObject>
`);
});

it.each(["image/bmp", "image/jpeg"])("transcodes an original one-pixel PNG to %s", async target => {
  const source = `<gnm:Workbook xmlns:gnm="${namespace}"><gnm:SheetNameIndex><gnm:SheetName>One</gnm:SheetName></gnm:SheetNameIndex><gnm:Sheets><gnm:Sheet><gnm:Name>One</gnm:Name><gnm:Objects><gnm:SheetObjectImage ObjectBound="C3:D4"><Content image-type="png">${pixelPng}</Content></gnm:SheetObjectImage></gnm:Objects><gnm:Cells/></gnm:Sheet></gnm:Sheets></gnm:Workbook>`;
  const engine = createEngine({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100, workbookWork: 100000 } });
  const chunks: Uint8Array[] = [];
  const result = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode(source)] },
    destination: { kind: "stream", sink: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } },
    clipboard: target, exportRangeExpression: "C3:D4" }, { signal: new AbortController().signal });
  expect(result.exitCode).toBe(0); expect(result.diagnostics).toEqual([]);
  if (target === "image/bmp") {
    // Native GdkPixbuf leaves the final alignment byte uninitialized. Compare
    // the measured header and pixel bytes; that padding is not a parity pass.
    expect(Buffer.from(chunks[0]!.slice(0, 57)).toString("hex")).toBe("424d3a0000000000000036000000280000000100000001000000010018000000000004000000000000000000000000000000000000001e140a");
  } else {
    expect([...chunks[0]!.slice(0, 2)]).toEqual([255, 216]);
    expect([...chunks[0]!.slice(-2)]).toEqual([255, 217]);
  }
});
