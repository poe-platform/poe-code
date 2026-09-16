import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";
import { parseXmlPart } from "./xml.js";
import { writePackageArchive } from "./package-writer.js";
import { readAccessibility, mutateAccessibility } from "./accessibility.js";
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
const decorative = "http://schemas.microsoft.com/office/drawing/2017/decorative";
const shape = (id: number, attrs = "", placeholder = "", text = "") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Object ${id}" ${attrs}/><p:cNvSpPr/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
async function deck(slides: string[], layout = "") {
  const input = await createPresentation({ slides: slides.map(() => ({})) }, context);
  const members = inspectZip(input).map(({ name, payload }) => {
    const index = slides.findIndex((_, i) => name === `ppt/slides/slide${i + 1}.xml`);
    const xml =
      index >= 0
        ? `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${slides[index]}</p:spTree></p:cSld></p:sld>`
        : name === "ppt/slideLayouts/slideLayout1.xml"
          ? `<p:sldLayout xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${layout}</p:spTree></p:cSld></p:sldLayout>`
          : null;
    return { name, bytes: xml === null ? payload : new TextEncoder().encode(xml) };
  });
  return writePackageArchive(members, context, { compression: "auto" });
}
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
it("reports missing and duplicate placeholder titles independently of object metadata titles", async () => {
  const title = shape(2, 'title="Metadata only"', '<p:ph type="title"/>', "Garden");
  const result = await readAccessibility(
    await deck([title, title, shape(2, 'title="Not a slide title"')]),
    {},
    context
  );
  expect(result.slides).toEqual([
    {
      slide: 1,
      part: "/ppt/slides/slide1.xml",
      titles: ["Garden"],
      missingTitle: false,
      duplicateTitle: true,
      multipleTitles: false
    },
    {
      slide: 2,
      part: "/ppt/slides/slide2.xml",
      titles: ["Garden"],
      missingTitle: false,
      duplicateTitle: true,
      multipleTitles: false
    },
    {
      slide: 3,
      part: "/ppt/slides/slide3.xml",
      titles: [],
      missingTitle: true,
      duplicateTitle: false,
      multipleTitles: false
    }
  ]);
  expect(result.order).toBe("structural");
});
it("exposes layout fallback provenance and keeps explicit empty descriptions", async () => {
  const ph = '<p:ph idx="4"/>';
  const input = await deck(
    [shape(2, "", ph) + shape(3, 'descr=""', ph)],
    shape(8, 'descr="Layout guide" title="Overview"', ph)
  );
  const { objects } = await readAccessibility(input, {}, context);
  expect(objects[0]).toMatchObject({
    altText: "Layout guide",
    title: "Overview",
    structuralOrder: 1,
    provenance: {
      description: { part: "/ppt/slideLayouts/slideLayout1.xml", shapeId: "8", inherited: true }
    }
  });
  expect(objects[1]).toMatchObject({
    description: "",
    structuralOrder: 2,
    provenance: { description: { part: "/ppt/slides/slide1.xml", shapeId: "3", inherited: false } }
  });
});
it("edits occurrence metadata with independent XML assertions and preserves opaque extensions", async () => {
  const input = await deck([shape(2, 'descr="Left view"') + shape(3, 'descr="Right view"')]);
  const result = await mutateAccessibility(
    input,
    {
      slide: 1,
      shape: "Object 2",
      update: { altText: "Fern & moss", title: "Plant", decorative: true }
    },
    context
  );
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/result.pptx", result.bytes);
  const xml = inspectZip(new Uint8Array(fs.readFileSync("/result.pptx") as Buffer)).find(
    (x) => x.name === "ppt/slides/slide1.xml"
  )!.payload;
  const tags: { local: string; uri: string; attrs: Record<string, string> }[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) =>
    tags.push({
      local: tag.local,
      uri: tag.uri,
      attrs: Object.fromEntries(Object.values(tag.attributes).map((x) => [x.local, x.value]))
    })
  );
  parser.write(new TextDecoder().decode(xml)).close();
  expect(tags.filter((x) => x.local === "cNvPr").map((x) => x.attrs.descr)).toEqual([
    undefined,
    "Fern & moss",
    "Right view"
  ]);
  expect(tags.find((x) => x.uri === decorative && x.local === "decorative")?.attrs.val).toBe("1");
  expect(result.affected).toBe(1);
  expect(result.affectedSlides).toEqual([1]);
  const cleared = await mutateAccessibility(
    result.bytes,
    { slide: 1, shape: "Object 2", update: { decorative: false } },
    context
  );
  expect(
    (await readAccessibility(cleared.bytes, { slide: 1, shape: "Object 2" }, context)).objects[0]
      ?.decorative
  ).toBe(false);
});
it.each([
  {},
  { decorative: "true" },
  { altText: "\u0001" },
  { altText: "x", description: "y" },
  { unexpected: true }
])("rejects invalid metadata updates before reading input", async (update) => {
  await expect(
    mutateAccessibility(new Uint8Array(), { slide: 1, shape: "Object 2", update } as never, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
});
it.each([
  ["sp", "nvSpPr", "cNvSpPr", "spPr"],
  ["pic", "nvPicPr", "cNvPicPr", "spPr"],
  ["cxnSp", "nvCxnSpPr", "cNvCxnSpPr", "spPr"],
  ["graphicFrame", "nvGraphicFramePr", "cNvGraphicFramePr", "xfrm"],
  ["grpSp", "nvGrpSpPr", "cNvGrpSpPr", "grpSpPr"]
])("reads and edits metadata for structural %s objects", async (kind, nv, specific, props) => {
  const input = await deck([
    `<p:${kind}><p:${nv}><p:cNvPr id="5" name="Target"/><p:${specific}/><p:nvPr/></p:${nv}><p:${props}/></p:${kind}>`
  ]);
  const result = await mutateAccessibility(
    input,
    { slide: 1, shape: "Target", update: { altText: "Scene" } },
    context
  );
  expect((await readAccessibility(result.bytes, {}, context)).objects[0]).toMatchObject({
    id: "5",
    name: "Target",
    description: "Scene"
  });
});
it("keeps per-picture alternative text when media bytes are shared", async () => {
  const { addImage } = await import("./image-insertion.js");
  const tile = new Uint8Array([
    71, 73, 70, 56, 57, 97, 6, 0, 4, 0, 128, 0, 0, 0, 0, 0, 12, 34, 56, 44, 0, 0, 0, 0, 1, 0, 1, 0,
    0, 2, 2, 68, 1, 0, 59
  ]);
  let input = await createPresentation({ slides: [{}] }, context);
  input = await addImage(input, { slide: 1, bytes: tile, contentType: "image/gif" }, context);
  input = await addImage(input, { slide: 1, bytes: tile, contentType: "image/gif" }, context);
  input = await writePackageArchive(
    inspectZip(input).map(({ name, payload }) => {
      if (name !== "ppt/slides/_rels/slide1.xml.rels") return { name, bytes: payload };
      let doc = parseXmlPart(payload, context.xmlLimits);
      const images = doc.root.children.filter((x) =>
        x.attributes.some((a) => a.name.localName === "Type" && a.value.endsWith("/image"))
      );
      const target = images[0]!.attributes.find((a) => a.name.localName === "Target")!.value;
      doc = doc.merge(images[1]!, {
        attributes: [{ namespace: "", localName: "Target", value: target }]
      });
      return { name, bytes: doc.bytes() };
    }),
    context,
    { compression: "auto" }
  );
  const pictures = (await readAccessibility(input, {}, context)).objects;
  let result = await mutateAccessibility(
    input,
    { select: pictures[0]!.token, update: { altText: "Morning" } },
    context
  );
  const next = (await readAccessibility(result.bytes, {}, context)).objects;
  result = await mutateAccessibility(
    result.bytes,
    { select: next[1]!.token, update: { altText: "Evening" } },
    context
  );
  expect(
    (await readAccessibility(result.bytes, {}, context)).objects.map((x) => x.altText)
  ).toEqual(["Morning", "Evening"]);
  expect(
    inspectZip(result.bytes)
      .filter((x) => x.name.startsWith("ppt/media/"))
      .map((x) => x.payload)
  ).toEqual([tile, tile]);
});
it("reports nested objects in depth-first structural order", async () => {
  const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape(3)}</p:grpSp>`;
  const { objects } = await readAccessibility(await deck([group + shape(4)]), {}, context);
  expect(objects.map((x) => [x.id, x.structuralOrder])).toEqual([
    ["2", 1],
    ["3", 2],
    ["4", 3]
  ]);
});
it("rejects conflicting selectors and accessor updates before reading", async () => {
  const read = vi.fn();
  const input = { size: 2, read };
  await expect(
    mutateAccessibility(input as never, { select: "x", slide: 1, update: { title: "x" } }, context)
  ).rejects.toMatchObject({ code: "invalid-selection" });
  const getter = vi.fn(() => "x");
  await expect(
    mutateAccessibility(
      input as never,
      { slide: 1, update: Object.defineProperty({}, "title", { get: getter }) },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(getter).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it("scopes title checks to selected slide owners and resolves inherited title placeholder types", async () => {
  const ph = '<p:ph idx="4"/>';
  const input = await deck(
    [shape(2, "", ph, "Garden"), shape(2, "", ph, "Garden")],
    shape(8, "", '<p:ph idx="4" type="title"/>')
  );
  const all = await readAccessibility(input, {}, context);
  expect(all.slides.map((x) => [x.missingTitle, x.duplicateTitle])).toEqual([
    [false, true],
    [false, true]
  ]);
  const scoped = await readAccessibility(input, { select: all.objects[0]!.token }, context);
  expect(scoped.slides.map((x) => x.slide)).toEqual([1]);
  expect((await readAccessibility(input, { scope: "layouts" }, context)).slides).toEqual([]);
});
it("rejects ambiguous layout metadata rather than inventing a fallback", async () => {
  const ph = '<p:ph idx="4"/>';
  await expect(
    readAccessibility(
      await deck([shape(2, "", ph)], shape(8, "", ph) + shape(9, "", ph)),
      {},
      context
    )
  ).rejects.toMatchObject({ code: "ambiguous-selection" });
});
function extendedShape(extension: string, ph = "") {
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Extended"><a:extLst>${extension}</a:extLst></p:cNvPr><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/></p:sp>`;
}
const ext = (body: string) => `<a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}">${body}</a:ext>`;
it("preserves unrelated extensions and ignores same-name decorative elements in foreign namespaces", async () => {
  const opaque = '<v:decorative xmlns:v="urn:example:shape" val="1"/>';
  const input = await deck([extendedShape(ext(opaque))]);
  expect((await readAccessibility(input, {}, context)).objects[0]?.decorative).toBeNull();
  const result = await mutateAccessibility(
    input,
    { slide: 1, shape: "Extended", update: { decorative: true } },
    context
  );
  const xml = inspectZip(result.bytes).find((x) => x.name === "ppt/slides/slide1.xml")!.payload;
  expect(new TextDecoder().decode(xml)).toContain(opaque);
});
it("rejects duplicate supported decorative nodes without publishing partial updates", async () => {
  const item = `<d:decorative xmlns:d="${decorative}" val="1"/>`;
  const input = await deck([extendedShape(ext(item + item))]);
  await expect(
    mutateAccessibility(
      input,
      { slide: 1, shape: "Extended", update: { title: "Change" } },
      context
    )
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("treats a present decorative element without a value as unknown and prevents layout fallback", async () => {
  const ph = '<p:ph idx="4"/>';
  const input = await deck(
    [extendedShape(ext(`<d:decorative xmlns:d="${decorative}"/>`), ph)],
    extendedShape(ext(`<d:decorative xmlns:d="${decorative}" val="1"/>`), ph)
  );
  expect((await readAccessibility(input, {}, context)).objects[0]).toMatchObject({
    decorative: null,
    provenance: { decorative: { part: "/ppt/slides/slide1.xml", shapeId: "2", inherited: false } }
  });
});
it("reports slides affected by edits to shared layout metadata", async () => {
  const input = await deck([shape(2), shape(2)], shape(8));
  const result = await mutateAccessibility(
    input,
    { scope: "layouts", shape: "Object 8", update: { altText: "Shared guide" } },
    context
  );
  expect(result.affectedSlides).toEqual([1, 2]);
  expect(
    (await readAccessibility(result.bytes, { scope: "layouts" }, context)).objects[0]?.inheritedBy
  ).toEqual([1, 2]);
});
it("rejects mixing a token with explicit scope before reading input", async () => {
  await expect(
    readAccessibility(new Uint8Array(), { select: "token", scope: "slides" }, context)
  ).rejects.toMatchObject({ code: "invalid-selection" });
  await expect(
    mutateAccessibility(
      new Uint8Array(),
      { select: "token", scope: "slides", update: { title: "Title" } },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-selection" });
});
it("returns fresh selection tokens after metadata edits", async () => {
  const input = await deck([shape(2)]);
  const result = await mutateAccessibility(
    input,
    { slide: 1, shape: "Object 2", update: { title: "First" } },
    context
  );
  const next = await mutateAccessibility(
    result.bytes,
    { select: result.records[0]!.token, update: { title: "Second" } },
    context
  );
  expect((await readAccessibility(next.bytes, {}, context)).objects[0]?.title).toBe("Second");
});
it.each([
  [" true ", true],
  ["&#x9;0&#xA;", false]
])("reads decorative booleans with XML whitespace %s", async (value, expected) => {
  const input = await deck([
    extendedShape(ext(`<d:decorative xmlns:d="${decorative}" val="${value}"/>`))
  ]);
  expect((await readAccessibility(input, {}, context)).objects[0]?.decorative).toBe(expected);
});
function changingSource(bytes: Uint8Array, change: () => void) {
  let offset = 0;
  return {
    read: async (maxBytes: number) => {
      change();
      if (offset === bytes.length) return null;
      const chunk = bytes.slice(offset, offset + maxBytes);
      offset += chunk.length;
      return chunk;
    }
  };
}
it("snapshots validated metadata before invoking the byte capability", async () => {
  const input = await deck([shape(2)]);
  const update = { decorative: false, title: "Original" };
  const result = await mutateAccessibility(
    changingSource(input, () => {
      Object.assign(update, { decorative: "false", title: "Replaced" });
    }),
    { slide: 1, shape: "Object 2", update },
    context
  );
  expect((await readAccessibility(result.bytes, {}, context)).objects[0]).toMatchObject({
    decorative: false,
    title: "Original"
  });
});
it("snapshots validated read selections before invoking the byte capability", async () => {
  const input = await deck([shape(2), shape(3)]);
  const options = { slide: 1 };
  const result = await readAccessibility(
    changingSource(input, () => {
      options.slide = 2;
    }),
    options,
    context
  );
  expect(result.objects.map((x) => x.id)).toEqual(["2"]);
  expect(result.slides.map((x) => x.slide)).toEqual([1]);
});
it("retains stored nonenumerable selections and rejects accessor selections", async () => {
  const input = await deck([shape(2), shape(3)]);
  const selection = Object.defineProperty({}, "slide", { value: 1 });
  expect((await readAccessibility(input, selection, context)).objects.map((x) => x.id)).toEqual([
    "2"
  ]);
  const getter = vi.fn(() => 1);
  await expect(
    readAccessibility(
      new Uint8Array(),
      Object.defineProperty({}, "slide", { get: getter }),
      context
    )
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(getter).not.toHaveBeenCalled();
});
