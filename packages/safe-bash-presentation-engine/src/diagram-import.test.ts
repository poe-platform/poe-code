import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation, importSlides } from "./index.js";
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
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const dgm = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
const drawing = "http://schemas.microsoft.com/office/drawing/2008/diagram";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const archive = (parts: Map<string, Uint8Array>) =>
  storedArchive([...parts].map(([name, bytes]) => ({ name, bytes })));
function append(parts: Map<string, Uint8Array>, name: string, content: string) {
  const xml = parseXmlPart(parts.get(name)!, context.xmlLimits);
  parts.set(name, xml.spliceChildren(xml.root, xml.root.children.length, 0, [content]).bytes());
}
async function fixture(fallbackOnly = false) {
  const bytes = await createPresentation(
    { slides: [{ name: "Process" }, { name: "Overview" }] },
    context
  );
  const volume = Volume.fromJSON({ "/deck": Buffer.from(bytes) });
  const parts = new Map<string, Uint8Array>(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((part) => [
      part.name,
      part.payload
    ])
  );
  const resources = [
    ["data", "diagramData", "dataModel"],
    ["layout", "diagramLayout", "layoutDef"],
    ["style", "diagramQuickStyle", "styleDef"],
    ["colors", "diagramColors", "colorsDef"],
    ["drawing", "diagramDrawing", "drawing"]
  ];
  for (const [name, kind, root] of resources) {
    if (fallbackOnly && name !== "drawing") continue;
    const type =
      name === "drawing"
        ? "application/vnd.ms-office.drawingml.diagramDrawing+xml"
        : `application/vnd.openxmlformats-officedocument.drawingml.${name === "style" ? "diagramStyle" : kind}+xml`;
    parts.set(
      `ppt/diagrams/${name}.xml`,
      encoder.encode(
        `<d:${root} xmlns:d="${name === "drawing" ? drawing : dgm}" xmlns:r="${r}"><!-- original appearance -->${name === "data" ? '<d:extLst><d:ext uri="urn:appearance"><dsp:dataModelExt xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" relId="fallback"/></d:ext></d:extLst>' : ""}</d:${root}>`
      )
    );
    append(
      parts,
      "[Content_Types].xml",
      `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/diagrams/${name}.xml" ContentType="${type}"/>`
    );
    for (const slide of [1, 2])
      if (name !== "drawing" || fallbackOnly)
        append(
          parts,
          `ppt/slides/_rels/slide${slide}.xml.rels`,
          `<Relationship xmlns="${rel}" Id="${name}" Type="${name === "drawing" ? "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" : `${r}/${kind}`}" Target="../diagrams/${name}.xml"/>`
        );
  }
  if (!fallbackOnly) {
    parts.set(
      "ppt/diagrams/_rels/data.xml.rels",
      encoder.encode(
        `<Relationships xmlns="${rel}"><Relationship Id="fallback" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="drawing.xml"/></Relationships>`
      )
    );
    for (const slide of [1, 2]) {
      const name = `ppt/slides/slide${slide}.xml`;
      const xml = parseXmlPart(parts.get(name)!, context.xmlLimits);
      const tree = xml.root.children[0]!.children.find((node) => node.name.localName === "spTree")!;
      parts.set(
        name,
        xml
          .spliceChildren(tree, tree.children.length, 0, [
            `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvGraphicFramePr><p:cNvPr id="5" name="Process diagram"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="${dgm}"><d:relIds xmlns:d="${dgm}" xmlns:r="${r}" r:dm="data" r:lo="layout" r:qs="style" r:cs="colors"/></a:graphicData></a:graphic></p:graphicFrame>`
          ])
          .bytes()
      );
    }
  }
  return parts;
}
it.each([false, true])(
  "imports shared diagram appearance bytes and dependency closure (fallback only %s)",
  async (fallbackOnly) => {
    const source = await fixture(fallbackOnly);
    const output = await importSlides(
      archive(source),
      archive(source),
      { sourceSlides: [1, 2] },
      context
    );
    const result = new Map(inspectZip(output).map((part) => [part.name, part.payload]));
    for (const [name, bytes] of source)
      if (name.startsWith("ppt/diagrams/") && !name.includes("/_rels/")) {
        expect(result.get(name)).toEqual(bytes);
        expect(result.get(name.slice(0, -4) + "-import1.xml")).toEqual(bytes);
        expect(result.has(name.slice(0, -4) + "-import2.xml")).toBe(false);
      }
    if (!fallbackOnly) {
      const rels = decoder.decode(result.get("ppt/diagrams/_rels/data-import1.xml.rels"));
      expect(rels).toContain('Id="fallback"');
      expect(rels).toContain('Target="drawing-import1.xml"');
      for (const slide of [1, 2]) {
        const xml = parseXmlPart(
          result.get(`ppt/slides/slide${slide}-import1.xml`)!,
          context.xmlLimits
        );
        const pending = [xml.root];
        while (pending.length) {
          const node = pending.pop()!;
          if (node.name.localName === "relIds") {
            const ids = node.attributes
              .filter((attr) => attr.name.namespace === r)
              .map((attr) => attr.value);
            const relationships = parseXmlPart(
              result.get(`ppt/slides/_rels/slide${slide}-import1.xml.rels`)!,
              context.xmlLimits
            );
            const targets = relationships.root.children
              .filter((edge) =>
                ids.includes(edge.attributes.find((attr) => attr.name.localName === "Id")!.value)
              )
              .map(
                (edge) => edge.attributes.find((attr) => attr.name.localName === "Target")!.value
              )
              .sort();
            expect(targets).toEqual([
              "../diagrams/colors-import1.xml",
              "../diagrams/data-import1.xml",
              "../diagrams/layout-import1.xml",
              "../diagrams/style-import1.xml"
            ]);
          }
          pending.push(...node.children);
        }
      }
    }
  }
);
it.each(["slide-reference", "drawing-reference", "missing-target"])(
  "rejects incomplete diagram closure: %s",
  async (failure) => {
    const source = await fixture();
    if (failure === "missing-target") source.delete("ppt/diagrams/drawing.xml");
    else {
      const name =
        failure === "slide-reference" ? "ppt/slides/slide1.xml" : "ppt/diagrams/data.xml";
      const xml = parseXmlPart(source.get(name)!, context.xmlLimits);
      const pending = [xml.root];
      while (pending.length) {
        const node = pending.pop()!;
        if (node.name.localName === (failure === "slide-reference" ? "relIds" : "dataModelExt")) {
          source.set(
            name,
            xml
              .merge(node, {
                attributes: [
                  {
                    namespace: failure === "slide-reference" ? r : "",
                    localName: failure === "slide-reference" ? "dm" : "relId",
                    value: "absent"
                  }
                ]
              })
              .bytes()
          );
          break;
        }
        pending.push(...node.children);
      }
    }
    const destination = await createPresentation({ slides: [] }, context);
    await expect(
      importSlides(destination, archive(source), { sourceSlides: [1] }, context)
    ).rejects.toMatchObject({ code: expect.stringMatching("unsupported-edit|invalid-opc") });
  }
);
it("retains both diagram choice and raster fallback while importing every branch dependency", async () => {
  const source = await fixture();
  const name = "ppt/slides/slide1.xml";
  const xml = parseXmlPart(source.get(name)!, context.xmlLimits);
  const tree = xml.root.children[0]!.children.find((node) => node.name.localName === "spTree")!;
  const graphic = tree.children[tree.children.length - 1]!;
  source.set(
    name,
    xml
      .spliceChildren(tree, tree.children.length - 1, 1, [
        `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:d="${dgm}"><mc:Choice Requires="d">${xml.markup(graphic)}</mc:Choice><mc:Fallback><p:pic xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${r}"><p:nvPicPr><p:cNvPr id="6" name="Process preview"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="preview"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></mc:Fallback></mc:AlternateContent>`
      ])
      .bytes()
  );
  source.set("ppt/media/preview.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  append(
    source,
    "[Content_Types].xml",
    '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/media/preview.png" ContentType="image/png"/>'
  );
  append(
    source,
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationship xmlns="${rel}" Id="preview" Type="${r}/image" Target="../media/preview.png"/>`
  );
  const destination = await createPresentation({ slides: [] }, context);
  const result = new Map(
    inspectZip(
      await importSlides(destination, archive(source), { sourceSlides: [1] }, context)
    ).map((part) => [part.name, part.payload])
  );
  const slide = decoder.decode(result.get("ppt/slides/slide1-import1.xml"));
  expect(slide).toContain('<mc:Choice Requires="d">');
  expect(slide).toContain("<mc:Fallback>");
  expect(result.get("ppt/media/preview-import1.png")).toEqual(source.get("ppt/media/preview.png"));
  expect(decoder.decode(result.get("ppt/slides/_rels/slide1-import1.xml.rels"))).toContain(
    'Target="../media/preview-import1.png"'
  );
});
it.each(["dm", "lo", "qs", "cs"])(
  "rejects a diagram reference missing its required %s edge selector",
  async (attribute) => {
    const source = await fixture();
    const name = "ppt/slides/slide1.xml";
    const xml = parseXmlPart(source.get(name)!, context.xmlLimits);
    const pending = [xml.root];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.name.namespace === dgm && node.name.localName === "relIds") {
        source.set(
          name,
          xml
            .merge(node, { attributes: [{ namespace: r, localName: attribute, value: null }] })
            .bytes()
        );
        break;
      }
      pending.push(...node.children);
    }
    await expect(
      importSlides(
        await createPresentation({ slides: [] }, context),
        archive(source),
        { sourceSlides: [1] },
        context
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  }
);
it.each([false, true])(
  "preserves exclusive diagram shape IDs and rejects duplicates within a branch (duplicate %s)",
  async (duplicate) => {
    const source = await fixture();
    const name = "ppt/slides/slide1.xml";
    const xml = parseXmlPart(source.get(name)!, context.xmlLimits);
    const tree = xml.root.children[0]!.children.find((node) => node.name.localName === "spTree")!;
    const graphic = xml.markup(tree.children[tree.children.length - 1]!);
    source.set(
      name,
      xml
        .spliceChildren(tree, tree.children.length - 1, 1, [
          `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:d="${dgm}"><mc:Choice Requires="d">${graphic}${duplicate ? graphic : ""}</mc:Choice><mc:Fallback>${graphic}</mc:Fallback></mc:AlternateContent>`
        ])
        .bytes()
    );
    const imported = importSlides(
      await createPresentation({ slides: [] }, context),
      archive(source),
      { sourceSlides: [1] },
      context
    );
    if (duplicate) await expect(imported).rejects.toMatchObject({ code: "unsupported-edit" });
    else {
      const result = new Map(inspectZip(await imported).map((part) => [part.name, part.payload]));
      const slide = parseXmlPart(result.get("ppt/slides/slide1-import1.xml")!, context.xmlLimits);
      const pending = [slide.root];
      const ids: string[] = [];
      while (pending.length) {
        const node = pending.pop()!;
        if (node.name.localName === "cNvPr")
          ids.push(node.attributes.find((attribute) => attribute.name.localName === "id")!.value);
        pending.push(...node.children);
      }
      expect(ids.sort()).toEqual(["1", "5", "5"]);
    }
  }
);
it("rejects multiple fallback branches instead of treating duplicate shape IDs as exclusive", async () => {
  const source = await fixture();
  const name = "ppt/slides/slide1.xml";
  const xml = parseXmlPart(source.get(name)!, context.xmlLimits);
  const tree = xml.root.children[0]!.children.find((node) => node.name.localName === "spTree")!;
  const graphic = xml.markup(tree.children[tree.children.length - 1]!);
  source.set(
    name,
    xml
      .spliceChildren(tree, tree.children.length - 1, 1, [
        `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:d="${dgm}"><mc:Choice Requires="d">${graphic}</mc:Choice><mc:Fallback>${graphic}</mc:Fallback><mc:Fallback>${graphic}</mc:Fallback></mc:AlternateContent>`
      ])
      .bytes()
  );
  await expect(
    importSlides(
      await createPresentation({ slides: [] }, context),
      archive(source),
      { sourceSlides: [1] },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-xml" });
});
