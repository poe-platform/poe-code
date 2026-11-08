import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation, importSlides, readCharts } from "./index.js";
import { parseXmlPart } from "./xml.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";

const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

const c = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const cx = "http://schemas.microsoft.com/office/drawing/2014/chartex";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const cs = "http://schemas.microsoft.com/office/drawing/2012/chartStyle";
const ct = "http://schemas.openxmlformats.org/package/2006/content-types";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const archive = (parts: Map<string, Uint8Array>) =>
  storedArchive([...parts].map(([name, bytes]) => ({ name, bytes })));
function append(parts: Map<string, Uint8Array>, name: string, fragment: string) {
  const xml = parseXmlPart(parts.get(name)!, context.xmlLimits);
  parts.set(name, xml.spliceChildren(xml.root, xml.root.children.length, 0, [fragment]).bytes());
}
async function fixture(extended = false, extra = "") {
  const base = await createPresentation({ slides: [{ name: "Chart gallery" }] }, context);
  const volume = Volume.fromJSON({ "/deck": Buffer.from(base) });
  const parts = new Map<string, Uint8Array>(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((part) => [
      part.name,
      part.payload
    ])
  );
  const add = (name: string, type: string, content: string | Uint8Array) => {
    parts.set(name, typeof content === "string" ? encoder.encode(content) : content);
    append(
      parts,
      "[Content_Types].xml",
      `<Override xmlns="${ct}" PartName="/${name}" ContentType="${type}"/>`
    );
  };
  add(
    "ppt/charts/chart.xml",
    extended
      ? "application/vnd.ms-office.chartex+xml"
      : "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
    extended
      ? `<cx:chartSpace xmlns:cx="${cx}" xmlns:r="${r}"><cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="waterfall"/></cx:plotAreaRegion></cx:plotArea></cx:chart><cx:externalData r:id="data"/>${extra}</cx:chartSpace>`
      : `<c:chartSpace xmlns:c="${c}" xmlns:r="${r}"><!-- lexical preservation --><c:chart><c:plotArea><c:bar3DChart/><c:lineChart><c:ser><c:trendline><c:trendlineType val='linear'/></c:trendline><c:errBars><c:errDir val="y"/></c:errBars></c:ser></c:lineChart></c:plotArea></c:chart><c:externalData r:id='data'/><c:extLst><c:ext uri="urn:retained-style"><c14:style xmlns:c14="http://schemas.microsoft.com/office/drawing/2007/8/2/chart" val="102"/></c:ext></c:extLst>${extra}</c:chartSpace>`
  );
  add(
    "ppt/charts/style.xml",
    "application/vnd.ms-office.chartstyle+xml",
    `<cs:chartStyle xmlns:cs="${cs}" id='102'/>`
  );
  add(
    "ppt/charts/colors.xml",
    "application/vnd.ms-office.chartcolorstyle+xml",
    `<cs:colorStyle xmlns:cs="${cs}" id="10" meth="cycle"/>`
  );
  add(
    "ppt/embeddings/data.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    new Uint8Array([80, 75, 3, 4, 8, 6, 4, 2])
  );
  parts.set(
    "ppt/charts/_rels/chart.xml.rels",
    encoder.encode(
      `<Relationships xmlns="${rel}"><Relationship Id="data" Type="${r}/package" Target="../embeddings/data.xlsx"/><Relationship Id="style" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="style.xml"/><Relationship Id="colors" Type="http://schemas.microsoft.com/office/2011/relationships/chartColorStyle" Target="colors.xml"/></Relationships>`
    )
  );
  append(
    parts,
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationship xmlns="${rel}" Id="chart" Type="${extended ? "http://schemas.microsoft.com/office/2014/relationships/chartEx" : `${r}/chart`}" Target="../charts/chart.xml"/>`
  );
  const slide = parseXmlPart(parts.get("ppt/slides/slide1.xml")!, context.xmlLimits);
  const tree = slide.root.children
    .find((node) => node.name.localName === "cSld")!
    .children.find((node) => node.name.localName === "spTree")!;
  parts.set(
    "ppt/slides/slide1.xml",
    slide
      .spliceChildren(tree, tree.children.length, 0, [
        `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${r}"><p:nvGraphicFramePr><p:cNvPr id="5" name="Quarterly view"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="${extended ? cx : c}"><${extended ? "cx" : "c"}:chart xmlns:${extended ? "cx" : "c"}="${extended ? cx : c}" r:id="chart"/></a:graphicData></a:graphic></p:graphicFrame>`
      ])
      .bytes()
  );
  return parts;
}

it.each([false, true])(
  "imports chart resource closure with exact opaque hashes (extended=%s)",
  async (extended) => {
    const source = await fixture(extended);
    const destination = await fixture();
    const sourceBytes = archive(source);
    const before = hash(sourceBytes);
    const output = await importSlides(
      archive(destination),
      sourceBytes,
      { sourceSlides: [1] },
      context
    );
    expect((await readCharts(output, { slide: 2 }, context))[0]!.chartPart).toBe(
      "/ppt/charts/chart-import1.xml"
    );
    const result = new Map(inspectZip(output).map((part) => [part.name, part.payload]));
    for (const name of [
      "ppt/charts/chart.xml",
      "ppt/charts/style.xml",
      "ppt/charts/colors.xml",
      "ppt/embeddings/data.xlsx"
    ]) {
      const dot = name.lastIndexOf(".");
      expect(hash(result.get(`${name.slice(0, dot)}-import1${name.slice(dot)}`)!), name).toBe(
        hash(source.get(name)!)
      );
      expect(hash(result.get(name)!), `destination ${name}`).toBe(hash(destination.get(name)!));
    }
    const records: Record<string, string>[] = [];
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", (tag) => {
      if (tag.local === "Relationship")
        records.push(
          Object.fromEntries(Object.values(tag.attributes).map((a) => [a.local, a.value]))
        );
    });
    parser.write(decoder.decode(result.get("ppt/charts/_rels/chart-import1.xml.rels"))).close();
    expect(records.map(({ Id, Target }) => ({ Id, Target }))).toEqual([
      { Id: "data", Target: "../embeddings/data-import1.xlsx" },
      { Id: "style", Target: "style-import1.xml" },
      { Id: "colors", Target: "colors-import1.xml" }
    ]);
    for (const record of records)
      expect(
        result.has(
          new URL(
            record.Target!,
            "https://package.invalid/ppt/charts/chart-import1.xml"
          ).pathname.slice(1)
        )
      ).toBe(true);
    expect(hash(sourceBytes)).toBe(before);
  }
);

it.each([
  '<u:target xmlns:u="urn:unknown" slideId="256"/>',
  '<c:externalData r:id="missing"/>',
  '<c:chart xmlns:u="urn:unknown" u:part="../slides/slide1.xml"/>',
  '<c:chart xml:base="../slides/"/>',
  '<c:chart spid="5"/>'
])("rejects chart XML whose references cannot safely remain local: %s", async (extra) => {
  const source = archive(await fixture(false, extra));
  const before = hash(source);
  const destination = await createPresentation({ slides: [] }, context);
  await expect(
    importSlides(destination, source, { sourceSlides: [1] }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(hash(source)).toBe(before);
});

it.each(["resource-root", "slide-dependency"])(
  "rejects unsafe chart resource graph %s",
  async (kind) => {
    const parts = await fixture();
    if (kind === "resource-root") {
      parts.set("ppt/charts/style.xml", encoder.encode(`<c:chartSpace xmlns:c="${c}"/>`));
    } else {
      append(
        parts,
        "ppt/charts/_rels/chart.xml.rels",
        `<Relationship xmlns="${rel}" Id="jump" Type="${r}/slide" Target="../slides/slide1.xml"/>`
      );
    }
    const source = archive(parts);
    const before = hash(source);
    const destination = await createPresentation({ slides: [] }, context);
    await expect(
      importSlides(destination, source, { sourceSlides: [1] }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit", phase: "validate-intent" });
    expect(hash(source)).toBe(before);
  }
);
