import { readPackage } from "./package-reader.js";
import { validatePresentation } from "./validation.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPresentation, readImages, replaceImage, readSelectionIndex } from "./index.js";
import { writePackageArchive } from "./package-writer.js";
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
const tile = new Uint8Array([
  71, 73, 70, 56, 57, 97, 4, 0, 2, 0, 128, 0, 0, 0, 0, 0, 20, 90, 160, 33, 249, 4, 1, 0, 0, 0, 0,
  44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59
]);
const replacement = new Uint8Array([
  255, 216, 255, 192, 0, 11, 8, 0, 3, 0, 6, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 19, 255,
  0, 24, 255, 217
]);
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relns = "http://schemas.openxmlformats.org/package/2006/relationships";
const encode = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
function parts(bytes: Uint8Array) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", bytes);
  return new Map(
    inspectZip(new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer)).map((x) => [
      x.name,
      x.payload
    ])
  );
}
function attrs(bytes: Uint8Array, local: string) {
  const rows: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      rows.push(
        Object.fromEntries(
          Object.values(tag.attributes)
            .filter((x) => x.uri !== "http://www.w3.org/2000/xmlns/")
            .map((x) => [x.name, x.value])
        )
      );
  });
  parser.write(text(bytes)).close();
  return rows;
}
async function fixture(strict = false, extra = "") {
  const entries = parts(await createPresentation({ slides: [{}, {}] }, context));
  const pic = (id: number) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Panel ${id}" descr="Ocean &amp; ice" title="Survey"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="art">${extra}</a:blip><a:srcRect l="-10000" t="42424" r="250000" b="0"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="11" y="22"/><a:ext cx="300" cy="400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const owners = [
    "ppt/slides/slide1.xml",
    "ppt/slides/slide2.xml",
    "ppt/slideMasters/slideMaster1.xml",
    "ppt/notesSlides/notesSlide1.xml"
  ];
  const emptySlide = text(entries.get("ppt/slides/slide2.xml")!);
  for (const [i, owner] of owners.entries()) {
    const base = entries.has(owner)
      ? text(entries.get(owner)!)
      : emptySlide.split("p:sld").join("p:notes");
    entries.set(
      owner,
      encode(base.replace("</p:spTree>", `${pic(2)}${i === 0 ? pic(3) : ""}</p:spTree>`))
    );

    const slash = owner.lastIndexOf("/");
    const rel = `${owner.slice(0, slash)}/_rels/${owner.slice(slash + 1)}.rels`;
    let xml = entries.has(rel)
      ? text(entries.get(rel)!)
      : `<Relationships xmlns="${relns}"></Relationships>`;
    xml = xml.replace(
      "</Relationships>",
      `<Relationship Id="art" Type="${r}/image" Target="../media/tile.gif"/>${i === 0 ? `<Relationship Id="note" Type="${r}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>` : i === 3 ? `<Relationship Id="back" Type="${r}/slide" Target="../slides/slide1.xml"/><Relationship Id="master" Type="${r}/notesMaster" Target="../notesMasters/notesMaster1.xml"/>` : ""}</Relationships>`
    );
    entries.set(rel, encode(xml));
  }
  entries.set("ppt/media/tile.gif", tile);
  entries.set(
    "ppt/notesMasters/notesMaster1.xml",
    encode(
      `<p:notesMaster xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap/></p:notesMaster>`
    )
  );
  entries.set(
    "[Content_Types].xml",
    encode(
      text(entries.get("[Content_Types].xml")!).replace(
        "</Types>",
        '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/ppt/media/tile.gif" ContentType="image/gif"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>'
      )
    )
  );
  if (strict)
    for (const [name, b] of entries)
      if (name.endsWith(".xml") || name.endsWith(".rels"))
        entries.set(
          name,
          encode(
            text(b)
              .split(p)
              .join("http://purl.oclc.org/ooxml/presentationml/main")
              .split(a)
              .join("http://purl.oclc.org/ooxml/drawingml/main")
              .split(r)
              .join("http://purl.oclc.org/ooxml/officeDocument/relationships")
          )
        );
  const archive = await writePackageArchive(
    [...entries].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "auto" }
  );
  expect(
    validatePresentation(await readPackage(archive, context), {
      ...context.xmlLimits,
      ...context.relationshipLimits,
      maxEntries: 100
    }).issues
  ).toEqual([]);
  return archive;
}
it.each([false, true])(
  "clones only one occurrence across slide master and notes sharing, Strict=%s",
  async (strict) => {
    const input = await fixture(strict),
      before = parts(input);
    const result = await replaceImage(
      input,
      { slide: 1, image: 1 },
      replacement,
      { contentType: "image/jpeg" },
      context
    );
    const after = parts(result.bytes);
    expect(result.affected).toBe(1);
    expect(result.affectedSlides).toEqual([1]);
    expect(after.get("ppt/media/tile.gif")).toEqual(tile);
    expect(after.get("ppt/media/image1.jpg")).toEqual(replacement);
    for (const owner of [
      "ppt/slides/slide2.xml",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/notesSlides/notesSlide1.xml"
    ])
      expect(after.get(owner)).toEqual(before.get(owner));
    const blips = attrs(after.get("ppt/slides/slide1.xml")!, "blip");
    expect(blips.map((x) => x["r:embed"])).toEqual(["rId2", "art"]);
    expect(attrs(after.get("ppt/slides/slide1.xml")!, "srcRect")).toEqual([
      { l: "-10000", t: "42424", r: "250000", b: "0" },
      { l: "-10000", t: "42424", r: "250000", b: "0" }
    ]);
    expect(attrs(after.get("ppt/slides/slide1.xml")!, "xfrm").slice(1)).toEqual([
      { rot: "5400000", flipH: "1" },
      { rot: "5400000", flipH: "1" }
    ]);
    expect(result.occurrences[0]).toMatchObject({
      altText: "Ocean & ice",
      title: "Survey",
      mediaPart: "/ppt/media/image1.jpg"
    });
  }
);
it("replaces a shared part with all affected occurrences and removes stale declarations", async () => {
  const input = await fixture();
  const result = await replaceImage(
    input,
    { slide: 1, image: 1 },
    replacement,
    { contentType: "image/jpeg", shared: true },
    context
  );
  const after = parts(result.bytes);
  expect(result.affected).toBe(5);
  expect(result.affectedSlides).toEqual([1, 2]);
  expect(result.occurrences.map((x) => x.scope).sort()).toEqual([
    "masters",
    "notes",
    "slides",
    "slides",
    "slides"
  ]);
  expect(after.has("ppt/media/tile.gif")).toBe(false);
  expect(attrs(after.get("[Content_Types].xml")!, "Override")).not.toContainEqual({
    PartName: "/ppt/media/tile.gif",
    ContentType: "image/gif"
  });
  expect(
    attrs(after.get("[Content_Types].xml")!, "Default").some((x) => x.Extension === "gif")
  ).toBe(false);
  for (const [name, bytes] of after)
    if (name.endsWith(".rels"))
      expect(attrs(bytes, "Relationship").some((x) => x.Target?.endsWith("tile.gif"))).toBe(false);
  expect((await readImages(result.bytes, { scope: "shared" }, context)).media).toHaveLength(1);
});
it("applies explicit crop geometry and alternative-text reset only to selected occurrences", async () => {
  const result = await replaceImage(
    await fixture(),
    { slide: 1, image: 1 },
    replacement,
    {
      contentType: "image/jpeg",
      preserveCrop: false,
      preserveGeometry: false,
      preserveAltText: false,
      altText: "New & clear"
    },
    context
  );
  const slide = parts(result.bytes).get("ppt/slides/slide1.xml")!;
  expect(attrs(slide, "srcRect")).toHaveLength(1);
  expect(attrs(slide, "xfrm").slice(1)).toEqual([{}, { rot: "5400000", flipH: "1" }]);
  expect(attrs(slide, "off")[1]).toEqual({ x: "0", y: "0" });
  expect(attrs(slide, "ext")[1]).toEqual({ cx: "76200", cy: "38100" });
  expect(attrs(slide, "cNvPr")[1]).toEqual({ id: "2", name: "Panel 2", descr: "New & clear" });
});
it("selects a master occurrence explicitly without changing its shared peers", async () => {
  const result = await replaceImage(
    await fixture(),
    { scope: "masters", image: 1 },
    replacement,
    { contentType: "image/jpeg" },
    context
  );
  expect(result.affected).toBe(1);
  expect(result.affectedSlides).toEqual([1, 2]);
  expect(result.occurrences[0]!.scope).toBe("masters");
});
it("owns replacement bytes and option snapshots before asynchronous input", async () => {
  const input = await fixture(),
    bytes = replacement.slice(),
    options = { contentType: "image/jpeg", shared: false };
  const pending = replaceImage(input, { slide: 1, image: 1 }, bytes, options, context);
  bytes.fill(0);
  options.shared = true;
  const result = await pending;
  expect(result.affected).toBe(1);
  expect(parts(result.bytes).get("ppt/media/image1.jpg")).toEqual(replacement);
});
it("rejects stale object tokens", async () => {
  const input = await fixture();
  const index = await readSelectionIndex(input, context);
  const token = index.objects.find(
    (x) => x.part === "/ppt/slides/slide1.xml" && x.id === "2"
  )!.token;
  const result = await replaceImage(
    input,
    { select: token },
    replacement,
    { contentType: "image/jpeg" },
    context
  );
  await expect(
    replaceImage(
      result.bytes,
      { select: token },
      replacement,
      { contentType: "image/jpeg" },
      context
    )
  ).rejects.toMatchObject({ code: "stale-selection" });
});
it("allows explicit empty selection and rejects accidental broad selection", async () => {
  const input = await fixture();
  await expect(
    replaceImage(input, {}, replacement, { contentType: "image/jpeg" }, context)
  ).rejects.toMatchObject({ code: "invalid-selection" });
  await expect(
    replaceImage(
      input,
      { slide: 1, image: 99 },
      replacement,
      { contentType: "image/jpeg" },
      context
    )
  ).rejects.toMatchObject({ code: "missing-selection" });
  const result = await replaceImage(
    input,
    { slide: 1, image: 99 },
    replacement,
    { contentType: "image/jpeg", allowEmpty: true },
    context
  );
  expect(result.affected).toBe(0);
  expect(result.bytes).toEqual(input);
});
it("cancels asynchronous acquisition without mutating input", async () => {
  const input = await fixture(),
    original = input.slice(),
    controller = new AbortController();
  const source = {
    read: async () => {
      controller.abort();
      return input;
    }
  };
  await expect(
    replaceImage(
      source,
      { slide: 1, image: 1 },
      replacement,
      { contentType: "image/jpeg" },
      { ...context, signal: controller.signal }
    )
  ).rejects.toBeDefined();
  expect(input).toEqual(original);
});
it("keeps identical replacement bytes and preserved metadata as a serialized no-change", async () => {
  const input = await fixture();
  const result = await replaceImage(
    input,
    { slide: 1, image: 1 },
    tile,
    { contentType: "image/gif" },
    context
  );
  expect(result.affected).toBe(1);
  expect(result.bytes).toEqual(input);
});
it("rebinds all selected slide pictures without widening to masters or notes", async () => {
  const result = await replaceImage(
    await fixture(),
    { slide: 1 },
    replacement,
    { contentType: "image/jpeg", all: true },
    context
  );
  const output = parts(result.bytes);
  expect(result.affected).toBe(2);
  expect(result.occurrences.every((x) => x.sourcePart === "/ppt/slides/slide1.xml")).toBe(true);
  const relationships = attrs(output.get("ppt/slides/_rels/slide1.xml.rels")!, "Relationship");
  expect(relationships.some((x) => x.Id === "art")).toBe(false);
  expect(output.get("ppt/media/tile.gif")).toEqual(tile);
  expect(attrs(output.get("ppt/slides/slide2.xml")!, "blip")).toEqual([{ "r:embed": "art" }]);
});
it("removes old media and content types after explicitly replacing every occurrence locally", async () => {
  const input = await fixture();
  let bytes = input;
  for (const selector of [
    { slide: 1 },
    { slide: 2 },
    { scope: "masters" as const },
    { scope: "notes" as const }
  ])
    bytes = (
      await replaceImage(
        bytes,
        selector,
        replacement,
        { contentType: "image/jpeg", all: true },
        context
      )
    ).bytes;
  const output = parts(bytes);
  expect(output.has("ppt/media/tile.gif")).toBe(false);
  expect(
    attrs(output.get("[Content_Types].xml")!, "Override").some(
      (x) => x.PartName === "/ppt/media/tile.gif"
    )
  ).toBe(false);
  expect(
    attrs(output.get("[Content_Types].xml")!, "Default").some((x) => x.Extension === "gif")
  ).toBe(false);
});
it.each([
  { shared: "true" },
  { preserveCrop: 0 },
  { preserveGeometry: null },
  { preserveAltText: "false" },
  { all: 1 },
  { allowEmpty: null },
  { altText: 4 },
  { unknown: true },
  { contentType: "image/png" }
])("rejects malformed replacement options %j", async (patch) => {
  await expect(
    replaceImage(
      await fixture(),
      { slide: 1, image: 1 },
      replacement,
      { contentType: "image/jpeg", ...patch } as never,
      context
    )
  ).rejects.toBeDefined();
});
it("rejects geometry reset without admitted intrinsic dimensions", async () => {
  await expect(
    replaceImage(
      await fixture(),
      { slide: 1, image: 1 },
      new Uint8Array([255, 216, 255, 217]),
      { contentType: "image/jpeg", preserveGeometry: false },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-value" });
});
it("checks replacement byte budgets before package acquisition", async () => {
  let reads = 0;
  const input = {
    read: async () => {
      reads++;
      return null;
    }
  };
  await expect(
    replaceImage(
      input,
      { slide: 1, image: 1 },
      replacement,
      { contentType: "image/jpeg" },
      { ...context, archiveLimits: { ...context.archiveLimits, maxEntryBytes: 10 } }
    )
  ).rejects.toMatchObject({ code: "resource-limit" });
  expect(reads).toBe(0);
});
it("rejects accessor options without evaluating them", async () => {
  let called = false;
  const options = {
    contentType: "image/jpeg",
    get shared() {
      called = true;
      return true;
    }
  };
  await expect(
    replaceImage(await fixture(), { slide: 1, image: 1 }, replacement, options, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(called).toBe(false);
});
it("rejects paired vector bindings before creating stale fallbacks", async () => {
  const input = await fixture(
    false,
    `<a:extLst><a:ext uri="vector"><v:svgBlip xmlns:v="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="art"/></a:ext></a:extLst>`
  );
  await expect(
    replaceImage(
      input,
      { slide: 1, image: 1 },
      replacement,
      { contentType: "image/jpeg", all: true },
      context
    )
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("cleans a removed media override with case-equivalent part spelling", async () => {
  const entries = parts(await fixture());
  entries.set(
    "[Content_Types].xml",
    encode(
      text(entries.get("[Content_Types].xml")!).replace(
        'PartName="/ppt/media/tile.gif"',
        'PartName="/PPT/MEDIA/TILE.GIF"'
      )
    )
  );
  const input = await writePackageArchive(
    [...entries].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "auto" }
  );
  const result = await replaceImage(
    input,
    { slide: 1, image: 1 },
    replacement,
    { contentType: "image/jpeg", shared: true },
    context
  );
  expect(
    attrs(parts(result.bytes).get("[Content_Types].xml")!, "Override").some(
      (x) => x.PartName?.toLowerCase() === "/ppt/media/tile.gif"
    )
  ).toBe(false);
});
it("rejects media with its own relationship graph before removing its owner", async () => {
  const entries = parts(await fixture());
  entries.set(
    "ppt/media/_rels/tile.gif.rels",
    encode(
      `<Relationships xmlns="${relns}"><Relationship Id="extra" Type="urn:related-asset" Target="https://example.invalid/asset" TargetMode="External"/></Relationships>`
    )
  );
  const input = await writePackageArchive(
    [...entries].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "auto" }
  );
  await expect(
    replaceImage(
      input,
      { slide: 1, image: 1 },
      replacement,
      { contentType: "image/jpeg", shared: true },
      context
    )
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("rejects combining opaque selection with all intent", async () => {
  const input = await fixture();
  const index = await readSelectionIndex(input, context);
  const token = index.objects.find(
    (x) => x.part === "/ppt/slides/slide1.xml" && x.id === "2"
  )!.token;
  await expect(
    replaceImage(
      input,
      { select: token },
      replacement,
      { contentType: "image/jpeg", all: true },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-selection" });
});
