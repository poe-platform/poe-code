import { expect, it } from "vitest";
import { Volume } from "memfs";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { createChartWorkbook, validateChartWorkbook } from "./chart-workbook.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144,
    maxEntryBytes: 65536,
    maxTotalBytes: 262144,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
const data = {
  categories: ["West", null, "East & North"],
  series: [{ name: "", values: [0, null, -2] }]
};
const encode = (value: string) => new TextEncoder().encode(value);
const sheet =
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t xml:space="preserve"></t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">West</t></is></c><c r="B2"><v>0</v></c></row><row r="3"></row><row r="4"><c r="A4" t="inlineStr"><is><t xml:space="preserve">East &amp; North</t></is></c><c r="B4"><v>-2</v></c></row></sheetData></worksheet>';
it("writes original deterministic worksheet cells with missing indices retained", async () => {
  const bytes = await createChartWorkbook(data, false, context);
  const volume = Volume.fromJSON({ "/data.xlsx": Buffer.from(bytes) });
  const entries = inspectZip(new Uint8Array(volume.readFileSync("/data.xlsx") as Buffer));
  expect(
    new TextDecoder().decode(entries.find((e) => e.name === "xl/worksheets/sheet1.xml")!.payload)
  ).toBe(sheet);
  expect(await createChartWorkbook(data, false, context)).toEqual(bytes);
  expect(await validateChartWorkbook(bytes, context)).toMatchObject({
    sheetName: "Sheet1",
    date1904: false
  });
});
it("keeps each scatter series pair adjacent and orders points without sorting", async () => {
  const bytes = await createChartWorkbook(
    {
      series: [
        { name: "A", xValues: [8, 1], values: [null, 3] },
        { name: "B", xValues: [4], values: [7] }
      ]
    },
    true,
    context
  );
  const xml = new TextDecoder().decode(
    inspectZip(bytes).find((e) => e.name === "xl/worksheets/sheet1.xml")!.payload
  );
  expect(xml).toContain(
    '<row r="2"><c r="A2"><v>8</v></c><c r="C2"><v>4</v></c><c r="D2"><v>7</v></c></row>'
  );
  expect(xml).toContain('<row r="3"><c r="A3"><v>1</v></c><c r="B3"><v>3</v></c></row>');
});
it.each([
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>2+2</f><v>4</v></c></row></sheetData></worksheet>',
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/><tableParts/></worksheet>',
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/><extLst/></worksheet>'
])(
  "rejects worksheet content requiring calculation or unsupported reconstruction %s",
  async (xml) => {
    const base = await createChartWorkbook(data, false, context);
    const bytes = storedArchive(
      inspectZip(base).map((e) => ({
        name: e.name,
        bytes: e.name === "xl/worksheets/sheet1.xml" ? encode(xml) : e.payload
      }))
    );
    await expect(validateChartWorkbook(bytes, context)).rejects.toMatchObject({
      code: "unsupported-edit"
    });
  }
);
it("retains date system and independent theme bytes when replacing the owned sheet", async () => {
  const base = await createChartWorkbook(data, false, context, { date1904: true });
  const entries = inspectZip(base).map((e) => ({ name: e.name, bytes: e.payload }));
  entries.push({
    name: "xl/theme/theme1.xml",
    bytes: encode(
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Retained"/>'
    )
  });
  const source = storedArchive(entries);
  const next = await createChartWorkbook(
    { categories: ["New"], series: [{ name: "N", values: [9] }] },
    false,
    context,
    { source }
  );
  const changed = inspectZip(next);
  for (const entry of entries.filter((e) => e.name !== "xl/worksheets/sheet1.xml")) {
    expect(changed.find((e) => e.name === entry.name)!.payload).toEqual(entry.bytes);
  }
  expect(await validateChartWorkbook(next, context)).toMatchObject({ date1904: true });
});

it.each([
  [
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>',
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="Extra" sheetId="2" r:id="rId1"/></sheets>'
  ],
  [
    '<workbookPr date1904="0"/>',
    '<workbookPr date1904="0"/><definedNames><definedName name="Total">1+1</definedName></definedNames>'
  ]
])("rejects additional worksheet ownership or defined calculations", async (before, after) => {
  const bytes = await createChartWorkbook(data, false, context);
  const source = storedArchive(
    inspectZip(bytes).map((e) => ({
      name: e.name,
      bytes:
        e.name === "xl/workbook.xml"
          ? encode(new TextDecoder().decode(e.payload).replace(before!, after!))
          : e.payload
    }))
  );
  await expect(validateChartWorkbook(source, context)).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});

it("rejects external relationships even when the data cells are local", async () => {
  const bytes = await createChartWorkbook(data, false, context);
  const source = storedArchive(
    inspectZip(bytes).map((e) => ({
      name: e.name,
      bytes:
        e.name === "xl/_rels/workbook.xml.rels"
          ? encode(
              new TextDecoder()
                .decode(e.payload)
                .replace(
                  "</Relationships>",
                  '<Relationship Id="outside" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.invalid/data.xlsx" TargetMode="External"/></Relationships>'
                )
            )
          : e.payload
    }))
  );
  await expect(validateChartWorkbook(source, context)).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});

it("rejects unrelated tables identified by content type outside conventional paths", async () => {
  const base = await createChartWorkbook(data, false, context);
  const entries = inspectZip(base).map((e) => ({ name: e.name, bytes: e.payload }));
  const contentTypes = entries.find((e) => e.name === "[Content_Types].xml")!;
  contentTypes.bytes = encode(
    new TextDecoder()
      .decode(contentTypes.bytes)
      .replace(
        "</Types>",
        '<Override PartName="/custom/data.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>'
      )
  );
  entries.push({
    name: "custom/data.xml",
    bytes: encode('<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>')
  });
  await expect(validateChartWorkbook(storedArchive(entries), context)).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});
