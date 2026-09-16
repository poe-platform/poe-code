import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readSelectionIndex } from "./selectors.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
import { storedArchive } from "../tests/fixtures/archive.js";
import { readImages } from "./images.js";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const svg = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";
const context = {
  limits: { maxBytes: 262144, maxReads: 100, chunkBytes: 4096 },
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
const raster = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 3, 0, 0, 0, 2, 8, 2, 0, 0,
  0
]);
function fixture(
  crop = '<a:srcRect l="12500" t="-10000" r="250000" b="33333"/>',
  type = "image/png",
  alter?: (entries: { name: string; bytes: Uint8Array }[]) => void
) {
  const entries: { name: string; bytes: Uint8Array }[] = [];
  const xml = (name: string, value: string) =>
    entries.push({ name, bytes: new TextEncoder().encode(value) });
  const rels = (name: string, rows: [string, string, string, boolean?][]) =>
    xml(
      name,
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`
    );
  const pic = (id: number, binding: string, extra = "") =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Tile ${id}" descr="Blue tile" title="Swatch"/></p:nvPicPr><p:blipFill><a:blip ${binding}>${extra}</a:blip>${crop}</p:blipFill><p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm></p:spPr></p:pic>`;
  const drawing = (tag: string, body: string, background = "") =>
    `<p:${tag} xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}" xmlns:s="${svg}"><p:cSld>${background}<p:spTree>${body}</p:spTree></p:cSld></p:${tag}>`;
  xml(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="${type}"/><Default Extension="svg" ContentType="image/svg+xml"/></Types>`
  );
  rels("_rels/.rels", [["main", "officeDocument", "deck.xml"]]);
  xml(
    "deck.xml",
    `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="s1"/><p:sldId id="257" r:id="s2"/></p:sldIdLst></p:presentation>`
  );
  rels("_rels/deck.xml.rels", [
    ["s1", "slide", "one.xml"],
    ["s2", "slide", "two.xml"],
    ["master", "slideMaster", "master.xml"]
  ]);
  xml(
    "one.xml",
    drawing(
      "sld",
      pic(2, 'r:embed="img"') +
        pic(3, 'r:embed="copy"') +
        pic(4, 'r:link="remote"') +
        pic(
          5,
          'r:embed="img"',
          '<a:extLst><a:ext uri="svg"><s:svgBlip r:embed="vector"/></a:ext></a:extLst>'
        )
    )
  );
  xml("two.xml", drawing("sld", pic(2, 'r:embed="img"')));
  for (const owner of ["one", "two"])
    rels(`_rels/${owner}.xml.rels`, [
      ["img", "image", "tile.bin"],
      ["copy", "image", "copy.bin"],
      ["remote", "image", "https://example.invalid/photo.png", true],
      ["vector", "image", "tile.svg"],
      ["layout", "slideLayout", "layout.xml"],
      ["notes", "notesSlide", `${owner}-notes.xml`]
    ]);
  xml("layout.xml", drawing("sldLayout", ""));
  rels("_rels/layout.xml.rels", [["master", "slideMaster", "master.xml"]]);
  xml(
    "master.xml",
    drawing(
      "sldMaster",
      pic(7, 'r:embed="img"'),
      '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="img"/></a:blipFill></p:bgPr></p:bg>'
    )
  );
  rels("_rels/master.xml.rels", [["img", "image", "tile.bin"]]);
  for (const owner of ["one", "two"]) {
    xml(`${owner}-notes.xml`, drawing("notes", pic(8, 'r:embed="img"')));
    rels(`_rels/${owner}-notes.xml.rels`, [["img", "image", "tile.bin"]]);
  }
  entries.push({ name: "tile.bin", bytes: raster }, { name: "copy.bin", bytes: raster });
  xml("tile.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"/>');
  alter?.(entries);
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", storedArchive(entries));
  return new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer);
}
it("separates source occurrences from media parts and content groups without reading external links", async () => {
  const data = await readImages(fixture(), {}, context);
  expect(data.occurrences).toHaveLength(6);
  expect(data.media).toHaveLength(3);
  expect(data.occurrences[0]).toMatchObject({
    sourcePart: "/one.xml",
    relationshipId: "img",
    shapeId: "2",
    shapeName: "Tile 2",
    scope: "slides",
    inheritedBy: [],
    kind: "picture",
    role: "primary",
    position: 1,
    altText: "Blue tile",
    title: "Swatch",
    mediaPart: "/tile.bin",
    contentType: "image/png",
    bytes: 29,
    sha256: createHash("sha256").update(raster).digest("hex"),
    crop: { left: 0.125, top: -0.1, right: 2.5, bottom: 0.33333 },
    geometry: {
      coordinateSystem: "slide",
      unit: "emu",
      groupPath: [],
      corners: [
        { x: 10, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 60 },
        { x: 10, y: 60 }
      ]
    }
  });
  expect(data.occurrences[2]).toMatchObject({
    external: true,
    target: "https://example.invalid/photo.png",
    mediaPart: null,
    bytes: null,
    sha256: null,
    contentType: null
  });
  expect(data.occurrences.slice(3, 5).map((x) => x.role)).toEqual(["fallback", "svg"]);
  const grouped = await readImages(fixture(), { unique: true }, context);
  expect(grouped.media).toHaveLength(2);
  expect(grouped.media.find((x) => x.contentType === "image/png")).toMatchObject({
    parts: ["/copy.bin", "/tile.bin"],
    bytes: 29
  });
});
it("lists inherited master backgrounds and notes separately with owning slides", async () => {
  const masters = await readImages(fixture(), { scope: "masters" }, context);
  expect(masters.occurrences.map((x) => [x.kind, x.shapeId, x.inheritedBy])).toEqual([
    ["background", null, [1, 2]],
    ["picture", "7", [1, 2]]
  ]);
  const notes = await readImages(fixture(), { scope: "notes", slide: 2 }, context);
  expect(notes.occurrences.map((x) => [x.sourcePart, x.shapeId])).toEqual([
    ["/two-notes.xml", "8"]
  ]);
  expect(
    (await readImages(fixture(), { slide: 1, image: 2 }, context)).occurrences.map(
      (x) => x.relationshipId
    )
  ).toEqual(["copy"]);
});
it.each([
  ["", "left", 0],
  ["<a:srcRect/>", "top", 0],
  ['<a:srcRect l="99999"/>', "bottom", 0],
  ['<a:srcRect l="42424"/>', "left", 0.42424],
  ['<a:srcRect t="-10000"/>', "top", -0.1],
  ['<a:srcRect r="250000"/>', "right", 2.5],
  ['<a:srcRect b="33333"/>', "bottom", 0.33333]
] as const)("reads crop metadata %s on %s", async (crop, key, expected) => {
  expect(
    (await readImages(fixture(crop), { slide: 1, image: 1 }, context)).occurrences[0]!.crop[key]
  ).toBe(expected);
});
it.each([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tiff",
  "image/x-wmf",
  "image/x-emf",
  "image/vnd.ms-photo"
])("preserves declared opaque resource type %s", async (type) => {
  expect(
    (await readImages(fixture("", type), { slide: 1, image: 1 }, context)).media[0]
  ).toMatchObject({ contentType: type, bytes: 29 });
});
it("rejects invalid selectors before admitting bytes", async () => {
  await expect(readImages(new Uint8Array(), { image: 0 }, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
  await expect(
    readImages(new Uint8Array(), { select: "token", slide: 1 }, context)
  ).rejects.toMatchObject({ code: "invalid-selection" });
});

it.each([
  ['<a:srcRect l="0" t="0" r="0" b="0"/>', { left: 0, top: 0, right: 0, bottom: 0 }],
  [
    '<a:srcRect l="15479" t="25571" r="10463" b="25572"/>',
    { left: 0.15479, top: 0.25571, right: 0.10463, bottom: 0.25572 }
  ]
])("reads complete four-sided crop metadata %s", async (crop, expected) => {
  expect(
    (await readImages(fixture(crop as string), { slide: 1, image: 1 }, context)).occurrences[0]!
      .crop
  ).toEqual(expected);
});
it("keeps SVG and raster fallback on one selectable picture position", async () => {
  expect(
    (await readImages(fixture(), { slide: 1, image: 4 }, context)).occurrences.map((x) => [
      x.position,
      x.role
    ])
  ).toEqual([
    [4, "fallback"],
    [4, "svg"]
  ]);
});
it("lists the union of drawing scopes without parsing binary parts", async () => {
  expect((await readImages(fixture(), { scope: "shared" }, context)).occurrences).toHaveLength(10);
});
it("orders slide occurrences by presentation membership independent of ZIP entry order", async () => {
  const result = await readImages(
    fixture(undefined, undefined, (entries) => entries.reverse()),
    {},
    context
  );
  expect(result.occurrences.map((x) => x.sourcePart)).toEqual([
    "/one.xml",
    "/one.xml",
    "/one.xml",
    "/one.xml",
    "/one.xml",
    "/two.xml"
  ]);
});
it("exposes identity locations and accepts object tokens", async () => {
  const bytes = fixture();
  const index = await readSelectionIndex(bytes, context);
  const target = index.objects.find((x) => x.part === "/one.xml" && x.id === "2")!;
  const result = await readImages(bytes, { select: target.token }, context);
  expect(result.occurrences).toHaveLength(1);
  expect(result.occurrences[0]).toMatchObject({ location: target.location });
});
it("retains both media declarations when hash grouping combines distinct parts", async () => {
  const result = await readImages(
    fixture(undefined, undefined, (entries) => {
      const entry = entries.find((x) => x.name === "[Content_Types].xml")!;
      entry.bytes = new TextEncoder().encode(
        new TextDecoder()
          .decode(entry.bytes)
          .replace(
            "</Types>",
            '<Override PartName="/copy.bin" ContentType="image/custom"/></Types>'
          )
      );
    }),
    { unique: true },
    context
  );
  expect(result.media.find((x) => x.parts.includes("/copy.bin"))).toMatchObject({
    contentType: null,
    contentTypes: ["image/custom", "image/png"],
    sha1: createHash("sha1").update(raster).digest("hex"),
    pixelWidth: null,
    pixelHeight: null,
    dpiX: 72,
    dpiY: 72
  });
});
it.each(['<a:srcRect l="NaN"/>', '<a:srcRect t="0x100"/>', '<a:srcRect b="1e5"/>'])(
  "rejects malformed crop values %s",
  async (crop) => {
    await expect(readImages(fixture(crop), {}, context)).rejects.toMatchObject({
      code: "invalid-xml"
    });
  }
);
it("keeps occurrence identities stable when selecting a later picture", async () => {
  const bytes = fixture();
  const all = await readImages(bytes, {}, context);
  const filtered = await readImages(bytes, { slide: 1, image: 2 }, context);
  expect(filtered.occurrences[0]!.id).toBe(all.occurrences[1]!.id);
});
it.each(["absent", "wrong-type", "missing-part"])(
  "reports broken image binding %s",
  async (mode) => {
    const bytes = fixture(undefined, undefined, (entries) => {
      if (mode === "missing-part")
        entries.splice(
          entries.findIndex((x) => x.name === "tile.bin"),
          1
        );
      else {
        const entry = entries.find((x) => x.name === "_rels/one.xml.rels")!;
        const xml = new TextDecoder().decode(entry.bytes);
        entry.bytes = new TextEncoder().encode(
          mode === "absent"
            ? xml.replace('Id="img"', 'Id="other"')
            : xml.replace(`${r}/image`, `${r}/audio`)
        );
      }
    });
    await expect(readImages(bytes, {}, context)).rejects.toMatchObject({ code: "missing-binding" });
  }
);
it("reads Strict picture relationships and geometry without changing source bytes", async () => {
  const bytes = fixture(undefined, undefined, (entries) => {
    for (const entry of entries)
      if (entry.name.endsWith(".xml") || entry.name.endsWith(".rels")) {
        let xml = new TextDecoder().decode(entry.bytes);
        for (const [from, to] of [
          [p, "http://purl.oclc.org/ooxml/presentationml/main"],
          [a, "http://purl.oclc.org/ooxml/drawingml/main"],
          [r, "http://purl.oclc.org/ooxml/officeDocument/relationships"]
        ])
          xml = xml.split(from!).join(to!);
        entry.bytes = new TextEncoder().encode(xml);
      }
  });
  const original = bytes.slice();
  const result = await readImages(bytes, { slide: 1, image: 1 }, context);
  expect(result.occurrences[0]).toMatchObject({
    mediaPart: "/tile.bin",
    crop: { left: 0.125, top: -0.1, right: 2.5, bottom: 0.33333 },
    geometry: {
      corners: [
        { x: 10, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 60 },
        { x: 10, y: 60 }
      ]
    }
  });
  expect(bytes).toEqual(original);
});
it("retains choice and fallback references on the same picture position", async () => {
  const bytes = fixture(undefined, undefined, (entries) => {
    const entry = entries.find((x) => x.name === "one.xml")!;
    const xml = new TextDecoder().decode(entry.bytes);
    const start = xml.indexOf("<p:pic>"),
      end = xml.indexOf("</p:pic>", start) + 8;
    const picture = xml.slice(start, end);
    const alternate = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:q="urn:unrecognized-picture"><mc:Choice Requires="q">${picture.replace('r:embed="img"', 'r:embed="vector"')}</mc:Choice><mc:Fallback>${picture}</mc:Fallback></mc:AlternateContent>`;
    entry.bytes = new TextEncoder().encode(xml.slice(0, start) + alternate + xml.slice(end));
  });
  const result = await readImages(bytes, { slide: 1, image: 1 }, context);
  expect(result.occurrences.map((x) => [x.mediaPart, x.position, x.role])).toEqual([
    ["/tile.svg", 1, "primary"],
    ["/tile.bin", 1, "fallback"]
  ]);
  expect(
    (await readImages(bytes, { slide: 1, image: 2 }, context)).occurrences.map((x) => x.shapeId)
  ).toEqual(["3"]);
});
it("reports shape fills separately without shifting picture selection", async () => {
  const bytes = fixture(undefined, undefined, (entries) => {
    const entry = entries.find((x) => x.name === "one.xml")!;
    const xml = new TextDecoder().decode(entry.bytes);
    entry.bytes = new TextEncoder().encode(
      xml.replace(
        "<p:spTree>",
        '<p:spTree><p:sp><p:nvSpPr><p:cNvPr id="9" name="Panel"/></p:nvSpPr><p:spPr><a:blipFill><a:blip r:embed="img"/></a:blipFill></p:spPr></p:sp>'
      )
    );
  });
  expect((await readImages(bytes, { slide: 1 }, context)).occurrences[0]).toMatchObject({
    kind: "fill",
    shapeId: "9",
    geometry: null
  });
  expect(
    (await readImages(bytes, { slide: 1, image: 1 }, context)).occurrences.map((x) => x.shapeId)
  ).toEqual(["2"]);
});
it("does not report intrinsic dimensions from one conflicting grouped declaration", async () => {
  const result = await readImages(
    fixture(undefined, undefined, (entries) => {
      for (const entry of entries)
        if (entry.name.endsWith(".bin")) entry.bytes = new Uint8Array([...entry.bytes, 0, 0, 0, 0]);
      const entry = entries.find((x) => x.name === "[Content_Types].xml")!;
      entry.bytes = new TextEncoder().encode(
        new TextDecoder()
          .decode(entry.bytes)
          .replace(
            "</Types>",
            '<Override PartName="/tile.bin" ContentType="image/custom"/></Types>'
          )
      );
    }),
    { unique: true },
    context
  );
  expect(result.media.find((x) => x.parts.includes("/tile.bin"))).toMatchObject({
    contentType: null,
    pixelWidth: null,
    pixelHeight: null,
    dpiX: 72,
    dpiY: 72
  });
});
it.each([
  ["l", "42.424%", "left", 0.42424],
  ["t", "-10%", "top", -0.1],
  ["r", "250%", "right", 2.5]
] as const)("reads percentage crop %s=%s", async (attribute, value, side, expected) => {
  expect(
    (
      await readImages(
        fixture(`<a:srcRect ${attribute}="${value}"/>`),
        { slide: 1, image: 1 },
        context
      )
    ).occurrences[0]!.crop[side]
  ).toBe(expected);
});
it.each(["1e2%", "Infinity%", "NaN%", "2..1%", ".%", "%"])(
  "rejects malformed percentage crop %s",
  async (value) => {
    await expect(
      readImages(fixture(`<a:srcRect l="${value}"/>`), {}, context)
    ).rejects.toMatchObject({ code: "invalid-xml" });
  }
);
