import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createChartWorkbook, validateChartWorkbook } from "./chart-workbook.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { parseXmlPart } from "./xml.js";

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
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const data = {
  categories: ["=2+2", '  Bay & "fjord" <雪>\r\n'],
  series: [{ name: "", values: [0, null] }]
};
async function sharedSource() {
  const seed = await createChartWorkbook(data, false, context);
  const entries = inspectZip(seed).map((entry) => ({ name: entry.name, bytes: entry.payload }));
  for (const entry of entries) {
    let xml = decode(entry.bytes);
    if (entry.name.endsWith("sheet1.xml"))
      xml = `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="B1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>3</v></c></row></sheetData></worksheet>`;
    if (entry.name === "xl/_rels/workbook.xml.rels")
      xml = xml.replace(
        "</Relationships>",
        '<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'
      );
    if (entry.name === "[Content_Types].xml")
      xml = xml.replace(
        "</Types>",
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'
      );
    entry.bytes = encode(xml);
  }
  entries.push({
    name: "xl/sharedStrings.xml",
    bytes: encode(
      `<sst xmlns="${ns}" count="2" uniqueCount="2"><si><t>Old title</t></si><si><r><t>Old</t></r><r><t> label</t></r></si></sst>`
    )
  });
  const volume = Volume.fromJSON({ "/data.xlsx": Buffer.from(storedArchive(entries)) });
  return new Uint8Array(volume.readFileSync("/data.xlsx") as Buffer);
}
it("replaces shared and rich string cells with literal inline text and retires stale string counts", async () => {
  const source = await sharedSource();
  const next = inspectZip(await createChartWorkbook(data, false, context, { source }));
  expect(next.some((entry) => entry.name === "xl/sharedStrings.xml")).toBe(false);
  expect(
    decode(next.find((entry) => entry.name === "xl/_rels/workbook.xml.rels")!.payload)
  ).not.toContain("sharedStrings");
  expect(decode(next.find((entry) => entry.name === "[Content_Types].xml")!.payload)).not.toContain(
    "sharedStrings"
  );
  const sheet = decode(next.find((entry) => entry.name.endsWith("sheet1.xml"))!.payload);
  expect(sheet).toContain('<t xml:space="preserve">=2+2</t>');
  expect(sheet).toContain("  Bay &amp; &quot;fjord&quot; &lt;雪&gt;_x000D_");
  expect(sheet).not.toContain("<f>");
});
it("preserves tabs and line breaks inside number format attributes", async () => {
  const format = '0.0"\tunits\n"';
  const bytes = await createChartWorkbook(
    { categories: [1], series: [{ name: "Units", values: [2], numberFormat: format }] },
    false,
    context
  );
  const styles = parseXmlPart(
    inspectZip(bytes).find((entry) => entry.name.endsWith("styles.xml"))!.payload,
    context.xmlLimits
  );
  const formats = styles.root.children.find((node) => node.name.localName === "numFmts")!;
  expect(
    formats.children[0]!.attributes.find((a) => a.name.localName === "formatCode")!.value
  ).toBe('0.0"_x0009_units_x000A_"');
});
it.each(["calcChain", "externalLink", "connections"])(
  "rejects detached %s dependencies by content type",
  async (kind) => {
    const base = inspectZip(await createChartWorkbook(data, false, context)).map((entry) => ({
      name: entry.name,
      bytes: entry.payload
    }));
    const types = base.find((entry) => entry.name === "[Content_Types].xml")!;
    types.bytes = encode(
      decode(types.bytes).replace(
        "</Types>",
        `<Override PartName="/custom/dependency.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${kind}+xml"/></Types>`
      )
    );
    base.push({ name: "custom/dependency.xml", bytes: encode(`<${kind} xmlns="${ns}"/>`) });
    await expect(
      validateChartWorkbook(storedArchive(base), context).then(() => "accepted")
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  }
);

it("keeps literal escape-shaped labels distinct from encoded worksheet characters", async () => {
  const bytes = await createChartWorkbook(
    {
      categories: ["_x0041_ _x005f_ _x00aF_ _xZZZZ_"],
      series: [{ name: "_x000D_", values: [1], numberFormat: '0"_x0041_"' }]
    },
    false,
    context
  );
  const entries = inspectZip(bytes);
  const sheet = decode(entries.find((entry) => entry.name.endsWith("sheet1.xml"))!.payload);
  expect(sheet).toContain("_x005F_x0041_ _x005F_x005f_ _x005F_x00aF_ _xZZZZ_");
  expect(sheet).toContain("_x005F_x000D_");
  expect(decode(entries.find((entry) => entry.name.endsWith("styles.xml"))!.payload)).toContain(
    "0&quot;_x005F_x0041_&quot;"
  );
});
