import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SaxesParser } from "saxes";
import { writePackageArchive } from "./package-writer.js";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import {
  addMaster,
  associateLayout,
  mutateMaster,
  mutateMasterShape,
  readMasters
} from "./masters.js";
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
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
function parts(bytes: Uint8Array) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((x) => [
      x.name,
      new TextDecoder().decode(x.payload)
    ])
  );
}
function attributes(xml: string, local: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      result.push(Object.fromEntries(Object.values(tag.attributes).map((x) => [x.name, x.value])));
  });
  parser.write(xml).close();
  return result;
}
describe("shared master editing", () => {
  it("creates a second master sharing a theme and reassigns the layout without touching local drawings", async () => {
    const source = await createPresentation(
      { slides: [{ shapes: [{ x: 4, y: 5, width: 60, height: 70, text: "Local" }] }, {}] },
      context
    );
    const created = await addMaster(
      source,
      {
        scope: "masters",
        name: "Second",
        shapes: [{ name: "Heading", x: 1, y: 2, width: 30, height: 40, text: "Inherited" }],
        background: { color: "AABBCC" }
      },
      context
    );
    expect(created.affectedSlides).toEqual([]);
    expect((await readMasters(created.bytes, context)).map((x) => x.name)).toEqual([
      "Original master",
      "Second"
    ]);
    const assigned = await associateLayout(
      created.bytes,
      { scope: "layouts", layout: "Blank", master: "Second" },
      context
    );
    expect(assigned.affectedSlides).toEqual([1, 2]);
    const edited = await mutateMaster(
      assigned.bytes,
      {
        scope: "masters",
        master: "Second",
        shape: "Heading",
        text: "Updated & clear",
        background: { color: "112233" }
      },
      context
    );
    expect(edited.affectedSlides).toEqual([1, 2]);
    const before = parts(source),
      after = parts(edited.bytes);
    for (const name of ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/theme/theme1.xml"])
      expect(after.get(name)).toBe(before.get(name));
    expect(after.get(edited.part.slice(1))).toContain("Updated &amp; clear");
    expect(after.get(edited.part.slice(1))).toContain('val="112233"');
    const masters = await readMasters(edited.bytes, context);
    expect(masters[0]!.layouts).toEqual([]);
    expect(masters[0]!.affectedSlides).toEqual([]);
    expect(attributes(after.get("ppt/slideMasters/slideMaster1.xml")!, "sldLayoutId")).toEqual([]);
    expect(attributes(after.get("ppt/slideMasters/slideMaster2.xml")!, "sldLayoutId")[0]!.id).toBe(
      "2147483649"
    );
    const target = attributes(
      after.get("ppt/slideLayouts/_rels/slideLayout1.xml.rels")!,
      "Relationship"
    )[0]!;
    expect(target.Target).toBe("../slideMasters/slideMaster2.xml");
    expect(masters[1]!.layouts).toEqual(["/ppt/slideLayouts/slideLayout1.xml"]);
  });
  it("edits rectangular master shape geometry and label while preserving inherited content", async () => {
    const source = await createPresentation({}, context);
    const added = await addMaster(
      source,
      {
        scope: "shared",
        name: "Style",
        shapes: [{ name: "Caption", x: 1, y: 2, width: 3, height: 4, text: "Keep" }]
      },
      context
    );
    const result = await mutateMasterShape(
      added.bytes,
      { scope: "shared", master: "Style", shape: "Caption", name: "Renamed", x: 12, height: 44 },
      context
    );
    const xml = parts(result.bytes).get(result.part.slice(1))!;
    expect(xml).toContain('name="Renamed"');
    expect(xml).toContain('x="12" y="2"');
    expect(xml).toContain('cx="3" cy="44"');
    expect(xml).toContain("Keep");
    await expect(
      mutateMasterShape(
        result.bytes,
        { scope: "masters", master: "Style", shape: "Renamed", width: 0 },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it.each(["solid", "reference", "absent"])(
    "retains local overrides and background extensions for %s fill",
    async (kind) => {
      const source = await createPresentation({ slides: [{}, {}] }, context);
      const files = parts(source);
      const p = "http://schemas.openxmlformats.org/presentationml/2006/main",
        a = "http://schemas.openxmlformats.org/drawingml/2006/main";
      const effect = '<a:effectLst><a:blur rad="200"/></a:effectLst>';
      const background =
        kind === "solid"
          ? `<p:bg><p:bgPr shadeToTitle="1"><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill>${effect}<p:extLst><p:ext uri="urn:original:retained"/></p:extLst></p:bgPr></p:bg>`
          : kind === "reference"
            ? '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'
            : "";
      files.set(
        "ppt/slideMasters/slideMaster1.xml",
        files
          .get("ppt/slideMasters/slideMaster1.xml")!
          .replace("<p:spTree>", background + "<p:spTree>")
      );
      files.set(
        "ppt/slides/slide2.xml",
        `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="998877"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`
      );
      const fixture = await writePackageArchive(
        [...files].map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })),
        context,
        { compression: "store" }
      );
      const result = await mutateMaster(
        fixture,
        { scope: "masters", master: "Original master", background: { color: "123456" } },
        context
      );
      expect(result.affectedSlides).toEqual([1, 2]);
      const output = parts(result.bytes),
        xml = output.get(result.part.slice(1))!;
      expect(attributes(xml, "srgbClr")[0]!.val).toBe("123456");
      if (kind === "solid") {
        expect(xml).toContain(effect);
        expect(xml).toContain('shadeToTitle="1"');
        expect(xml).toContain('uri="urn:original:retained"');
      }
      expect(output.get("ppt/slides/slide1.xml")).toBe(files.get("ppt/slides/slide1.xml"));
      expect(output.get("ppt/slides/slide2.xml")).toBe(files.get("ppt/slides/slide2.xml"));
    }
  );
  it("moves an unused layout and keeps repeated assignments byte-identical", async () => {
    const source = await createPresentation({}, context);
    const second = await addMaster(source, { scope: "masters", name: "Unused" }, context);
    const move = await associateLayout(
      second.bytes,
      { scope: "layouts", layout: "Blank", master: "Unused" },
      context
    );
    expect(move.affectedSlides).toEqual([]);
    const repeat = await associateLayout(
      move.bytes,
      { scope: "layouts", layout: "Blank", master: "Unused" },
      context
    );
    expect(repeat.bytes).toEqual(move.bytes);
    expect(repeat.affectedSlides).toEqual([]);
  });
  it("distinguishes numeric shape names from local shape identities", async () => {
    const source = await createPresentation({}, context);
    const added = await addMaster(
      source,
      {
        scope: "masters",
        name: "Numbers",
        shapes: [
          { name: "Caption", x: 0, y: 0, width: 10, height: 10, text: "First" },
          { name: "2", x: 0, y: 0, width: 10, height: 10, text: "Second" }
        ]
      },
      context
    );
    const named = await mutateMasterShape(
      added.bytes,
      { scope: "masters", master: "Numbers", shape: "2", text: "Named" },
      context
    );
    const identified = await mutateMaster(
      named.bytes,
      { scope: "masters", master: "Numbers", shapeId: "2", text: "Identified" },
      context
    );
    const xml = parts(identified.bytes).get(identified.part.slice(1))!;
    expect(xml.indexOf("Identified")).toBeLessThan(xml.indexOf("Named"));
    expect(xml).not.toContain("First");
    expect(xml).not.toContain("Second");
  });
  it.each([{ positions: [] }, { positions: [1] }, { positions: [2] }, { positions: [1, 2] }])(
    "reports exact slide dependencies %j across two masters",
    async ({ positions }) => {
      const source = await createPresentation({ slides: [{}, {}] }, context);
      const added = await addMaster(source, { scope: "masters", name: "Alternate" }, context);
      const files = parts(added.bytes);
      files.set(
        "ppt/slideLayouts/slideLayout2.xml",
        files.get("ppt/slideLayouts/slideLayout1.xml")!.replace('name="Blank"', 'name="Other"')
      );
      files.set(
        "ppt/slideLayouts/_rels/slideLayout2.xml.rels",
        files
          .get("ppt/slideLayouts/_rels/slideLayout1.xml.rels")!
          .replace("slideMaster1.xml", "slideMaster2.xml")
      );
      files.set(
        "ppt/slideMasters/slideMaster2.xml",
        files
          .get("ppt/slideMasters/slideMaster2.xml")!
          .replace(
            "<p:txStyles>",
            '<p:sldLayoutIdLst><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst><p:txStyles>'
          )
      );
      files.set(
        "ppt/slideMasters/_rels/slideMaster2.xml.rels",
        files
          .get("ppt/slideMasters/_rels/slideMaster2.xml.rels")!
          .replace(
            "</Relationships>",
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/></Relationships>'
          )
      );
      files.set(
        "[Content_Types].xml",
        files
          .get("[Content_Types].xml")!
          .replace(
            "</Types>",
            '<Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/></Types>'
          )
      );
      for (const position of positions) {
        const path = `ppt/slides/_rels/slide${position}.xml.rels`;
        files.set(path, files.get(path)!.replace("slideLayout1.xml", "slideLayout2.xml"));
      }
      const fixture = await writePackageArchive(
        [...files].map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })),
        context,
        { compression: "store" }
      );
      const edited = await mutateMaster(
        fixture,
        { scope: "masters", master: "Alternate", background: { color: "103050" } },
        context
      );
      expect(edited.affectedSlides).toEqual(positions);
      const other = await mutateMaster(
        edited.bytes,
        { scope: "masters", master: "Original master", name: "Primary" },
        context
      );
      expect(other.affectedSlides).toEqual([1, 2].filter((x) => !positions.includes(x)));
      const before = parts(fixture),
        after = parts(other.bytes);
      for (const path of ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/theme/theme1.xml"])
        expect(after.get(path)).toBe(before.get(path));
    }
  );
  it.each(["", "First\nSecond", "First\vSecond", "A]]>B"])(
    "writes exact plain text control semantics %j",
    async (text) => {
      const original = parts(await createPresentation({}, context));
      const source = await writePackageArchive(
        [...original].map(([name, xml]) => ({
          name,
          bytes: new TextEncoder().encode(
            xml
              .split("http://schemas.openxmlformats.org/presentationml/2006/main")
              .join("http://purl.oclc.org/ooxml/presentationml/main")
              .split("http://schemas.openxmlformats.org/drawingml/2006/main")
              .join("http://purl.oclc.org/ooxml/drawingml/main")
              .split("http://schemas.openxmlformats.org/officeDocument/2006/relationships")
              .join("http://purl.oclc.org/ooxml/officeDocument/relationships")
          )
        })),
        context,
        { compression: "store" }
      );
      const result = await addMaster(source, { scope: "masters", name: "Strict", text }, context);
      const xml = parts(result.bytes).get(result.part.slice(1))!;
      expect(xml).toContain('xmlns:p="http://purl.oclc.org/ooxml/presentationml/main"');
      expect(attributes(xml, "p")).toHaveLength(text.includes("\n") ? 2 : 1);
      expect(attributes(xml, "br")).toHaveLength(text.includes("\v") ? 1 : 0);
      const chunks: string[] = [];
      const parser = new SaxesParser({ xmlns: true });
      parser.on("text", (value) => chunks.push(value));
      parser.write(xml).close();
      expect(chunks.join("")).toBe(text.split("\n").join("").split("\v").join(""));
    }
  );
  it("rejects invalid text and resource amplification before publication", async () => {
    const source = await createPresentation({}, context);
    await expect(
      addMaster(
        source,
        { scope: "masters", name: "Bounds", text: "x".repeat(context.xmlLimits.maxBytes + 1) },
        context
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
    await expect(
      addMaster(source, { scope: "masters", name: "Bounds", text: "invalid\u0001" }, context)
    ).rejects.toMatchObject({ code: "invalid-xml" });
  });
  it("keeps inherited transforms absent and explicit zero coordinates local", async () => {
    const source = await createPresentation({ slides: [{}, {}] }, context);
    const authored = await mutateMaster(
      source,
      {
        scope: "masters",
        master: "Original master",
        shapes: [{ name: "Heading", x: 20, y: 30, width: 40, height: 50, text: "Master" }]
      },
      context
    );
    const files = parts(authored.bytes),
      p = "http://schemas.openxmlformats.org/presentationml/2006/main",
      a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const masterXml = files.get("ppt/slideMasters/slideMaster1.xml")!;
    files.set(
      "ppt/slideMasters/slideMaster1.xml",
      masterXml
        .replace(
          '<p:cNvSpPr txBox="1"/><p:nvPr/>',
          '<p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="title" idx="7"/></p:nvPr>'
        )
        .replace(
          "</p:sldLayoutIdLst>",
          '<p:sldLayoutId id="2147483650" r:id="rId3"/></p:sldLayoutIdLst>'
        )
    );
    for (const i of [1, 2]) {
      const transform =
        i === 1 ? "" : '<a:xfrm><a:off x="0" y="0"/><a:ext cx="400" cy="500"/></a:xfrm>';
      files.set(
        `ppt/slideLayouts/slideLayout${i}.xml`,
        `<p:sldLayout xmlns:p="${p}" xmlns:a="${a}"><p:cSld name="Layout ${i}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Heading"/><p:cNvSpPr/><p:nvPr><p:ph type="title" idx="7"/></p:nvPr></p:nvSpPr><p:spPr>${transform}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`
      );
    }
    files.set(
      "ppt/slideLayouts/_rels/slideLayout2.xml.rels",
      files.get("ppt/slideLayouts/_rels/slideLayout1.xml.rels")!
    );
    files.set(
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      files
        .get("ppt/slideMasters/_rels/slideMaster1.xml.rels")!
        .replace(
          "</Relationships>",
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/></Relationships>'
        )
    );
    files.set(
      "[Content_Types].xml",
      files
        .get("[Content_Types].xml")!
        .replace(
          "</Types>",
          '<Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/></Types>'
        )
    );
    files.set(
      "ppt/slides/_rels/slide2.xml.rels",
      files.get("ppt/slides/_rels/slide2.xml.rels")!.replace("slideLayout1.xml", "slideLayout2.xml")
    );
    const fixture = await writePackageArchive(
      [...files].map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })),
      context,
      { compression: "store" }
    );
    const result = await mutateMasterShape(
      fixture,
      {
        scope: "masters",
        master: "Original master",
        shape: "Heading",
        x: 99,
        text: "Revised master"
      },
      context
    );
    expect(result.affectedSlides).toEqual([1, 2]);
    const after = parts(result.bytes);
    const masterX = Number(attributes(after.get(result.part.slice(1))!, "off").at(-1)!.x);
    const inherited = attributes(after.get("ppt/slideLayouts/slideLayout1.xml")!, "off")[0];
    const direct = attributes(after.get("ppt/slideLayouts/slideLayout2.xml")!, "off")[0];
    expect(masterX).toBe(99);
    expect(inherited).toBeUndefined();
    expect(Number(inherited?.x ?? masterX)).toBe(99);
    expect(Number(direct!.x)).toBe(0);
    for (const path of [
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slideLayouts/slideLayout2.xml",
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml"
    ])
      expect(after.get(path)).toBe(files.get(path));
  });
  it.each([0, 1, 2])("lists %s registered masters", async (count) => {
    let source = await createPresentation({}, context);
    if (count === 2)
      source = (await addMaster(source, { scope: "masters", name: "Another" }, context)).bytes;
    if (count === 0) {
      const files = parts(source);
      for (const name of files.keys())
        if (name.startsWith("ppt/slideMasters/") || name.startsWith("ppt/slideLayouts/"))
          files.delete(name);
      const xml = files.get("ppt/presentation.xml")!,
        start = xml.indexOf("<p:sldMasterIdLst>"),
        end = xml.indexOf("</p:sldMasterIdLst>") + "</p:sldMasterIdLst>".length;
      files.set("ppt/presentation.xml", xml.slice(0, start) + xml.slice(end));
      files.set(
        "ppt/_rels/presentation.xml.rels",
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
      );
      source = await writePackageArchive(
        [...files].map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })),
        context,
        { compression: "store" }
      );
    }
    expect(await readMasters(source, context)).toHaveLength(count);
  });
  it("rejects orphan relationship members before allocating a master", async () => {
    const source = await createPresentation({}, context);
    const files = parts(source);
    const orphan =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
    files.set("ppt/slideMasters/_rels/slideMaster2.xml.rels", orphan);
    const fixture = await writePackageArchive(
      [...files].map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })),
      context,
      { compression: "store" }
    );
    await expect(
      addMaster(fixture, { scope: "masters", name: "Reserved" }, context)
    ).rejects.toMatchObject({ code: "missing-binding" });
    expect(parts(fixture).get("ppt/slideMasters/_rels/slideMaster2.xml.rels")).toBe(orphan);
  });
  it("bounds shape collections before inspecting or copying their entries", async () => {
    const source = await createPresentation({}, context);
    const limited = { ...context, xmlLimits: { ...context.xmlLimits, maxNodes: 1000 } };
    const shapes = new Array(1001);
    await expect(
      addMaster(source, { scope: "masters", name: "Bounded", shapes }, limited)
    ).rejects.toMatchObject({ code: "resource-limit", phase: "usage" });
    await expect(
      mutateMaster(source, { scope: "masters", master: "Original master", shapes }, limited)
    ).rejects.toMatchObject({ code: "resource-limit", phase: "usage" });
  });
  it("bounds a master name before parsing or escaping it", async () => {
    const limited = { ...context, xmlLimits: { ...context.xmlLimits, maxBytes: 16 } };
    await expect(
      addMaster(new Uint8Array(), { scope: "masters", name: "&".repeat(17) }, limited)
    ).rejects.toMatchObject({ code: "resource-limit", phase: "usage" });
  });
  it("requires explicit scope and selected text shape", async () => {
    const source = await createPresentation({}, context);
    await expect(addMaster(source, { name: "Denied" } as never, context)).rejects.toMatchObject({
      code: "invalid-value"
    });
    await expect(
      mutateMaster(
        source,
        { scope: "masters", master: "/ppt/slideMasters/slideMaster1.xml", text: "Denied" },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
});
