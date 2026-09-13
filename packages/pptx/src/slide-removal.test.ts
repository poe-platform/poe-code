import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import {
  createPresentation,
  removeSlides,
  readSelectionIndex,
  type SelectionQuery
} from "./index.js";
import { parseXmlPart } from "./xml.js";
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
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const s = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const enc = new TextEncoder(),
  dec = new TextDecoder();
const selection = (value: number): SelectionQuery => ({
  kind: "slide",
  position: { coordinateSystem: "one-based", value }
});
function parts(bytes: Uint8Array): Map<string, Uint8Array> {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(fs.readFileSync("/deck") as Buffer)).map((x) => [x.name, x.payload])
  );
}
function attrs(bytes: Uint8Array, local: string) {
  const found: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      found.push(Object.fromEntries(Object.values(tag.attributes).map((x) => [x.name, x.value])));
  });
  parser.write(dec.decode(bytes)).close();
  return found;
}
async function fixture(kind = "plain") {
  const map = parts(
    await createPresentation(
      { slides: [{ name: "Dawn" }, { name: "Noon" }, { name: "Dusk" }] },
      context
    )
  );
  const append = (name: string, text: string) => {
    const xml = parseXmlPart(map.get(name)!, context.xmlLimits);
    map.set(name, xml.spliceChildren(xml.root, xml.root.children.length, 0, [text]).bytes());
  };
  if (kind === "shows")
    append(
      "ppt/presentation.xml",
      `<p:custShowLst xmlns:p="${p}" xmlns:r="${r}"><p:custShow name="Morning" id="0"><p:sldLst><p:sld r:id="rId2"/></p:sldLst></p:custShow><p:custShow name="Evening" id="1"><p:sldLst><p:sld r:id="rId2"/><p:sld r:id="rId4"/></p:sldLst></p:custShow></p:custShowLst>`
    );
  if (kind === "sections")
    append(
      "ppt/presentation.xml",
      `<p:extLst xmlns:p="${p}"><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><s:sectionLst xmlns:s="${s}"><s:section name="Morning" id="{10000000-0000-0000-0000-000000000000}"><s:sldIdLst><s:sldId id="256"/></s:sldIdLst></s:section><s:section name="Evening" id="{20000000-0000-0000-0000-000000000000}"><s:sldIdLst><s:sldId id="257"/><s:sldId id="258"/></s:sldIdLst></s:section></s:sectionLst></p:ext></p:extLst>`
    );
  if (["link", "opaque-link", "action"].includes(kind)) {
    append(
      "ppt/slides/_rels/slide2.xml.rels",
      `<Relationship xmlns="${rel}" Id="jump" Type="${r}/slide" Target="slide1.xml"/>`
    );
    append(
      "ppt/slides/slide2.xml",
      kind === "opaque-link"
        ? `<p:extLst xmlns:p="${p}" xmlns:r="${r}"><p:ext uri="urn:opaque"><x:target xmlns:x="urn:opaque" r:id="jump"/></p:ext></p:extLst>`
        : `<a:hlinkClick xmlns:a="${a}" xmlns:r="${r}" r:id="jump" action="ppaction://hlinksldjump"/>`
    );
  }
  if (kind === "foreign")
    append(
      "ppt/presentation.xml",
      '<x:target xmlns:x="urn:opaque" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" slideId="256"/>'
    );
  if (kind === "foreign-attribute")
    append(
      "ppt/presentation.xml",
      `<p:showPr xmlns:p="${p}" xmlns:x="urn:opaque" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" x:target="256"/>`
    );
  if (kind === "orphan-link")
    append(
      "ppt/slides/_rels/slide2.xml.rels",
      `<Relationship xmlns="${rel}" Id="jump" Type="${r}/slide" Target="slide1.xml"/>`
    );
  if (kind === "opaque-wrapper")
    append(
      "ppt/presentation.xml",
      `<p:extLst xmlns:p="${p}"><a:ext xmlns:a="${a}" uri="opaque"><a:sldId id="256"/></a:ext></p:extLst>`
    );
  if (kind === "opaque")
    append(
      "ppt/presentation.xml",
      `<p:extLst xmlns:p="${p}"><p:ext uri="urn:opaque"><x:target xmlns:x="urn:opaque" slideId="256"/></p:ext></p:extLst>`
    );
  if (kind === "notes" || kind === "shared-notes") {
    append(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationship xmlns="${rel}" Id="note" Type="${r}/notesSlide" Target="../notesSlides/note.xml"/>`
    );
    if (kind === "shared-notes")
      append(
        "ppt/slides/_rels/slide2.xml.rels",
        `<Relationship xmlns="${rel}" Id="note" Type="urn:shared-note" Target="../notesSlides/note.xml"/>`
      );
    map.set(
      "ppt/notesSlides/note.xml",
      enc.encode(
        `<p:notes xmlns:p="${p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:notes>`
      )
    );
    map.set(
      "ppt/notesSlides/_rels/note.xml.rels",
      enc.encode(
        `<Relationships xmlns="${rel}"><Relationship Id="slide" Type="${r}/slide" Target="../slides/slide1.xml"/><Relationship Id="master" Type="${r}/notesMaster" Target="../notesMasters/master.xml"/></Relationships>`
      )
    );
    map.set(
      "ppt/notesMasters/master.xml",
      enc.encode(
        `<p:notesMaster xmlns:p="${p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap/></p:notesMaster>`
      )
    );
    append(
      "[Content_Types].xml",
      '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/notesMasters/master.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>'
    );
    append(
      "[Content_Types].xml",
      '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/notesSlides/note.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>'
    );
  }
  // Media is intentionally shared, with one independent orphan retained as well.
  map.set("ppt/media/shared.bin", new Uint8Array([1, 4, 9, 16]));
  map.set("ppt/media/orphan.bin", new Uint8Array([2, 3, 5]));
  append(
    "[Content_Types].xml",
    '<Default xmlns="http://schemas.openxmlformats.org/package/2006/content-types" Extension="bin" ContentType="application/octet-stream"/>'
  );
  for (const i of [1, 2])
    append(
      `ppt/slides/_rels/slide${i}.xml.rels`,
      `<Relationship xmlns="${rel}" Id="media" Type="${r}/image" Target="../media/shared.bin"/>`
    );
  return writePackageArchive(
    [...map].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "store" }
  );
}

describe("slide removal", () => {
  beforeAll(() => {
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: () => void,
      delay?: number
    ) => (delay === 0 ? setImmediate(callback) : timer(callback, delay))) as typeof setTimeout);
  });
  afterAll(() => vi.restoreAllMocks());
  it.each([[[1]], [[3]], [[1, 3]], [[1, 2, 3]]])(
    "removes selected positions %j and retains shared resources",
    async (positions) => {
      const source = await fixture();
      const output = await removeSlides(source, { selection: positions.map(selection) }, context);
      const before = parts(source),
        after = parts(output);
      expect(attrs(after.get("ppt/presentation.xml")!, "sldId").map((x) => x.id)).toEqual(
        [1, 2, 3].filter((x) => !positions.includes(x)).map((x) => String(255 + x))
      );
      for (const i of positions) {
        expect(after.has(`ppt/slides/slide${i}.xml`)).toBe(false);
        expect(after.has(`ppt/slides/_rels/slide${i}.xml.rels`)).toBe(false);
      }
      for (const [name, bytes] of before)
        if (
          ![
            "[Content_Types].xml",
            "ppt/presentation.xml",
            "ppt/_rels/presentation.xml.rels",
            ...positions.flatMap((i) => [
              `ppt/slides/slide${i}.xml`,
              `ppt/slides/_rels/slide${i}.xml.rels`
            ])
          ].includes(name)
        )
          expect(after.get(name), name).toEqual(bytes);
      expect(
        attrs(after.get("[Content_Types].xml")!, "Override").filter((x) =>
          positions.some((i) => x.PartName === `/ppt/slides/slide${i}.xml`)
        )
      ).toEqual([]);
    }
  );
  it.each(["shows", "sections", "link"])("repairs %s with its required policy", async (kind) => {
    const source = await fixture(kind);
    if (kind === "link")
      await expect(
        removeSlides(source, { selection: selection(1) }, context)
      ).rejects.toMatchObject({
        code: "dangling-reference"
      });
    const output = await removeSlides(
      source,
      {
        selection: selection(1),
        ...(kind === "link" ? { referencePolicy: "remove" as const } : {})
      },
      context
    );
    const map = parts(output);
    if (kind === "shows") {
      expect(attrs(map.get("ppt/presentation.xml")!, "custShow").map((x) => x.name)).toEqual([
        "Evening"
      ]);
      expect(attrs(map.get("ppt/presentation.xml")!, "sld").map((x) => x["r:id"])).toEqual([
        "rId4"
      ]);
    }
    if (kind === "sections") {
      expect(attrs(map.get("ppt/presentation.xml")!, "section").map((x) => x.name)).toEqual([
        "Evening"
      ]);
      expect(attrs(map.get("ppt/presentation.xml")!, "sldId").map((x) => x.id)).toEqual([
        "257",
        "258",
        "257",
        "258"
      ]);
    }
    if (kind === "link") {
      expect(attrs(map.get("ppt/slides/slide2.xml")!, "hlinkClick")).toEqual([]);
      expect(
        attrs(map.get("ppt/slides/_rels/slide2.xml.rels")!, "Relationship").some(
          (x) => x.Id === "jump"
        )
      ).toBe(false);
    }
  });
  it("removes every deleted show occurrence while retaining surviving repeats and IDs", async () => {
    const map = parts(await fixture("shows"));
    let xml = parseXmlPart(map.get("ppt/presentation.xml")!, context.xmlLimits);
    const list = xml.root.children.find((n) => n.name.localName === "custShowLst")!.children[1]!
      .children[0]!;
    xml = xml.spliceChildren(list, list.children.length, 0, [
      `<p:sld xmlns:p="${p}" xmlns:r="${r}" r:id="rId2"/>`,
      `<p:sld xmlns:p="${p}" xmlns:r="${r}" r:id="rId4"/>`
    ]);
    map.set("ppt/presentation.xml", xml.bytes());
    const source = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    const output = parts(await removeSlides(source, { selection: selection(1) }, context));
    expect(attrs(output.get("ppt/presentation.xml")!, "custShow")).toEqual([
      { name: "Evening", id: "1" }
    ]);
    expect(attrs(output.get("ppt/presentation.xml")!, "sld").map((x) => x["r:id"])).toEqual([
      "rId4",
      "rId4"
    ]);
    expect(output.get("ppt/slides/slide3.xml")).toEqual(map.get("ppt/slides/slide3.xml"));
  });
  it.each([
    "opaque",
    "opaque-link",
    "opaque-wrapper",
    "shared-notes",
    "foreign",
    "foreign-attribute",
    "orphan-link"
  ])("rejects unresolved %s even with removal policy", async (kind) => {
    await expect(
      removeSlides(
        await fixture(kind),
        { selection: selection(1), referencePolicy: "remove" },
        context
      )
    ).rejects.toMatchObject({ code: "dangling-reference" });
  });
  it.each(["shows", "sections"])("removes empty %s containers for all slides", async (kind) => {
    const map = parts(
      await removeSlides(await fixture(kind), { selection: { kind: "slide", all: true } }, context)
    );
    for (const tag of ["custShowLst", "sectionLst", "extLst"])
      expect(attrs(map.get("ppt/presentation.xml")!, tag)).toEqual([]);
  });
  it("retains links to surviving slides and ignores outbound links of deleted slides", async () => {
    const source = await fixture("link");
    const output = parts(await removeSlides(source, { selection: selection(3) }, context));
    expect(output.get("ppt/slides/slide2.xml")).toEqual(parts(source).get("ppt/slides/slide2.xml"));
    const empty = parts(
      await removeSlides(source, { selection: { kind: "slide", all: true } }, context)
    );
    expect(attrs(empty.get("ppt/presentation.xml")!, "sldId")).toEqual([]);
  });
  it.each([
    ["firstslide", 1],
    ["lastslide", 3],
    ["nextslide", 3],
    ["previousslide", 1]
  ] as const)("requires explicit policy for affected %s action", async (jump, target) => {
    const map = parts(await fixture());
    const xml = parseXmlPart(map.get("ppt/slides/slide2.xml")!, context.xmlLimits);
    map.set(
      "ppt/slides/slide2.xml",
      xml
        .spliceChildren(xml.root, xml.root.children.length, 0, [
          `<a:hlinkClick xmlns:a="${a}" action="ppaction://hlinkshowjump?jump=${jump}"/>`
        ])
        .bytes()
    );
    const source = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    await expect(
      removeSlides(source, { selection: selection(target) }, context).then(() => "published")
    ).rejects.toMatchObject({ code: "dangling-reference" });
    const output = parts(
      await removeSlides(
        source,
        { selection: selection(target), referencePolicy: "remove" },
        context
      )
    );
    expect(attrs(output.get("ppt/slides/slide2.xml")!, "hlinkClick")).toEqual([]);
    const kept = parts(
      await removeSlides(source, { selection: selection(target === 1 ? 3 : 1) }, context)
    );
    expect(kept.get("ppt/slides/slide2.xml")).toEqual(map.get("ppt/slides/slide2.xml"));
  });
  it.each([
    "",
    "ppaction://hlinkshowjump?jump=endshow",
    "ppaction://hlinkfile",
    "ppaction://hlinkpres",
    "ppaction://ole",
    "ppaction://macro",
    "ppaction://program",
    "ppaction://media"
  ])("preserves unrelated inert action %s", async (action) => {
    const map = parts(await fixture());
    const xml = parseXmlPart(map.get("ppt/slides/slide2.xml")!, context.xmlLimits);
    map.set(
      "ppt/slides/slide2.xml",
      xml
        .spliceChildren(xml.root, xml.root.children.length, 0, [
          `<a:hlinkClick xmlns:a="${a}" action="${action}"/>`
        ])
        .bytes()
    );
    const source = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    const output = parts(await removeSlides(source, { selection: selection(1) }, context));
    expect(output.get("ppt/slides/slide2.xml")).toEqual(map.get("ppt/slides/slide2.xml"));
  });
  it.each([
    "ppaction://customshow",
    "ppaction://opaque?slide=256",
    "ppaction://hlinkshowjump?jump=lastslideviewed",
    "ppaction://hlinkshowjump?jump=unknown",
    "ppaction://hlinksldjump"
  ])("rejects unresolved navigation %s", async (action) => {
    const map = parts(await fixture());
    const xml = parseXmlPart(map.get("ppt/slides/slide2.xml")!, context.xmlLimits);
    map.set(
      "ppt/slides/slide2.xml",
      xml
        .spliceChildren(xml.root, xml.root.children.length, 0, [
          `<a:hlinkClick xmlns:a="${a}" action="${action}"/>`
        ])
        .bytes()
    );
    const source = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    await expect(
      removeSlides(source, { selection: selection(1), referencePolicy: "remove" }, context).then(
        () => "published"
      )
    ).rejects.toMatchObject({ code: "dangling-reference" });
  });
  it("deletes exclusively owned notes and their backlink", async () => {
    const output = parts(
      await removeSlides(await fixture("notes"), { selection: selection(1) }, context)
    );
    expect(output.has("ppt/notesSlides/note.xml")).toBe(false);
    expect(output.has("ppt/notesSlides/_rels/note.xml.rels")).toBe(false);
    expect(
      attrs(output.get("[Content_Types].xml")!, "Override").some(
        (x) => x.PartName === "/ppt/notesSlides/note.xml"
      )
    ).toBe(false);
  });
  it("rejects missing duplicate and stale selections; allows explicit empty no-op", async () => {
    const source = await fixture();
    await expect(
      removeSlides(source, { selection: { kind: "slide" } }, context)
    ).rejects.toMatchObject({ code: "invalid-selection" });
    await expect(
      removeSlides(source, { selection: [selection(1), selection(1)] }, context)
    ).rejects.toMatchObject({ code: "invalid-selection" });
    await expect(removeSlides(source, { selection: selection(8) }, context)).rejects.toMatchObject({
      code: "missing-selection"
    });
    expect(
      await removeSlides(source, { selection: selection(8), allowEmpty: true }, context)
    ).toEqual(source);
    const token = (await readSelectionIndex(source, context)).slides[1]!.token;
    const output = await removeSlides(source, { selection: selection(1) }, context);
    await expect(removeSlides(output, { selection: { token } }, context)).rejects.toMatchObject({
      code: "stale-selection"
    });
  });
});
