import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPresentation, importSlides } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { parseXmlPart } from "./xml.js";

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
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const ct = "http://schemas.openxmlformats.org/package/2006/content-types";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function parts(bytes: Uint8Array): Map<string, Uint8Array> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((x) => [
      x.name,
      x.payload
    ])
  );
}
function archive(map: Map<string, Uint8Array>) {
  return storedArchive([...map].map(([name, bytes]) => ({ name, bytes })));
}
function attrs(bytes: Uint8Array, local: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      result.push(Object.fromEntries(Object.values(tag.attributes).map((x) => [x.name, x.value])));
  });
  parser.write(decoder.decode(bytes)).close();
  return result;
}
function append(map: Map<string, Uint8Array>, name: string, fragment: string) {
  const xml = parseXmlPart(map.get(name)!, context.xmlLimits);
  map.set(name, xml.spliceChildren(xml.root, xml.root.children.length, 0, [fragment]).bytes());
}
function relation(
  map: Map<string, Uint8Array>,
  owner: string,
  id: string,
  kind: string,
  target: string
) {
  const slash = owner.lastIndexOf("/");
  const name = `${owner.slice(0, slash)}/_rels/${owner.slice(slash + 1)}.rels`;
  if (!map.has(name)) map.set(name, encoder.encode(`<Relationships xmlns="${rel}"/>`));
  append(
    map,
    name,
    `<Relationship xmlns="${rel}" Id="${id}" Type="${r}/${kind}" Target="${target}"/>`
  );
}
function addPart(
  map: Map<string, Uint8Array>,
  name: string,
  type: string,
  content: string | Uint8Array
) {
  map.set(name, typeof content === "string" ? encoder.encode(content) : content);
  append(
    map,
    "[Content_Types].xml",
    `<Override xmlns="${ct}" PartName="/${name}" ContentType="${type}"/>`
  );
}
async function deck(label: string, notes = false) {
  const map = parts(
    await createPresentation(
      { slides: [{ name: label, shapes: [{ x: 10, y: 20, width: 30, height: 40, text: label }] }] },
      context
    )
  );
  addPart(
    map,
    "ppt/media/tile.png",
    "image/png",
    new Uint8Array([137, 80, 78, 71, ...encoder.encode(label)])
  );
  relation(map, "ppt/slides/slide1.xml", "tile", "image", "../media/tile.png");
  let theme = parseXmlPart(map.get("ppt/theme/theme1.xml")!, context.xmlLimits);
  theme = theme.merge(theme.root, {
    attributes: [{ namespace: "", localName: "name", value: "Shared palette" }]
  });
  const colors = theme.root.children[0]!.children.find(
    (node) => node.name.localName === "clrScheme"
  )!;
  theme = theme.merge(
    colors.children.find((node) => node.name.localName === "accent1")!.children[0]!,
    {
      attributes: [
        { namespace: "", localName: "val", value: label === "Amber" ? "DD8800" : "3322AA" }
      ]
    }
  );
  const fonts = theme.root.children[0]!.children.find(
    (node) => node.name.localName === "fontScheme"
  )!;
  theme = theme.merge(fonts.children[0]!.children[0]!, {
    attributes: [
      { namespace: "", localName: "typeface", value: label === "Amber" ? "Aptos" : "Georgia" }
    ]
  });
  map.set("ppt/theme/theme1.xml", theme.bytes());
  addPart(
    map,
    "ppt/charts/chart.xml",
    "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${r}"><c:chart/><c:externalData r:id="data"/></c:chartSpace>`
  );
  addPart(
    map,
    "ppt/embeddings/table.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    new Uint8Array([80, 75, 3, 4, ...encoder.encode(label)])
  );
  relation(map, "ppt/slides/slide1.xml", "chart", "chart", "../charts/chart.xml");
  relation(map, "ppt/charts/chart.xml", "data", "package", "../embeddings/table.xlsx");
  if (notes) {
    const tree =
      '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
    addPart(
      map,
      "ppt/notesSlides/note.xml",
      "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
      `<p:notes xmlns:p="${p}"><p:cSld name="Speaker">${tree}</p:cSld></p:notes>`
    );
    addPart(
      map,
      "ppt/notesMasters/master.xml",
      "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
      `<p:notesMaster xmlns:p="${p}"><p:cSld>${tree}</p:cSld><p:clrMap/></p:notesMaster>`
    );
    relation(map, "ppt/slides/slide1.xml", "notes", "notesSlide", "../notesSlides/note.xml");
    relation(map, "ppt/notesSlides/note.xml", "slide", "slide", "../slides/slide1.xml");
    relation(
      map,
      "ppt/notesSlides/note.xml",
      "master",
      "notesMaster",
      "../notesMasters/master.xml"
    );
    relation(map, "ppt/notesMasters/master.xml", "theme", "theme", "../theme/theme1.xml");
    relation(map, "ppt/presentation.xml", "notesMaster", "notesMaster", "notesMasters/master.xml");
    const xml = parseXmlPart(map.get("ppt/presentation.xml")!, context.xmlLimits);
    map.set(
      "ppt/presentation.xml",
      xml
        .spliceChildren(xml.root, 1, 0, [
          `<p:notesMasterIdLst xmlns:p="${p}" xmlns:r="${r}"><p:notesMasterId r:id="notesMaster"/></p:notesMasterIdLst>`
        ])
        .bytes()
    );
  }
  return map;
}
function target(map: Map<string, Uint8Array>, owner: string, kind: string) {
  return attrs(map.get(owner)!, "Relationship").find((x) => x.Type === `${r}/${kind}`)!.Target;
}

describe("cross-deck slide import", () => {
  beforeAll(() => {
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) =>
      delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
  });
  afterAll(() => vi.restoreAllMocks());
  it("copies the complete source graph and preserves unrelated destination hashes", async () => {
    const destination = await deck("Amber");
    const source = await deck("Indigo", true);
    const output = await importSlides(
      archive(destination),
      archive(source),
      { sourceSlides: [1] },
      context
    );
    expect(
      await importSlides(archive(destination), archive(source), { sourceSlides: [1] }, context)
    ).toEqual(output);
    const result = parts(output);
    for (const [name, bytes] of destination) {
      if (
        ["ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "[Content_Types].xml"].includes(
          name
        )
      )
        continue;
      expect(createHash("sha256").update(result.get(name)!).digest("hex"), name).toBe(
        createHash("sha256").update(bytes).digest("hex")
      );
    }
    expect(attrs(result.get("ppt/presentation.xml")!, "sldId").map((x) => x.id)).toEqual([
      "256",
      "257"
    ]);
    expect(attrs(result.get("ppt/presentation.xml")!, "sldMasterId").map((x) => x.id)).toEqual([
      "2147483648",
      "2147483649"
    ]);
    expect(attrs(result.get("ppt/presentation.xml")!, "notesMasterId")).toHaveLength(1);
    expect(target(result, "ppt/slides/_rels/slide1-import1.xml.rels", "slideLayout")).toBe(
      "../slideLayouts/slideLayout1-import1.xml"
    );
    expect(
      target(result, "ppt/slideLayouts/_rels/slideLayout1-import1.xml.rels", "slideMaster")
    ).toBe("../slideMasters/slideMaster1-import1.xml");
    expect(
      target(result, "ppt/slideMasters/_rels/slideMaster1-import1.xml.rels", "slideLayout")
    ).toBe("../slideLayouts/slideLayout1-import1.xml");
    expect(target(result, "ppt/slideMasters/_rels/slideMaster1-import1.xml.rels", "theme")).toBe(
      "../theme/theme1-import1.xml"
    );
    expect(target(result, "ppt/notesSlides/_rels/note-import1.xml.rels", "slide")).toBe(
      "../slides/slide1-import1.xml"
    );
    expect(target(result, "ppt/notesSlides/_rels/note-import1.xml.rels", "notesMaster")).toBe(
      "../notesMasters/master-import1.xml"
    );
    expect(target(result, "ppt/charts/_rels/chart-import1.xml.rels", "package")).toBe(
      "../embeddings/table-import1.xlsx"
    );
    expect(result.get("ppt/media/tile-import1.png")).toEqual(source.get("ppt/media/tile.png"));
    expect(result.get("ppt/embeddings/table-import1.xlsx")).toEqual(
      source.get("ppt/embeddings/table.xlsx")
    );
    expect(attrs(result.get("ppt/theme/theme1-import1.xml")!, "theme")[0]!.name).toBe(
      "Shared palette"
    );
    expect(attrs(result.get("ppt/theme/theme1.xml")!, "theme")[0]!.name).toBe("Shared palette");
    expect(
      attrs(result.get("ppt/theme/theme1-import1.xml")!, "srgbClr").some(
        (node) => node.val === "3322AA"
      )
    ).toBe(true);
    expect(attrs(result.get("ppt/theme/theme1-import1.xml")!, "latin")[0]!.typeface).toBe(
      "Georgia"
    );
    expect(
      attrs(result.get("ppt/slideMasters/slideMaster1-import1.xml")!, "sldLayoutId")[0]!.id
    ).toBe("2147483648");
    expect(attrs(result.get("ppt/charts/chart-import1.xml")!, "externalData")[0]!["r:id"]).not.toBe(
      "data"
    );
    expect(attrs(result.get("ppt/slides/slide1-import1.xml")!, "cNvPr").map((x) => x.id)).toEqual([
      "3",
      "4"
    ]);
    expect(attrs(result.get("ppt/slides/slide1-import1.xml")!, "off")[1]).toMatchObject({
      x: "10",
      y: "20"
    });
  });
  it.each(["sldSz", "notesSz"])(
    "requires explicit destination size policy for %s conflicts",
    async (name) => {
      const destination = await deck("Amber");
      const source = await deck("Indigo");
      const xml = parseXmlPart(source.get("ppt/presentation.xml")!, context.xmlLimits);
      source.set(
        "ppt/presentation.xml",
        xml
          .merge(xml.root.children.find((x) => x.name.localName === name)!, {
            attributes: [{ namespace: "", localName: "cx", value: "1234567" }]
          })
          .bytes()
      );
      await expect(
        importSlides(archive(destination), archive(source), { sourceSlides: [1] }, context)
      ).rejects.toMatchObject({ code: "unsupported-edit" });
      const result = parts(
        await importSlides(
          archive(destination),
          archive(source),
          { sourceSlides: [1], dimensionPolicy: "destination" },
          context
        )
      );
      expect(attrs(result.get("ppt/presentation.xml")!, name)).toEqual(
        attrs(destination.get("ppt/presentation.xml")!, name)
      );
      expect(attrs(result.get("ppt/slides/slide1-import1.xml")!, "ext")).toEqual(
        attrs(source.get("ppt/slides/slide1.xml")!, "ext")
      );
    }
  );
  it("rejects competing notes masters instead of changing inherited appearance", async () => {
    await expect(
      importSlides(
        archive(await deck("Amber", true)),
        archive(await deck("Indigo", true)),
        { sourceSlides: [1] },
        context
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("remaps selected cross-slide links and rejects links to unselected slides", async () => {
    const source = parts(
      await createPresentation({ slides: [{ name: "First" }, { name: "Second" }] }, context)
    );
    relation(source, "ppt/slides/slide1.xml", "jump", "slide", "slide2.xml");
    const destination = archive(await deck("Amber"));
    await expect(
      importSlides(destination, archive(source), { sourceSlides: [1] }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    const result = parts(
      await importSlides(
        destination,
        archive(source),
        { sourceSlides: [2, 1], position: 1 },
        context
      )
    );
    expect(attrs(result.get("ppt/presentation.xml")!, "sldId").map((x) => x.id)).toEqual([
      "257",
      "258",
      "256"
    ]);
    expect(target(result, "ppt/slides/_rels/slide1-import1.xml.rels", "slide")).toBe(
      "slide2-import1.xml"
    );
  });
  it("imports into an empty slide list", async () => {
    const result = parts(
      await importSlides(
        await createPresentation({}, context),
        archive(await deck("Indigo")),
        { sourceSlides: [1] },
        context
      )
    );
    expect(attrs(result.get("ppt/presentation.xml")!, "sldId")).toHaveLength(1);
  });
  it("allocates new names and independent master and layout IDs on repeat imports", async () => {
    const source = archive(await deck("Indigo"));
    const first = await importSlides(
      archive(await deck("Amber")),
      source,
      { sourceSlides: [1] },
      context
    );
    const second = parts(await importSlides(first, source, { sourceSlides: [1] }, context));
    expect(second.has("ppt/slides/slide1-import2.xml")).toBe(true);
    expect(second.has("ppt/media/tile-import2.png")).toBe(true);
    expect(
      attrs(second.get("ppt/presentation.xml")!, "sldMasterId").map((node) => node.id)
    ).toEqual(["2147483648", "2147483649", "2147483650"]);
    expect(
      attrs(second.get("ppt/slideMasters/slideMaster1-import2.xml")!, "sldLayoutId")[0]!.id
    ).toBe("2147483650");
    for (const [name, bytes] of parts(first))
      if (
        ![
          "ppt/presentation.xml",
          "ppt/_rels/presentation.xml.rels",
          "[Content_Types].xml"
        ].includes(name)
      )
        expect(second.get(name), name).toEqual(bytes);
  });
  it("retains Strict dialect and rejects implicit dialect conversion", async () => {
    const map = parts(await createPresentation({ slides: [{ name: "Snow" }] }, context));
    for (const [name, bytes] of map) {
      if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
      let text = decoder.decode(bytes);
      for (const [from, to] of [
        [p, "http://purl.oclc.org/ooxml/presentationml/main"],
        [a, "http://purl.oclc.org/ooxml/drawingml/main"],
        [r, "http://purl.oclc.org/ooxml/officeDocument/relationships"]
      ])
        text = text.split(from!).join(to!);
      map.set(name, encoder.encode(text));
    }
    const strict = archive(map);
    const result = parts(await importSlides(strict, strict, { sourceSlides: [1] }, context));
    expect(decoder.decode(result.get("ppt/slides/slide1-import1.xml"))).toContain(
      "http://purl.oclc.org/ooxml/presentationml/main"
    );
    const transitional = await createPresentation({ slides: [{ name: "Sun" }] }, context);
    await expect(
      importSlides(transitional, strict, { sourceSlides: [1] }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    await expect(
      importSlides(strict, transitional, { sourceSlides: [1] }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it.each(["defaultTextStyle", "embeddedFontLst"])(
    "rejects unresolved global appearance dependency %s without mutating inputs",
    async (kind) => {
      const destination = await deck("Amber");
      const source = await deck("Indigo");
      append(
        source,
        "ppt/presentation.xml",
        kind === "defaultTextStyle"
          ? `<p:defaultTextStyle xmlns:p="${p}" xmlns:a="${a}"><a:lvl1pPr><a:defRPr sz="4000"/></a:lvl1pPr></p:defaultTextStyle>`
          : `<p:embeddedFontLst xmlns:p="${p}"><p:embeddedFont><p:font typeface="Cloud"/></p:embeddedFont></p:embeddedFontLst>`
      );
      const left = archive(destination),
        right = archive(source);
      const hashes = [left, right].map((bytes) => createHash("sha256").update(bytes).digest("hex"));
      await expect(importSlides(left, right, { sourceSlides: [1] }, context)).rejects.toMatchObject(
        { code: "unsupported-edit" }
      );
      expect(
        [left, right].map((bytes) => createHash("sha256").update(bytes).digest("hex"))
      ).toEqual(hashes);
    }
  );
  it("accepts equivalent global text defaults with different namespace prefixes", async () => {
    const left = await deck("Amber"),
      right = await deck("Indigo");
    append(
      left,
      "ppt/presentation.xml",
      `<p:defaultTextStyle xmlns:p="${p}" xmlns:a="${a}"><a:lvl1pPr><a:defRPr sz="2200"/></a:lvl1pPr></p:defaultTextStyle>`
    );
    append(
      right,
      "ppt/presentation.xml",
      `<s:defaultTextStyle xmlns:s="${p}" xmlns:d="${a}"><d:lvl1pPr><d:defRPr sz="2200"/></d:lvl1pPr></s:defaultTextStyle>`
    );
    expect(
      parts(await importSlides(archive(left), archive(right), { sourceSlides: [1] }, context)).has(
        "ppt/slides/slide1-import1.xml"
      )
    ).toBe(true);
  });
  it("rejects matching opaque text defaults rather than assuming their references are equivalent", async () => {
    const left = await deck("Amber"),
      right = await deck("Indigo");
    for (const map of [left, right])
      append(
        map,
        "ppt/presentation.xml",
        `<p:defaultTextStyle xmlns:p="${p}" xmlns:a="${a}"><a:extLst><a:ext uri="urn:opaque"/></a:extLst></p:defaultTextStyle>`
      );
    await expect(
      importSlides(archive(left), archive(right), { sourceSlides: [1] }, context).then(
        () => "success"
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("snapshots options before awaiting caller-supplied bytes", async () => {
    const source = archive(await deck("Indigo"));
    const destination = archive(await deck("Amber"));
    const options = { sourceSlides: [1], position: 1 };
    let offset = 0;
    const input = {
      async read(maxBytes: number) {
        options.sourceSlides[0] = 99;
        options.position = 99;
        if (offset === destination.length) return null;
        const chunk = destination.slice(offset, offset + maxBytes);
        offset += chunk.length;
        return chunk;
      }
    };
    const result = parts(await importSlides(input, source, options, context));
    expect(attrs(result.get("ppt/presentation.xml")!, "sldId").map((node) => node.id)).toEqual([
      "257",
      "256"
    ]);
  });
  it.each(["table-style", "unknown-relation", "extension", "signed-relation"])(
    "rejects unsafe dependency %s",
    async (kind) => {
      const source = await deck("Indigo");
      if (kind === "table-style")
        append(
          source,
          "ppt/slides/slide1.xml",
          `<a:tableStyleId xmlns:a="${a}">{ABCD}</a:tableStyleId>`
        );
      if (kind === "unknown-relation")
        relation(source, "ppt/slides/slide1.xml", "opaque", "unmapped", "../media/tile.png");
      if (kind === "extension")
        append(
          source,
          "ppt/slides/slide1.xml",
          `<p:extLst xmlns:p="${p}"><p:ext uri="urn:opaque"/></p:extLst>`
        );
      if (kind === "signed-relation")
        append(
          source,
          "_rels/.rels",
          `<Relationship xmlns="${rel}" Id="signature" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin" Target="ppt/media/tile.png"/>`
        );
      await expect(
        importSlides(archive(await deck("Amber")), archive(source), { sourceSlides: [1] }, context)
      ).rejects.toMatchObject({ code: "unsupported-edit" });
    }
  );
  it("preserves external hyperlink text without fetching it and remaps its local ID", async () => {
    const source = await deck("Indigo");
    append(
      source,
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationship xmlns="${rel}" Id="website" Type="${r}/hyperlink" Target="https://example.invalid/help?x=1&amp;y=2" TargetMode="External"/>`
    );
    append(
      source,
      "ppt/slides/slide1.xml",
      `<a:hlinkClick xmlns:a="${a}" xmlns:r="${r}" r:id="website"/>`
    );
    const result = parts(
      await importSlides(
        archive(await deck("Amber")),
        archive(source),
        { sourceSlides: [1] },
        context
      )
    );
    const edge = attrs(
      result.get("ppt/slides/_rels/slide1-import1.xml.rels")!,
      "Relationship"
    ).find((node) => node.Type === `${r}/hyperlink`)!;
    expect(edge).toMatchObject({
      Target: "https://example.invalid/help?x=1&y=2",
      TargetMode: "External"
    });
    expect(attrs(result.get("ppt/slides/slide1-import1.xml")!, "hlinkClick")[0]!["r:id"]).toBe(
      edge.Id
    );
    expect(edge.Id).not.toBe("website");
  });
  it("rejects a sparse slide selection with a typed error before reading input", async () => {
    await expect(
      importSlides(
        new Uint8Array(),
        new Uint8Array(),
        { sourceSlides: new Array<number>(1) },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value", phase: "usage" });
  });
  it.each([
    { sourceSlides: [] },
    { sourceSlides: [0] },
    { sourceSlides: [1, 1] },
    { sourceSlides: [2] },
    { sourceSlides: [1], position: 0 },
    { sourceSlides: [1], position: 3 },
    { sourceSlides: [1], themePolicy: "destination" }
  ])("rejects invalid or unsupported import options %j", async (options) => {
    const input = archive(await deck("Amber"));
    await expect(
      importSlides(input, input, options as Parameters<typeof importSlides>[2], context)
    ).rejects.toBeDefined();
  });
});
