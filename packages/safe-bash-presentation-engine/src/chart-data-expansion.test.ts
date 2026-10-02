import { expect, it } from "vitest";
import { Volume } from "memfs";
import { storedArchive } from "../tests/fixtures/archive.js";
import { inspectZip } from "../tests/zip-reader.js";
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
function parts(bytes: Uint8Array) {
  const fs = Volume.fromJSON({ "/chart.xlsx": Buffer.from(bytes) });
  return new Map(
    inspectZip(new Uint8Array(fs.readFileSync("/chart.xlsx") as Buffer)).map((entry) => [
      entry.name,
      new TextDecoder().decode(entry.payload)
    ])
  );
}
it("places outer category levels before leaf labels and shifts the values column", async () => {
  const workbook = parts(
    await createChartWorkbook(
      {
        categoryLevels: [
          ["Coast", null, "Inland"],
          ["Port", "Bay", "Hill"]
        ],
        series: [{ name: "Units", values: [3, null, 8] }]
      },
      false,
      context
    )
  );
  const sheet = workbook.get("xl/worksheets/sheet1.xml")!;
  expect(sheet).toContain('<c r="C1" t="inlineStr"><is><t xml:space="preserve">Units</t></is></c>');
  expect(sheet).toContain(
    '<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">Coast</t></is></c><c r="B2" t="inlineStr"><is><t xml:space="preserve">Port</t></is></c><c r="C2"><v>3</v></c></row>'
  );
  expect(sheet).toContain(
    '<row r="3"><c r="B3" t="inlineStr"><is><t xml:space="preserve">Bay</t></is></c></row>'
  );
});
it("writes adjacent bubble triples including zero sizes and independent series lengths", async () => {
  const workbook = parts(
    await createChartWorkbook(
      {
        series: [
          { name: "Near", xValues: [7, -2], values: [null, 6], bubbleSizes: [0, 9] },
          { name: "Far", xValues: [3], values: [4], bubbleSizes: [2] }
        ]
      },
      true,
      context
    )
  );
  expect(workbook.get("xl/worksheets/sheet1.xml")).toContain(
    '<row r="2"><c r="A2"><v>7</v></c><c r="C2"><v>0</v></c><c r="D2"><v>3</v></c><c r="E2"><v>4</v></c><c r="F2"><v>2</v></c></row>'
  );
  expect(workbook.get("xl/worksheets/sheet1.xml")).toContain(
    '<row r="3"><c r="A3"><v>-2</v></c><c r="B3"><v>6</v></c><c r="C3"><v>9</v></c></row>'
  );
});
it("applies category, inherited, and overridden numeric formats to worksheet cells", async () => {
  const workbook = parts(
    await createChartWorkbook(
      {
        categories: [61],
        categoryNumberFormat: "yyyy-mm-dd",
        numberFormat: "0.0%",
        series: [
          { name: "Share", values: [0.2] },
          { name: "Cost", values: [8], numberFormat: "$0.00" }
        ]
      },
      false,
      context
    )
  );
  expect(workbook.get("xl/worksheets/sheet1.xml")).toContain(
    '<row r="2"><c r="A2" s="1"><v>61</v></c><c r="B2" s="2"><v>0.2</v></c><c r="C2" s="3"><v>8</v></c></row>'
  );
  const styles = workbook.get("xl/styles.xml")!;
  expect(styles).toContain('numFmtId="164" formatCode="yyyy-mm-dd"');
  expect(styles).toContain('numFmtId="165" formatCode="0.0%"');
  expect(styles).toContain('numFmtId="166" formatCode="$0.00"');
  expect(workbook.get("xl/_rels/workbook.xml.rels")).toContain('Target="styles.xml"');
  expect(workbook.get("[Content_Types].xml")).toContain('PartName="/xl/styles.xml"');
});
it("formats bubble coordinates and sizes from data while y values use the series override", async () => {
  const workbook = parts(
    await createChartWorkbook(
      {
        numberFormat: "0.00",
        series: [
          { name: "Motion", xValues: [2], values: [0.3], bubbleSizes: [4], numberFormat: "0%" }
        ]
      },
      true,
      context
    )
  );
  expect(workbook.get("xl/worksheets/sheet1.xml")).toContain(
    '<row r="2"><c r="A2" s="1"><v>2</v></c><c r="B2" s="2"><v>0.3</v></c><c r="C2" s="1"><v>4</v></c></row>'
  );
});
it.each([false, true])(
  "preserves the date system and old format definitions when adding replacement styles: %s",
  async (date1904) => {
    const source = await createChartWorkbook(
      {
        categories: [0],
        categoryNumberFormat: "yyyy-mm-dd",
        series: [{ name: "Old", values: [1], numberFormat: "0%" }]
      },
      false,
      context,
      { date1904 }
    );
    const next = await createChartWorkbook(
      {
        categories: [2],
        categoryNumberFormat: "yyyy-mm-dd",
        series: [{ name: "New", values: [5], numberFormat: "0.00" }]
      },
      false,
      context,
      { source }
    );
    const before = parts(source),
      after = parts(next);
    expect(await validateChartWorkbook(next, context)).toMatchObject({ date1904 });
    expect(after.get("xl/workbook.xml")).toBe(before.get("xl/workbook.xml"));
    expect(after.get("xl/styles.xml")).toContain('formatCode="0%"');
    expect(after.get("xl/styles.xml")).toContain('formatCode="0.00"');
    expect(after.get("xl/worksheets/sheet1.xml")).toContain('<c r="B2" s="3"><v>5</v></c>');
  }
);

it("adds linked format definitions when the owned workbook had no styles", async () => {
  const source = await createChartWorkbook(
    { categories: ["Before"], series: [{ name: "Count", values: [1] }] },
    false,
    context
  );
  const next = await createChartWorkbook(
    { categories: ["After"], series: [{ name: "Count", values: [2], numberFormat: "0.000" }] },
    false,
    context,
    { source }
  );
  const workbook = parts(next);
  expect(workbook.get("xl/chart-styles.xml")).toContain('formatCode="0.000"');
  expect(workbook.get("xl/_rels/workbook.xml.rels")).toContain('Target="chart-styles.xml"');
  expect(workbook.get("[Content_Types].xml")).toContain('PartName="/xl/chart-styles.xml"');
  expect(await validateChartWorkbook(next, context)).toMatchObject({ sheetName: "Sheet1" });
});

it("writes explicit General formatting when an imported workbook has a custom default style", async () => {
  const seed = await createChartWorkbook(
    { categories: [1], series: [{ name: "Old", values: [0.5], numberFormat: "0%" }] },
    false,
    context
  );
  const source = storedArchive(
    inspectZip(seed).map((entry) => ({
      name: entry.name,
      bytes:
        entry.name === "xl/styles.xml"
          ? new TextEncoder().encode(
              new TextDecoder()
                .decode(entry.payload)
                .replace(
                  '<cellXfs count="2"><xf numFmtId="0"',
                  '<cellXfs count="2"><xf numFmtId="164"'
                )
            )
          : entry.payload
    }))
  );
  const next = parts(
    await createChartWorkbook(
      { categories: [2], series: [{ name: "New", values: [3], numberFormat: "General" }] },
      false,
      context,
      { source }
    )
  );
  expect(next.get("xl/worksheets/sheet1.xml")).toContain(
    '<row r="2"><c r="A2" s="2"><v>2</v></c><c r="B2" s="2"><v>3</v></c></row>'
  );
  expect(next.get("xl/styles.xml")).toContain(
    'numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"'
  );
});

it.each(["0", "false"])(
  "does not reuse a cell style whose number format is explicitly disabled: %s",
  async (disabled) => {
    const data = {
      categories: ["Rate"],
      series: [{ name: "Share", values: [0.25], numberFormat: "0%" }]
    };
    const seed = await createChartWorkbook(data, false, context);
    const source = storedArchive(
      inspectZip(seed).map((entry) => ({
        name: entry.name,
        bytes:
          entry.name === "xl/styles.xml"
            ? new TextEncoder().encode(
                new TextDecoder()
                  .decode(entry.payload)
                  .replace('applyNumberFormat="1"', `applyNumberFormat="${disabled}"`)
              )
            : entry.payload
      }))
    );
    const next = parts(await createChartWorkbook(data, false, context, { source }));
    expect(next.get("xl/worksheets/sheet1.xml")).toContain('<c r="B2" s="2"><v>0.25</v></c>');
    expect(next.get("xl/styles.xml")).toContain(`applyNumberFormat="${disabled}"`);
    expect(next.get("xl/styles.xml")).toContain('applyNumberFormat="1"');
  }
);
