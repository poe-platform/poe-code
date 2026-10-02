import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPresentation } from "./creation.js";
import { listLinks, setLink, removeLink, openLinkSession } from "./links.js";
import { parseXmlPart, type XmlPart } from "./xml.js";
import { writePackageArchive } from "./package-writer.js";
import { importSlides } from "./slide-import.js";
import { removeSlides } from "./slide-removal.js";
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
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, delay?: number) =>
    delay === 0 ? setImmediate(cb) : timer(cb, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const selection = { kind: "object", owner: "/ppt/slides/slide1.xml", id: "2" } as const;
async function deck() {
  return createPresentation(
    {
      slides: [
        { shapes: [{ x: 0, y: 0, width: 100, height: 100, text: "Garden" }] },
        { shapes: [] }
      ]
    },
    context
  );
}
function nodes(bytes: Uint8Array, part: string, local: string) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  const xml = new TextDecoder().decode(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).find((x) => x.name === part)!
      .payload
  );
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      result.push(
        Object.fromEntries(
          Object.values(tag.attributes)
            .filter((a) => a.uri !== "http://www.w3.org/2000/xmlns/")
            .map((a) => [`${a.uri}|${a.local}`, a.value])
        )
      );
  });
  parser.write(xml).close();
  return result;
}
it.each(["https://example.test/a?q=1&b=2", "../guide.html#chapter", "mailto:reader@example.test"])(
  "writes inert URL %s with owner-local relationship",
  async (url) => {
    const output = await setLink(await deck(), { selection, url }, context);
    expect(nodes(output, "ppt/slides/slide1.xml", "hlinkClick")).toEqual([
      { "http://schemas.openxmlformats.org/officeDocument/2006/relationships|id": "rId2" }
    ]);
    expect(nodes(output, "ppt/slides/_rels/slide1.xml.rels", "Relationship")).toContainEqual({
      "|Id": "rId2",
      "|Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
      "|Target": url,
      "|TargetMode": "External"
    });
    expect(await listLinks(output, {}, context)).toMatchObject([
      { kind: "url", url, requiresSanitization: false }
    ]);
  }
);
it("replaces a URL with an internal target and removes its unused relationship", async () => {
  const linked = await setLink(await deck(), { selection, url: "https://example.test" }, context);
  const output = await setLink(linked, { selection, targetSlide: 2 }, context);
  expect(nodes(output, "ppt/slides/slide1.xml", "hlinkClick")[0]?.["|action"]).toBe(
    "ppaction://hlinksldjump"
  );
  expect(nodes(output, "ppt/slides/_rels/slide1.xml.rels", "Relationship")).toHaveLength(2);
  expect(await listLinks(output, {}, context)).toMatchObject([
    { kind: "slide", targetSlide: 2, url: null }
  ]);
  const removed = await removeLink(output, { selection }, context);
  expect(nodes(removed, "ppt/slides/slide1.xml", "hlinkClick")).toEqual([]);
  expect(nodes(removed, "ppt/slides/_rels/slide1.xml.rels", "Relationship")).toHaveLength(1);
});
it.each(["javascript:alert(1)", "data:text/html,hello", "file:///tmp/script", "vbscript:run"])(
  "rejects active URL %s",
  async (url) => {
    await expect(setLink(await deck(), { selection, url }, context)).rejects.toMatchObject({
      code: "invalid-value"
    });
  }
);
it("writes targetless navigation without a relationship", async () => {
  const output = await setLink(
    await deck(),
    { selection, action: "next-slide", trigger: "hover" },
    context
  );
  expect(nodes(output, "ppt/slides/slide1.xml", "hlinkHover")).toEqual([
    { "|action": "ppaction://hlinkshowjump?jump=nextslide" }
  ]);
  expect(await listLinks(output, {}, context)).toMatchObject([
    { kind: "navigation", action: "ppaction://hlinkshowjump?jump=nextslide", targetSlide: 2 }
  ]);
});

it("retains identical edits byte-for-byte", async () => {
  const output = await setLink(await deck(), { selection, url: "../guide.html" }, context);
  expect(await setLink(output, { selection, url: "../guide.html" }, context)).toEqual(output);
});
it("rejects navigation with an unknown explicit action", async () => {
  await expect(
    setLink(await deck(), { selection, action: "anything" as never }, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
});

async function rewrite(input: Uint8Array, part: string, edit: (xml: XmlPart) => XmlPart) {
  const entries = inspectZip(input).map(({ name, payload }) => ({
    name,
    bytes: name === part ? edit(parseXmlPart(payload, context.xmlLimits)).bytes() : payload
  }));
  return writePackageArchive(entries, context, { compression: "store" });
}
function linkAction(xml: XmlPart, action: string) {
  const parent = xml.root.children[0]!.children[0]!.children[2]!.children[0]!.children[0]!;
  return xml.merge(parent, {
    children: {
      sequence: [
        {
          namespace: "http://schemas.openxmlformats.org/drawingml/2006/main",
          localName: "hlinkClick"
        }
      ],
      upsert: [
        {
          name: {
            namespace: "http://schemas.openxmlformats.org/drawingml/2006/main",
            localName: "hlinkClick"
          },
          merge: { attributes: [{ namespace: "", localName: "action", value: action }] }
        }
      ]
    }
  });
}
it.each(["program", "macro", "ole"])(
  "requires explicit sanitization for %s and preserves reads",
  async (action) => {
    const input = await rewrite(await deck(), "ppt/slides/slide1.xml", (xml) =>
      linkAction(xml, `ppaction://${action}`)
    );
    const before = input.slice();
    expect(await listLinks(input, {}, context)).toMatchObject([
      { kind: "unsupported", requiresSanitization: true }
    ]);
    expect(input).toEqual(before);
    await expect(
      setLink(input, { selection, url: "https://example.test" }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    await expect(removeLink(input, { selection }, context)).rejects.toMatchObject({
      code: "unsupported-edit"
    });
    expect(
      await listLinks(await removeLink(input, { selection, sanitize: true }, context), {}, context)
    ).toEqual([]);
  }
);
it.each([
  "ppaction://customshowEvil?id=7",
  "ppaction://customshow?id=7",
  "ppaction://customshow?id=bad"
])("flags unresolved custom show %s", async (action) => {
  const input = await rewrite(await deck(), "ppt/slides/slide1.xml", (xml) =>
    linkAction(xml, action)
  );
  expect(await listLinks(input, {}, context)).toMatchObject([{ requiresSanitization: true }]);
});
it("does not retarget custom-show actions when merging presentations", async () => {
  const input = await rewrite(await deck(), "ppt/slides/slide1.xml", (xml) =>
    linkAction(xml, "ppaction://customshow?id=7")
  );
  await expect(
    importSlides(await deck(), input, { sourceSlides: [1, 2], themePolicy: "source" }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("remaps explicit slide links during merge and rejects omitted targets", async () => {
  const input = await setLink(await deck(), { selection, targetSlide: 2 }, context);
  await expect(
    importSlides(await deck(), input, { sourceSlides: [1], themePolicy: "source" }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit" });
  const output = await importSlides(
    await deck(),
    input,
    { sourceSlides: [1, 2], themePolicy: "source" },
    context
  );
  expect(await listLinks(output, {}, context)).toMatchObject([
    { targetSlide: 4, kind: "slide", part: "/ppt/slides/slide1-import1.xml" }
  ]);
});
it("requires explicit policy when removing a linked slide", async () => {
  const input = await setLink(await deck(), { selection, targetSlide: 2 }, context);
  const target = { kind: "slide", position: { coordinateSystem: "one-based", value: 2 } } as const;
  await expect(removeSlides(input, { selection: target }, context)).rejects.toMatchObject({
    code: "dangling-reference"
  });
  expect(
    await listLinks(
      await removeSlides(input, { selection: target, referencePolicy: "remove" }, context),
      {},
      context
    )
  ).toEqual([]);
});
it("reports an absent slide target as a selection failure", async () => {
  await expect(setLink(await deck(), { selection, targetSlide: 3 }, context)).rejects.toMatchObject(
    { code: "missing-selection" }
  );
});

it("edits a bounded session synchronously and rolls back failed changes", async () => {
  const session = await openLinkSession(await deck(), context);
  session.set({ selection, url: "https://example.test/session" });
  expect(session.list(selection)).toMatchObject([{ url: "https://example.test/session" }]);
  expect(() => session.set({ selection, targetSlide: 99 })).toThrow();
  expect(session.list(selection)).toMatchObject([{ url: "https://example.test/session" }]);
  session.set({ selection, targetSlide: 2 });
  expect(await listLinks(await session.save(), {}, context)).toMatchObject([
    { targetSlide: 2, kind: "slide" }
  ]);
});
it("edits and removes an empty inert hyperlink without sanitization", async () => {
  const input = await rewrite(await deck(), "ppt/slides/slide1.xml", (xml) => linkAction(xml, ""));
  expect(await listLinks(input, {}, context)).toMatchObject([
    { kind: "url", url: null, requiresSanitization: false }
  ]);
  expect(await listLinks(await removeLink(input, { selection }, context), {}, context)).toEqual([]);
  expect(
    await listLinks(await setLink(input, { selection, url: "../guide.html" }, context), {}, context)
  ).toMatchObject([{ url: "../guide.html" }]);
});
it("preserves sibling hover links, shared relationships and foreign action metadata", async () => {
  let input = await setLink(await deck(), { selection, url: "../guide.html" }, context);
  input = await rewrite(input, "ppt/slides/slide1.xml", (xml) => {
    const parent = xml.root.children[0]!.children[0]!.children[2]!.children[0]!.children[0]!;
    const changed = xml.merge(parent.children[0]!, {
      attributes: [
        {
          namespace: "http://schemas.openxmlformats.org/drawingml/2006/main",
          localName: "action",
          value: "retained"
        },
        { namespace: "", localName: "tooltip", value: "A useful guide" }
      ]
    });
    const next = changed.root.children[0]!.children[0]!.children[2]!.children[0]!.children[0]!;
    return changed.spliceChildren(next, next.children.length, 0, [
      '<a:hlinkHover xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId2"/>'
    ]);
  });
  const updated = await setLink(input, { selection, url: "https://example.test/new" }, context);
  expect(nodes(updated, "ppt/slides/slide1.xml", "hlinkClick")[0]).toMatchObject({
    "http://schemas.openxmlformats.org/drawingml/2006/main|action": "retained",
    "|tooltip": "A useful guide"
  });
  expect(await listLinks(updated, {}, context)).toMatchObject([
    { url: "https://example.test/new" },
    { url: "../guide.html", trigger: "hover" }
  ]);
  const removed = await removeLink(updated, { selection }, context);
  expect(nodes(removed, "ppt/slides/_rels/slide1.xml.rels", "Relationship")).toHaveLength(2);
  expect(await listLinks(removed, {}, context)).toMatchObject([
    { url: "../guide.html", trigger: "hover" }
  ]);
});
it("selects an existing run property without changing its shape click link", async () => {
  let input = await setLink(
    await deck(),
    { selection, url: "https://example.test/shape" },
    context
  );
  input = await rewrite(input, "ppt/slides/slide1.xml", (xml) => {
    const run = xml.root.children[0]!.children[0]!.children[2]!.children.find(
      (n) => n.name.localName === "txBody"
    )!
      .children.find((n) => n.name.localName === "p")!
      .children.find((n) => n.name.localName === "r")!;
    return xml.spliceChildren(run, 0, 0, [
      '<a:rPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" b="1"/>'
    ]);
  });
  const xml = parseXmlPart(
    inspectZip(input).find((e) => e.name === "ppt/slides/slide1.xml")!.payload,
    context.xmlLimits
  );
  let path: number[] = [];
  const visit = (node: typeof xml.root, indices: number[]) => {
    if (node.name.localName === "rPr") path = indices;
    node.children.forEach((child, i) => visit(child, [...indices, i]));
  };
  visit(xml.root, []);
  const updated = await setLink(input, { selection, path, url: "../run.html" }, context);
  expect(await listLinks(updated, {}, context)).toMatchObject([
    { url: "https://example.test/shape" },
    { url: "../run.html" }
  ]);
  expect(nodes(updated, "ppt/slides/slide1.xml", "rPr")).toEqual([{ "|b": "1" }]);
});
it("preserves valid custom-show membership while inspecting its action", async () => {
  let input = await rewrite(await deck(), "ppt/slides/slide1.xml", (xml) =>
    linkAction(xml, "ppaction://customshow?id=7&return=true")
  );
  input = await rewrite(input, "ppt/presentation.xml", (xml) =>
    xml.spliceChildren(xml.root, xml.root.children.length, 0, [
      '<p:custShowLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:custShow name="Short tour" id="7"><p:sldLst><p:sld r:id="rId2"/></p:sldLst></p:custShow></p:custShowLst>'
    ])
  );
  expect(await listLinks(input, {}, context)).toMatchObject([
    { kind: "custom-show", requiresSanitization: false }
  ]);
});
it("writes internal relationships for a slide stored at the package root", async () => {
  const bytes = await deck();
  const entries = inspectZip(bytes).map(({ name, payload }) => {
    let xml = parseXmlPart(payload, context.xmlLimits);
    if (name === "[Content_Types].xml") {
      const node = xml.root.children.find((n) =>
        n.attributes.some(
          (a) => a.name.localName === "PartName" && a.value === "/ppt/slides/slide1.xml"
        )
      )!;
      xml = xml.merge(node, {
        attributes: [{ namespace: "", localName: "PartName", value: "/cover.xml" }]
      });
    }
    if (name === "ppt/_rels/presentation.xml.rels") {
      const node = xml.root.children.find((n) =>
        n.attributes.some((a) => a.name.localName === "Target" && a.value === "slides/slide1.xml")
      )!;
      xml = xml.merge(node, {
        attributes: [{ namespace: "", localName: "Target", value: "../cover.xml" }]
      });
    }
    if (name === "ppt/slides/_rels/slide1.xml.rels") {
      name = "_rels/cover.xml.rels";
      xml = xml.merge(xml.root.children[0]!, {
        attributes: [
          { namespace: "", localName: "Target", value: "ppt/slideLayouts/slideLayout1.xml" }
        ]
      });
    }
    if (name === "ppt/slides/slide1.xml") name = "cover.xml";
    return { name, bytes: xml.bytes() };
  });
  const input = await writePackageArchive(entries, context, { compression: "store" });
  const output = await setLink(
    input,
    { selection: { ...selection, owner: "/cover.xml" }, targetSlide: 2 },
    context
  );
  expect(nodes(output, "_rels/cover.xml.rels", "Relationship")).toContainEqual({
    "|Id": "rId2",
    "|Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
    "|Target": "ppt/slides/slide2.xml"
  });
  expect(await listLinks(output, {}, context)).toMatchObject([
    { part: "/cover.xml", targetSlide: 2 }
  ]);
});
it("cancels synchronous session changes before mutating state", async () => {
  const controller = new AbortController();
  const session = await openLinkSession(await deck(), { ...context, signal: controller.signal });
  controller.abort();
  expect(() => session.set({ selection, url: "../guide.html" })).toThrow();
});
it("reuses an equivalent relationship within one owning part", async () => {
  const input = await setLink(await deck(), { selection, url: "../guide.html" }, context);
  const output = await setLink(
    input,
    { selection, url: "../guide.html", trigger: "hover" },
    context
  );
  expect(nodes(output, "ppt/slides/_rels/slide1.xml.rels", "Relationship")).toHaveLength(2);
  expect(
    nodes(output, "ppt/slides/slide1.xml", "hlinkHover")[0]?.[
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships|id"
    ]
  ).toBe("rId2");
});
it("authors Strict relationship attributes without changing the XML dialect", async () => {
  const p = "http://purl.oclc.org/ooxml/presentationml/main";
  const a = "http://purl.oclc.org/ooxml/drawingml/main";
  const r = "http://purl.oclc.org/ooxml/officeDocument/relationships";
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const values = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    "ppt/presentation.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="100000" cy="100000"/><p:notesSz cx="100000" cy="100000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${r}/slide" Target="slides/slide1.xml"/></Relationships>`,
    "ppt/slides/slide1.xml": `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Map"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp></p:spTree></p:cSld></p:sld>`
  };
  const input = await writePackageArchive(
    Object.entries(values).map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })),
    context,
    { compression: "store" }
  );
  const output = await setLink(input, { selection, url: "https://example.test/strict" }, context);
  expect(nodes(output, "ppt/slides/slide1.xml", "hlinkClick")).toEqual([{ [`${r}|id`]: "rId1" }]);
  expect(nodes(output, "ppt/slides/_rels/slide1.xml.rels", "Relationship")[0]?.["|Type"]).toBe(
    `${r}/hyperlink`
  );
  expect(nodes(output, "ppt/slides/slide1.xml", "sld")).toHaveLength(1);
});
async function runProperties(
  input: Uint8Array,
  tag: "rPr" | "defRPr" | "endParaRPr",
  content = ""
) {
  const changed = await rewrite(input, "ppt/slides/slide1.xml", (xml) => {
    const paragraph = xml.root.children[0]!.children[0]!.children[2]!.children.find(
      (n) => n.name.localName === "txBody"
    )!.children.find((n) => n.name.localName === "p")!;
    const markup = `<a:${tag} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${content}</a:${tag}>`;
    if (tag === "rPr") {
      const run = paragraph.children.find((n) => n.name.localName === "r")!;
      return xml.spliceChildren(run, 0, 0, [markup]);
    }
    return xml.spliceChildren(paragraph, tag === "defRPr" ? 0 : paragraph.children.length, 0, [
      tag === "defRPr"
        ? `<a:pPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${markup}</a:pPr>`
        : markup
    ]);
  });
  const xml = parseXmlPart(
    inspectZip(changed).find((e) => e.name === "ppt/slides/slide1.xml")!.payload,
    context.xmlLimits
  );
  let path: number[] = [];
  const visit = (node: typeof xml.root, indices: number[]) => {
    if (node.name.localName === tag) path = indices;
    node.children.forEach((child, i) => visit(child, [...indices, i]));
  };
  visit(xml.root, []);
  return { input: changed, path };
}
it.each(["rPr", "defRPr", "endParaRPr"] as const)(
  "writes correctly scoped mouse-over before rtl in %s",
  async (tag) => {
    const { input, path } = await runProperties(await deck(), tag, '<a:rtl val="1"/>');
    const output = await setLink(
      input,
      { selection, path, trigger: "hover", url: "../run-guide.html" },
      context
    );
    expect(nodes(output, "ppt/slides/slide1.xml", "hlinkMouseOver")).toHaveLength(1);
    expect(nodes(output, "ppt/slides/slide1.xml", "hlinkHover")).toHaveLength(0);
    const xml = parseXmlPart(
      inspectZip(output).find((e) => e.name === "ppt/slides/slide1.xml")!.payload,
      context.xmlLimits
    );
    let parent = xml.root;
    for (const i of path) parent = parent.children[i]!;
    expect(parent.children.map((n) => n.name.localName)).toEqual(["hlinkMouseOver", "rtl"]);
    expect(await listLinks(output, {}, context)).toMatchObject([
      { trigger: "hover", url: "../run-guide.html" }
    ]);
    expect(
      await listLinks(
        await removeLink(output, { selection, path, trigger: "hover" }, context),
        {},
        context
      )
    ).toEqual([]);
  }
);
it("removes explicit run mouse-over targets only with the requested slide policy", async () => {
  const source = await setLink(await deck(), { selection, targetSlide: 2 }, context);
  const { input } = await runProperties(
    source,
    "rPr",
    '<a:hlinkMouseOver r:id="rId2" action="ppaction://hlinksldjump"/>'
  );
  expect(await listLinks(input, {}, context)).toHaveLength(2);
  const output = await removeSlides(
    input,
    {
      selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 2 } },
      referencePolicy: "remove"
    },
    context
  );
  expect(nodes(output, "ppt/slides/slide1.xml", "hlinkMouseOver")).toHaveLength(0);
});
it("rejects unsafe run mouse-over actions during cross-deck import", async () => {
  const { input } = await runProperties(
    await deck(),
    "rPr",
    '<a:hlinkMouseOver action="ppaction://macro"/>'
  );
  await expect(
    importSlides(await deck(), input, { sourceSlides: [1, 2], themePolicy: "source" }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});
it.each(["list", "getPart"] as const)("cancels session %s reads", async (operation) => {
  const controller = new AbortController();
  const session = await openLinkSession(await deck(), { ...context, signal: controller.signal });
  controller.abort();
  expect(() =>
    operation === "list" ? session.list() : session.getPart("/ppt/slides/slide1.xml")
  ).toThrow();
});
it("retains the literal relationship target separately from ordinary URL semantics", async () => {
  const bytes = await setLink(await deck(), { selection, targetSlide: 2 }, context);
  expect(await listLinks(bytes, {}, context)).toMatchObject([
    { url: null, targetReference: "slide2.xml", targetSlide: 2 }
  ]);
});
it("flags a shape-hover element misplaced under run properties", async () => {
  const { input, path } = await runProperties(await deck(), "rPr", "<a:hlinkHover/>");
  expect(await listLinks(input, {}, context)).toMatchObject([
    { kind: "unsupported", requiresSanitization: true }
  ]);
  await expect(
    removeLink(input, { selection, path, trigger: "hover" }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(
    await listLinks(
      await removeLink(input, { selection, path, trigger: "hover", sanitize: true }, context),
      {},
      context
    )
  ).toEqual([]);
});
