import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { addLayout, applyLayout, readLayouts, removeLayout } from "./layouts.js";
import { addSlide } from "./slides.js";
import { writePackageArchive } from "./package-writer.js";
import { parseXmlPart } from "./xml.js";
import { inspectZip } from "../tests/zip-reader.js";

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
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, ms?: number) =>
    ms === 0 ? setImmediate(cb) : timer(cb, ms)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

async function authoredPart(bytes: Uint8Array, name: string, content: string) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  const entries = inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer));
  return writePackageArchive(
    entries.map((entry) => ({
      name: entry.name,
      bytes: entry.name === name ? new TextEncoder().encode(content) : entry.payload
    })),
    context,
    { compression: "store" }
  );
}
function placeholder(
  kind: string,
  type: string | undefined,
  index: number | undefined,
  geometry = ""
) {
  const nv = kind === "pic" ? "nvPicPr" : kind === "graphicFrame" ? "nvGraphicFramePr" : "nvSpPr";
  const properties =
    kind === "pic" ? "cNvPicPr" : kind === "graphicFrame" ? "cNvGraphicFramePr" : "cNvSpPr";
  const drawing =
    kind === "graphicFrame"
      ? '<p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="urn:local:payload"/></a:graphic>'
      : `${kind === "pic" ? "<p:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></p:blipFill>" : ""}<p:spPr>${geometry}</p:spPr>`;
  return `<p:${kind} xmlns:p="${p}" xmlns:a="${a}"><p:${nv}><p:cNvPr id="2" name="Evidence"/><p:${properties}/><p:nvPr><p:ph${type === undefined ? "" : ` type="${type}"`}${index === undefined ? "" : ` idx="${index}"`}/></p:nvPr></p:${nv}>${drawing}</p:${kind}>`;
}
async function withPlaceholder(bytes: Uint8Array, part: string, fragment: string) {
  const original = inspectZip(bytes).find((entry) => entry.name === part)!;
  const xml = parseXmlPart(original.payload, context.xmlLimits);
  const common = xml.root.children.find((node) => node.name.localName === "cSld")!;
  const tree = common.children.find((node) => node.name.localName === "spTree")!;
  return authoredPart(
    bytes,
    part,
    new TextDecoder().decode(xml.spliceChildren(tree, tree.children.length, 0, [fragment]).bytes())
  );
}

describe("layout inspection and inherited values", () => {
  it("reads layout order from the registered list rather than archive or relationship order", async () => {
    const input = await createPresentation({}, context);
    const added = await addLayout(
      input,
      { scope: "layouts", master: "Original master", name: "Second" },
      context
    );
    const part = "ppt/slideMasters/slideMaster1.xml";
    const payload = inspectZip(added.bytes).find((entry) => entry.name === part)!.payload;
    const xml = parseXmlPart(payload, context.xmlLimits);
    const list = xml.root.children.find((node) => node.name.localName === "sldLayoutIdLst")!;
    const reversed = xml.spliceChildren(list, 0, list.children.length, [
      '<p:sldLayoutId xmlns:p="' +
        p +
        '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" id="2147483650" r:id="rId3"/>',
      '<p:sldLayoutId xmlns:p="' +
        p +
        '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" id="2147483649" r:id="rId1"/>'
    ]);
    const bytes = await authoredPart(added.bytes, part, new TextDecoder().decode(reversed.bytes()));
    expect((await readLayouts(bytes, context)).map((record) => record.name)).toEqual([
      "Second",
      "Blank"
    ]);
  });
  it.each([
    ["sp", undefined, undefined, "obj", 0],
    ["sp", undefined, 1, "obj", 1],
    ["sp", "title", undefined, "title", 0],
    ["sp", "title", 0, "title", 0],
    ["sp", "body", 3, "body", 3],
    ["pic", "pic", 6, "pic", 6],
    ["graphicFrame", "tbl", 9, "tbl", 9]
  ] as const)(
    "reads sparse placeholder defaults and identity for %s %s %s",
    async (kind, type, index, expectedType, expectedIndex) => {
      const bytes = await createPresentation({}, context);
      const changed = await withPlaceholder(
        bytes,
        "ppt/slideLayouts/slideLayout1.xml",
        placeholder(kind, type, index)
      );
      expect((await readLayouts(changed, context))[0]!.placeholders).toMatchObject([
        { shapeId: "2", name: "Evidence", type: expectedType, index: expectedIndex }
      ]);
      if (kind === "graphicFrame")
        expect((await readLayouts(changed, context))[0]!.placeholders[0]).toMatchObject({
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          provenance: { x: "layout", y: "layout", width: "layout", height: "layout" }
        });
    }
  );

  it.each([
    "body",
    "tbl",
    "obj",
    "title",
    "ctrTitle",
    "subTitle",
    "chart",
    "clipArt",
    "dgm",
    "media",
    "pic"
  ])("resolves %s geometry through its master type category", async (type) => {
    let bytes = await createPresentation({}, context);
    bytes = await withPlaceholder(
      bytes,
      "ppt/slideMasters/slideMaster1.xml",
      placeholder(
        "sp",
        ["title", "ctrTitle"].includes(type) ? "title" : "body",
        9,
        '<a:xfrm><a:off x="12" y="34"/><a:ext cx="56" cy="78"/></a:xfrm>'
      )
    );
    bytes = await withPlaceholder(
      bytes,
      "ppt/slideLayouts/slideLayout1.xml",
      placeholder("sp", type, 0)
    );
    const record = (await readLayouts(bytes, context))[0]!.placeholders[0]!;
    expect(record).toMatchObject({
      x: 12,
      y: 34,
      width: 56,
      height: 78,
      provenance: { x: "master", y: "master", width: "master", height: "master" }
    });
  });

  it.each([
    ["x", 12],
    ["y", 34],
    ["width", 56],
    ["height", 78]
  ] as const)("keeps the explicit %s coordinate %i ahead of its master", async (key, expected) => {
    let bytes = await createPresentation({}, context);
    bytes = await withPlaceholder(
      bytes,
      "ppt/slideMasters/slideMaster1.xml",
      placeholder(
        "sp",
        "body",
        0,
        '<a:xfrm><a:off x="42" y="42"/><a:ext cx="42" cy="42"/></a:xfrm>'
      )
    );
    const added = await addLayout(
      bytes,
      {
        scope: "layouts",
        master: "Original master",
        name: "Override",
        placeholders: [{ type: "body", [key]: expected }]
      },
      context
    );
    const record = (await readLayouts(added.bytes, context)).find(
      (layout) => layout.name === "Override"
    )!.placeholders[0]!;
    expect(record[key]).toBe(expected);
    expect(record.provenance[key]).toBe("layout");
  });

  it.each(["x", "y", "width", "height"] as const)(
    "reads inherited %s as 42 and absent ownership as null",
    async (key) => {
      const original = await createPresentation({}, context);
      const missing = await withPlaceholder(
        original,
        "ppt/slideLayouts/slideLayout1.xml",
        placeholder("sp", "body", 0)
      );
      expect((await readLayouts(missing, context))[0]!.placeholders[0]![key]).toBeNull();
      const present = await withPlaceholder(
        missing,
        "ppt/slideMasters/slideMaster1.xml",
        placeholder(
          "sp",
          "body",
          0,
          '<a:xfrm><a:off x="42" y="42"/><a:ext cx="42" cy="42"/></a:xfrm>'
        )
      );
      const record = (await readLayouts(present, context))[0]!.placeholders[0]!;
      expect(record[key]).toBe(42);
      expect(record.provenance[key]).toBe("master");
    }
  );

  it("preserves zero overrides and missing geometry without manufacturing values", async () => {
    let bytes = await createPresentation({}, context);
    bytes = await withPlaceholder(
      bytes,
      "ppt/slideMasters/slideMaster1.xml",
      placeholder("sp", "body", 0, '<a:xfrm><a:off x="42" y="42"/></a:xfrm>')
    );
    bytes = await withPlaceholder(
      bytes,
      "ppt/slideLayouts/slideLayout1.xml",
      placeholder("sp", "body", 0, '<a:xfrm><a:off x="0" y="0"/></a:xfrm>')
    );
    expect((await readLayouts(bytes, context))[0]!.placeholders[0]).toMatchObject({
      x: 0,
      y: 0,
      width: null,
      height: null,
      provenance: { x: "layout", y: "layout", width: null, height: null }
    });
  });

  it.each([[[]], [[1]], [[2]], [[1, 2]]])(
    "reports exactly the slides using a layout: %j",
    async (positions) => {
      let bytes = await createPresentation({ slides: [{}, {}] }, context);
      const added = await addLayout(
        bytes,
        { scope: "layouts", master: "Original master", name: "Chosen" },
        context
      );
      bytes = added.bytes;
      for (const position of positions)
        bytes = (
          await applyLayout(
            bytes,
            {
              selection: {
                kind: "slide",
                position: { coordinateSystem: "one-based", value: position }
              },
              layout: "Chosen",
              placeholderPolicy: "type-index"
            },
            context
          )
        ).bytes;
      expect(
        (await readLayouts(bytes, context)).find((record) => record.name === "Chosen")!
          .affectedSlides
      ).toEqual(positions);
    }
  );

  it.each([0, 1, 2])("retains registered layout collection length %i", async (count) => {
    let bytes = await createPresentation({}, context);
    if (count === 0)
      bytes = (await removeLayout(bytes, { scope: "layouts", layout: "Blank" }, context)).bytes;
    if (count === 2)
      bytes = (
        await addLayout(
          bytes,
          { scope: "layouts", master: "Original master", name: "Other" },
          context
        )
      ).bytes;
    expect(await readLayouts(bytes, context)).toHaveLength(count);
  });

  it.each([
    [
      ["title", "body"],
      ["title", "body"]
    ],
    [["title", "dt"], ["title"]],
    [["ftr", "obj"], ["obj"]],
    [["sldNum", "ftr"], []]
  ])("inserts only nonlatent placeholders from %j", async (types, expected) => {
    const input = await createPresentation({}, context);
    const added = await addLayout(
      input,
      {
        scope: "layouts",
        master: "Original master",
        name: "Source",
        placeholders: types.map((type, index) => ({ type, index }))
      },
      context
    );
    const bytes = await addSlide(added.bytes, { layout: "Source" }, context);
    const slide = inspectZip(bytes).find((entry) => entry.name === "ppt/slides/slide1.xml")!;
    const xml = parseXmlPart(slide.payload, context.xmlLimits);
    const found: string[] = [];
    const pending = [xml.root];
    while (pending.length) {
      const node = pending.shift()!;
      if (node.name.localName === "ph")
        found.push(
          node.attributes.find((attribute) => attribute.name.localName === "type")?.value ?? "obj"
        );
      pending.push(...node.children);
    }
    expect(found).toEqual(expected);
  });
});
