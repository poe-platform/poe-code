import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { addSlide, createPresentation } from "./index.js";
import { writePackageArchive } from "./package-writer.js";
import { storedArchive } from "../tests/fixtures/archive.js";
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
const layout = "/ppt/slideLayouts/slideLayout1.xml";
function parts(bytes: Uint8Array) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map(({ name, payload }) => [
      name,
      new TextDecoder().decode(payload)
    ])
  );
}
function nodes(xml: string, local: string) {
  const found: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      found.push(Object.fromEntries(Object.values(tag.attributes).map((x) => [x.name, x.value])));
  });
  parser.write(xml).close();
  return found;
}
function placeholder(type: string, idx: number, id: number) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Slot ${id}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}" idx="${idx}"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="2"/><a:r><a:t>Layout prompt</a:t></a:r></a:p></p:txBody></p:sp>`;
}
async function fixture(shapes = "", count = 2, replacements: Record<string, string> = {}) {
  const original = parts(
    await createPresentation(
      {
        slides: Array.from({ length: count }, (_, i) => ({
          name: `Existing ${i}`,
          shapes: [{ x: 0, y: 0, width: 100, height: 100, text: `Text ${i}` }]
        }))
      },
      context
    )
  );
  if (shapes)
    original.set(
      layout.slice(1),
      `<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" type="cust"><p:cSld name="Sparse"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sldLayout>`
    );
  for (const [name, value] of Object.entries(replacements)) original.set(name, value);
  return writePackageArchive(
    [...original].map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })),
    context,
    { compression: "store" }
  );
}

describe("slide insertion", () => {
  it.each([1, 2, 3])(
    "inserts at boundary %s without changing existing slide IDs or drawings",
    async (position) => {
      const source = await fixture();
      const output = parts(
        await addSlide(source, { layout: "Blank", position, name: "Inserted" }, context)
      );
      const before = parts(source);
      const ids = nodes(output.get("ppt/presentation.xml")!, "sldId").map((n) => n.id);
      const expected = ["256", "257"];
      expected.splice(position - 1, 0, "258");
      expect(ids).toEqual(expected);
      for (const name of [
        "ppt/slides/slide1.xml",
        "ppt/slides/slide2.xml",
        layout.slice(1),
        "ppt/slideMasters/slideMaster1.xml"
      ])
        expect(output.get(name)).toBe(before.get(name));
      expect(nodes(output.get("ppt/slides/slide3.xml")!, "cNvPr").map((n) => n.id)).toEqual(["1"]);
      expect(nodes(output.get("ppt/slides/_rels/slide3.xml.rels")!, "Relationship")).toEqual([
        expect.objectContaining({
          Id: "rId1",
          Target: "../slideLayouts/slideLayout1.xml",
          Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"
        })
      ]);
    }
  );
  it("inserts into an empty deck and appends when position is absent", async () => {
    const output = parts(await addSlide(await fixture("", 0), { layout }, context));
    expect(nodes(output.get("ppt/presentation.xml")!, "sldId")).toEqual([
      expect.objectContaining({ id: "256" })
    ]);
    const appended = parts(await addSlide(await fixture(), { layout }, context));
    expect(nodes(appended.get("ppt/presentation.xml")!, "sldId").map((n) => n.id)).toEqual([
      "256",
      "257",
      "258"
    ]);
  });
  it.each([0, -1, 4, 1.5, NaN, Infinity])(
    "rejects invalid insertion position %s",
    async (position) => {
      await expect(addSlide(await fixture(), { layout, position }, context)).rejects.toMatchObject({
        code: "invalid-value"
      });
    }
  );
  it("populates sparse typed placeholders while retaining inherited layout geometry and text defaults", async () => {
    const source = await fixture(placeholder("ctrTitle", 17, 42) + placeholder("body", 29, 93));
    const output = parts(
      await addSlide(
        source,
        { layout: "Sparse", title: "New & bright", body: "Line one\nLine two\vSoft" },
        context
      )
    );
    const xml = output.get("ppt/slides/slide3.xml")!;
    expect(nodes(xml, "ph")).toEqual([
      { type: "ctrTitle", idx: "17" },
      { type: "body", idx: "29" }
    ]);
    expect(nodes(xml, "cNvPr").map((n) => n.id)).toEqual(["1", "2", "3"]);
    expect(nodes(xml, "xfrm")).toHaveLength(0);
    expect(xml).not.toContain("Layout prompt");
    expect(xml).toContain("New &amp; bright");
    expect(xml).toContain("Line two");
    expect(nodes(xml, "br")).toHaveLength(1);
    expect(output.get(layout.slice(1))).toBe(parts(source).get(layout.slice(1)));
  });
  it("selects repeated placeholder types using explicit sparse indices", async () => {
    const source = await fixture(placeholder("body", 4, 2) + placeholder("body", 27, 3));
    const output = parts(
      await addSlide(
        source,
        { layout, placeholders: [{ type: "body", index: 27, text: "Specific" }] },
        context
      )
    );
    expect(output.get("ppt/slides/slide3.xml")).toContain("Specific");
    await expect(addSlide(source, { layout, body: "Ambiguous" }, context)).rejects.toMatchObject({
      code: "ambiguous-selection"
    });
  });
  it("rejects duplicated placeholder keys and duplicate assignments", async () => {
    await expect(
      addSlide(
        await fixture(placeholder("body", 4, 2) + placeholder("body", 4, 3)),
        { layout },
        context
      )
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
    await expect(
      addSlide(
        await fixture(placeholder("title", 7, 2)),
        { layout, title: "One", placeholders: [{ type: "title", index: 7, text: "Two" }] },
        context
      )
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
  });
  it("rejects missing layouts and missing placeholders without changing input", async () => {
    const source = await fixture();
    const snapshot = source.slice();
    await expect(addSlide(source, { layout: "Absent" }, context)).rejects.toMatchObject({
      code: "missing-selection"
    });
    await expect(addSlide(source, { layout, title: "No title" }, context)).rejects.toMatchObject({
      code: "missing-selection"
    });
    expect(source).toEqual(snapshot);
  });
  it.each([
    [[], 256],
    [[256], 257],
    [[256, 712], 713],
    [[280, 257], 281],
    [[2147483646], 2147483647],
    [[2147483647], 256],
    [[256, 2147483647], 257],
    [[256, 2147483647, 257], 258]
  ] as const)("allocates the next available slide ID from %j", async (existing, expected) => {
    const sourceParts = parts(await fixture("", existing.length));
    let xml = parseXmlPart(
      new TextEncoder().encode(sourceParts.get("ppt/presentation.xml")!),
      context.xmlLimits
    );
    for (let i = 0; i < existing.length; i++) {
      const list = xml.root.children.find((node) => node.name.localName === "sldIdLst")!;
      xml = xml.merge(list.children[i]!, {
        attributes: [{ namespace: "", localName: "id", value: String(existing[i]) }]
      });
    }
    sourceParts.set("ppt/presentation.xml", new TextDecoder().decode(xml.bytes()));
    const source = storedArchive(
      [...sourceParts].map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value) }))
    );
    const output = parts(await addSlide(source, { layout }, context));
    expect(
      nodes(output.get("ppt/presentation.xml")!, "sldId").map((node) => Number(node.id))
    ).toEqual([...existing, expected]);
  });
  it.each([[[42]], [[2147483648]], [[245, 2147483647, 256]]])(
    "rejects invalid existing slide IDs %j",
    async (existing) => {
      const sourceParts = parts(await fixture("", existing.length));
      let xml = parseXmlPart(
        new TextEncoder().encode(sourceParts.get("ppt/presentation.xml")!),
        context.xmlLimits
      );
      for (let i = 0; i < existing.length; i++) {
        const list = xml.root.children.find((node) => node.name.localName === "sldIdLst")!;
        xml = xml.merge(list.children[i]!, {
          attributes: [{ namespace: "", localName: "id", value: String(existing[i]) }]
        });
      }
      sourceParts.set("ppt/presentation.xml", new TextDecoder().decode(xml.bytes()));
      const source = storedArchive(
        [...sourceParts].map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value) }))
      );
      await expect(addSlide(source, { layout }, context)).rejects.toMatchObject({
        code: "invalid-opc"
      });
    }
  );
  it("omits latent placeholders and retains custom type orientation and size", async () => {
    const source = await fixture(
      placeholder("dt", 3, 2) +
        placeholder("ftr", 4, 3) +
        placeholder("sldNum", 5, 4) +
        placeholder("chart", 42, 5)
    );
    const sourceParts = parts(source);
    let xml = parseXmlPart(
      new TextEncoder().encode(sourceParts.get(layout.slice(1))!),
      context.xmlLimits
    );
    const tree = xml.root.children[0]!.children[0]!;
    const shape = tree.children.at(-1)!;
    const ph = shape.children[0]!.children[2]!.children[0]!;
    xml = xml.merge(ph, {
      attributes: [
        { namespace: "", localName: "orient", value: "vert" },
        { namespace: "", localName: "sz", value: "half" }
      ]
    });
    sourceParts.set(layout.slice(1), new TextDecoder().decode(xml.bytes()));
    const changed = storedArchive(
      [...sourceParts].map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value) }))
    );
    const output = parts(await addSlide(changed, { layout }, context));
    expect(nodes(output.get("ppt/slides/slide3.xml")!, "ph")).toEqual([
      { type: "chart", idx: "42", orient: "vert", sz: "half" }
    ]);
    expect(output.get(layout.slice(1))).toBe(sourceParts.get(layout.slice(1)));
  });
  it("rejects a layout whose master relationship is absent", async () => {
    const source = await fixture("", 2, {
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
    });
    await expect(addSlide(source, { layout }, context)).rejects.toMatchObject({
      code: "invalid-opc"
    });
  });
  it("rejects oversized text before input admission", async () => {
    const input = {
      async read(): Promise<Uint8Array | null> {
        throw new Error("input consumed");
      }
    };
    await expect(
      addSlide(
        input,
        { layout, title: "x".repeat(101) },
        { ...context, xmlLimits: { ...context.xmlLimits, maxBytes: 100 } }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
  });

  it.each(["missing-nv", "duplicate-ph", "shared-index"])(
    "rejects malformed placeholder structure %s",
    async (kind) => {
      let shapes = placeholder("title", 8, 2);
      if (kind === "shared-index") shapes += placeholder("body", 8, 3);
      const sourceParts = parts(await fixture(shapes));
      let xml = parseXmlPart(
        new TextEncoder().encode(sourceParts.get(layout.slice(1))!),
        context.xmlLimits
      );
      if (kind !== "shared-index") {
        const nv = xml.root.children[0]!.children[0]!.children[2]!.children[0]!;
        if (kind === "missing-nv") xml = xml.spliceChildren(nv, 2, 1, []);
        else
          xml = xml.spliceChildren(nv.children[2]!, 1, 0, [
            `<p:ph xmlns:p="${p}" type="body" idx="9"/>`
          ]);
      }
      sourceParts.set(layout.slice(1), new TextDecoder().decode(xml.bytes()));
      const source = storedArchive(
        [...sourceParts].map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value) }))
      );
      await expect(addSlide(source, { layout }, context)).rejects.toMatchObject({
        code: kind === "missing-nv" ? "invalid-opc" : "ambiguous-selection"
      });
    }
  );
  it.each(["protection", "unregistered-master"])(
    "rejects unsupported presentation intent %s",
    async (kind) => {
      const sourceParts = parts(await fixture());
      let xml = parseXmlPart(
        new TextEncoder().encode(sourceParts.get("ppt/presentation.xml")!),
        context.xmlLimits
      );
      if (kind === "protection")
        xml = xml.spliceChildren(xml.root, xml.root.children.length, 0, [
          `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:p="${p}"><mc:Choice Requires="p"><p:modifyVerifier/></mc:Choice></mc:AlternateContent>`
        ]);
      else xml = xml.spliceChildren(xml.root, 0, 1, []);
      sourceParts.set("ppt/presentation.xml", new TextDecoder().decode(xml.bytes()));
      const source = storedArchive(
        [...sourceParts].map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value) }))
      );
      await expect(addSlide(source, { layout }, context)).rejects.toMatchObject({
        code: kind === "protection" ? "unsupported-edit" : "invalid-opc"
      });
    }
  );
  it.each([
    ["ctrTitle", 0, "horz", "full", true],
    ["subTitle", 1, "vert", "full", true],
    ["tbl", 14, "horz", "quarter", false],
    ["obj", 15, "horz", "full", true],
    ["chart", 42, "vert", "half", false],
    ["pic", 5, "horz", "full", false]
  ] as const)(
    "preserves text capability for custom %s placeholders",
    async (type, index, orient, size, hasText) => {
      const sourceParts = parts(await fixture(placeholder(type, index, 2)));
      let xml = parseXmlPart(
        new TextEncoder().encode(sourceParts.get(layout.slice(1))!),
        context.xmlLimits
      );
      const ph =
        xml.root.children[0]!.children[0]!.children[2]!.children[0]!.children[2]!.children[0]!;
      xml = xml.merge(ph, {
        attributes: [
          { namespace: "", localName: "orient", value: orient },
          { namespace: "", localName: "sz", value: size }
        ]
      });
      sourceParts.set(layout.slice(1), new TextDecoder().decode(xml.bytes()));
      const source = storedArchive(
        [...sourceParts].map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value) }))
      );
      const output = parts(await addSlide(source, { layout }, context)).get(
        "ppt/slides/slide3.xml"
      )!;
      expect(nodes(output, "ph")).toEqual([{ type, idx: String(index), orient, sz: size }]);
      expect(nodes(output, "txBody")).toHaveLength(hasText ? 1 : 0);
      if (!hasText)
        await expect(
          addSlide(
            source,
            { layout, placeholders: [{ type, index, text: "Cannot coerce" }] },
            context
          )
        ).rejects.toMatchObject({ code: "unsupported-edit" });
    }
  );
  it("writes explicit hidden and master-background flags", async () => {
    const output = parts(
      await addSlide(
        await fixture(),
        { layout, hidden: true, followMasterBackground: false },
        context
      )
    );
    expect(nodes(output.get("ppt/slides/slide3.xml")!, "sld")[0]).toMatchObject({ show: "0" });
    expect(nodes(output.get("ppt/slides/slide3.xml")!, "bg")).toHaveLength(1);
  });
});
