import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDeckFixture } from "../tests/fixtures/decks.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { inspectZip } from "../tests/zip-reader.js";
import { readCharts } from "./charts.js";
import { replacePresentationText } from "./text-replacement.js";
import { parseXmlPart } from "./xml.js";
import { writePackageArchive } from "./package-writer.js";

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
const encode = (value: string) => new TextEncoder().encode(value);
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

it("preserves opaque chart extensions, workbook bytes and external targets through a text edit", async () => {
  const { volume, root } = createDeckFixture("seed-library");
  const chartPath = `${root}/ppt/charts/chart1.xml`;
  const original = parseXmlPart(
    new Uint8Array(volume.readFileSync(chartPath) as Buffer),
    context.xmlLimits
  );
  volume.writeFileSync(
    chartPath,
    original
      .spliceChildren(original.root, original.root.children.length, 0, [
        '<c:externalData xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="data"><c:autoUpdate val="0"/></c:externalData>',
        '<c:extLst xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:ext uri="urn:chart-extra"><u:future xmlns:u="urn:chart-extra" spacing="  retained  "><!--keep--><u:value>Borrow seeds.</u:value></u:future></c:ext></c:extLst>'
      ])
      .bytes()
  );
  volume.mkdirSync(`${root}/ppt/charts/_rels`, { recursive: true });
  volume.writeFileSync(
    `${root}/ppt/charts/_rels/chart1.xml.rels`,
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="data" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/data.xlsx"/><Relationship Id="remote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.invalid/data?x=1&amp;y=2" TargetMode="External"/></Relationships>'
  );
  volume.mkdirSync(`${root}/ppt/embeddings`, { recursive: true });
  volume.writeFileSync(
    `${root}/ppt/embeddings/data.xlsx`,
    storedArchive([
      {
        name: "xl/workbook.xml",
        bytes: encode(
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>'
        )
      }
    ])
  );
  const typesPath = `${root}/[Content_Types].xml`;
  const types = parseXmlPart(
    new Uint8Array(volume.readFileSync(typesPath) as Buffer),
    context.xmlLimits
  );
  volume.writeFileSync(
    typesPath,
    types
      .spliceChildren(types.root, types.root.children.length, 0, [
        '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/embeddings/data.xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>'
      ])
      .bytes()
  );
  const source = await writePackageArchive(
    Object.keys(volume.toJSON()).map((path) => ({
      name: path.slice(root.length + 1),
      bytes: new Uint8Array(volume.readFileSync(path) as Buffer)
    })),
    context,
    { compression: "store" }
  );
  const inputHash = createHash("sha256").update(source).digest("hex");
  const before = await readCharts(source, {}, context);
  expect(before).toHaveLength(1);
  expect(before[0]!.links).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "workbook",
        authoritative: true,
        targetPart: "/ppt/embeddings/data.xlsx"
      }),
      expect.objectContaining({
        external: true,
        target: "https://example.invalid/data?x=1&y=2",
        authoritative: false
      })
    ])
  );
  expect(before[0]!.unsupported.some((node) => node.xml.includes('spacing="  retained  "'))).toBe(
    true
  );
  const changed = await replacePresentationText(
    source,
    { find: "Borrow seeds.", with: "Share seeds.", all: true },
    context
  );
  expect(changed.affected).toBe(1);
  const originalParts = inspectZip(source);
  const resultParts = inspectZip(changed.bytes);
  expect(resultParts.map((part) => part.name)).toEqual(originalParts.map((part) => part.name));
  for (const part of originalParts.filter((entry) => entry.name !== "ppt/slides/slide1.xml")) {
    expect(resultParts.find((entry) => entry.name === part.name)!.payload).toEqual(part.payload);
  }
  const after = await readCharts(changed.bytes, {}, context);
  expect(after[0]!.xml).toBe(before[0]!.xml);
  expect(after[0]!.links).toEqual(before[0]!.links);
  expect(createHash("sha256").update(source).digest("hex")).toBe(inputHash);
});
