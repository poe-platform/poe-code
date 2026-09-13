import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SaxesParser } from "saxes";
import { createPresentation, duplicateSlides, type SelectionQuery } from "./index.js";
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
const enc = new TextEncoder(),
  dec = new TextDecoder();
const selection: SelectionQuery = {
  kind: "slide",
  position: { coordinateSystem: "one-based", value: 1 }
};
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
function attrs(bytes: Uint8Array, local: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      result.push(Object.fromEntries(Object.values(tag.attributes).map((x) => [x.name, x.value])));
  });
  parser.write(dec.decode(bytes)).close();
  return result;
}
function archive(map: Map<string, Uint8Array>) {
  return storedArchive([...map].map(([name, bytes]) => ({ name, bytes })));
}
function append(map: Map<string, Uint8Array>, part: string, fragment: string, tree = false) {
  let xml = parseXmlPart(map.get(part)!, context.xmlLimits);
  const parent = tree
    ? xml.root.children[0]!.children.find((x) => x.name.localName === "spTree")!
    : xml.root;
  xml = xml.spliceChildren(parent, parent.children.length, 0, [fragment]);
  map.set(part, xml.bytes());
}
async function fixture() {
  const map = parts(
    await createPresentation({ slides: [{ name: "Harbor" }, { name: "Forest" }] }, context)
  );
  append(
    map,
    "ppt/slides/slide1.xml",
    `<p:cxnSp xmlns:p="${p}" xmlns:a="${a}"><p:nvCxnSpPr><p:cNvPr id="8" name="Route"/><p:cNvCxnSpPr><a:stCxn id="1" idx="0"/><a:endCxn id="8" idx="1"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr/></p:cxnSp>`,
    true
  );
  append(
    map,
    "ppt/slides/slide1.xml",
    `<p:timing xmlns:p="${p}"><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:anim><p:cBhvr><p:cTn id="2"/><p:tgtEl><p:spTgt spid="8"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`
  );
  const tree =
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
  map.set(
    "ppt/notesSlides/note.xml",
    enc.encode(`<p:notes xmlns:p="${p}"><p:cSld name="Bring maps">${tree}</p:cSld></p:notes>`)
  );
  map.set(
    "ppt/notesMasters/master.xml",
    enc.encode(`<p:notesMaster xmlns:p="${p}"><p:cSld>${tree}</p:cSld><p:clrMap/></p:notesMaster>`)
  );
  map.set(
    "ppt/notesSlides/_rels/note.xml.rels",
    enc.encode(
      `<Relationships xmlns="${rel}"><Relationship Id="slide" Type="${r}/slide" Target="../slides/slide1.xml"/><Relationship Id="master" Type="${r}/notesMaster" Target="../notesMasters/master.xml"/></Relationships>`
    )
  );
  map.set(
    "ppt/charts/chart.xml",
    enc.encode(
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${r}"><c:chart/><c:externalData r:id="book"/></c:chartSpace>`
    )
  );
  map.set(
    "ppt/charts/_rels/chart.xml.rels",
    enc.encode(
      `<Relationships xmlns="${rel}"><Relationship Id="book" Type="${r}/package" Target="../embeddings/data.xlsx"/></Relationships>`
    )
  );
  map.set("ppt/embeddings/data.xlsx", new Uint8Array([80, 75, 3, 4, 9]));
  map.set("ppt/media/pixel.png", new Uint8Array([137, 80, 78, 71]));
  for (const [id, kind, target] of [
    ["note", "notesSlide", "../notesSlides/note.xml"],
    ["chart", "chart", "../charts/chart.xml"],
    ["image", "image", "../media/pixel.png"],
    ["self", "slide", "slide1.xml"]
  ])
    append(
      map,
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationship xmlns="${rel}" Id="${id}" Type="${r}/${kind}" Target="${target}"/>`
    );
  for (const [name, type] of [
    ["notesSlides/note.xml", "presentationml.notesSlide+xml"],
    ["notesMasters/master.xml", "presentationml.notesMaster+xml"],
    ["charts/chart.xml", "drawingml.chart+xml"],
    ["embeddings/data.xlsx", "spreadsheetml.sheet"],
    ["media/pixel.png", "image/png"]
  ])
    append(
      map,
      "[Content_Types].xml",
      `<Override xmlns="${ct}" PartName="/ppt/${name}" ContentType="${type!.startsWith("image/") ? type : `application/vnd.openxmlformats-officedocument.${type}`}"/>`
    );
  return map;
}

describe("slide dependency copying", () => {
  beforeAll(() => {
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) =>
      delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
  });
  afterAll(() => vi.restoreAllMocks());
  it("allocates deterministic identities and remaps connector and timing targets", async () => {
    const input = archive(await fixture());
    const output = await duplicateSlides(input, { selection, position: 2 }, context);
    expect(await duplicateSlides(input, { selection, position: 2 }, context)).toEqual(output);
    const map = parts(output);
    const ids = attrs(map.get("ppt/presentation.xml")!, "sldId");
    expect(ids.map((x) => x.id)).toEqual(["256", "258", "257"]);
    const slide = map.get("ppt/slides/slide1-copy1.xml")!;
    expect(attrs(slide, "cNvPr").map((x) => x.id)).toEqual(["9", "10"]);
    expect(attrs(slide, "stCxn")[0]!.id).toBe("9");
    expect(attrs(slide, "endCxn")[0]!.id).toBe("10");
    expect(attrs(slide, "spTgt")[0]!.spid).toBe("10");
    for (const [name, bytes] of await fixture())
      if (
        ![
          "ppt/presentation.xml",
          "ppt/_rels/presentation.xml.rels",
          "[Content_Types].xml"
        ].includes(name)
      )
        expect(map.get(name), name).toEqual(bytes);
  });
  it("isolates notes, charts and embedded data while sharing image and layout resources", async () => {
    const input = archive(await fixture());
    const map = parts(await duplicateSlides(input, { selection, position: 3 }, context));
    const relations = attrs(map.get("ppt/slides/_rels/slide1-copy1.xml.rels")!, "Relationship");
    const target = (kind: string) => relations.find((x) => x.Type === `${r}/${kind}`)!.Target;
    expect(target("notesSlide")).toBe("../notesSlides/note-copy1.xml");
    expect(target("chart")).toBe("../charts/chart-copy1.xml");
    expect(target("image")).toBe("../media/pixel.png");
    expect(target("slideLayout")).toBe("../slideLayouts/slideLayout1.xml");
    expect(target("slide")).toBe("slide1-copy1.xml");
    expect(
      attrs(map.get("ppt/notesSlides/_rels/note-copy1.xml.rels")!, "Relationship").map(
        (x) => x.Target
      )
    ).toEqual(["../slides/slide1-copy1.xml", "../notesMasters/master.xml"]);
    expect(
      attrs(map.get("ppt/charts/_rels/chart-copy1.xml.rels")!, "Relationship")[0]!.Target
    ).toBe("../embeddings/data-copy1.xlsx");
    expect(map.get("ppt/embeddings/data-copy1.xlsx")).toEqual(map.get("ppt/embeddings/data.xlsx"));
    expect(attrs(map.get("ppt/charts/chart-copy1.xml")!, "externalData")[0]!["r:id"]).not.toBe(
      "book"
    );
    expect([...map.keys()].filter((x) => x.startsWith("ppt/media/"))).toEqual([
      "ppt/media/pixel.png"
    ]);
  });
  it.each([
    ["unknown-relation", "unsupported-edit"],
    ["extension-target", "unsupported-profile"],
    ["dangling-connector", "invalid-opc"]
  ])("rejects unsafe copying: %s", async (kind, code) => {
    const map = await fixture();
    if (kind === "unknown-relation")
      append(
        map,
        "ppt/slides/_rels/slide1.xml.rels",
        `<Relationship xmlns="${rel}" Id="opaque" Type="urn:opaque" Target="../media/pixel.png"/>`
      );
    if (kind === "extension-target")
      append(map, "ppt/slides/slide1.xml", '<x:target xmlns:x="urn:opaque" shape="8"/>');
    if (kind === "dangling-connector")
      append(
        map,
        "ppt/slides/slide1.xml",
        `<p:timing xmlns:p="${p}"><p:tgtEl><p:spTgt spid="777"/></p:tgtEl></p:timing>`
      );
    await expect(
      duplicateSlides(archive(map), { selection, position: 2 }, context)
    ).rejects.toMatchObject({ code });
  });
  it("rejects mutable data disguised as a shared image", async () => {
    const map = await fixture();
    append(
      map,
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationship xmlns="${rel}" Id="disguised" Type="${r}/image" Target="../charts/chart.xml"/>`
    );
    await expect(
      duplicateSlides(archive(map), { selection, position: 2 }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("rejects unresolved action and extension references", async () => {
    const map = await fixture();
    append(
      map,
      "ppt/slides/slide1.xml",
      `<p:extLst xmlns:p="${p}"><p:ext uri="urn:opaque"/></p:extLst>`
    );
    await expect(
      duplicateSlides(archive(map), { selection, position: 2 }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    const action = await fixture();
    append(
      action,
      "ppt/slides/slide1.xml",
      `<a:hlinkClick xmlns:a="${a}" action="ppaction://hlinkshowjump?jump=nextslide"/>`
    );
    await expect(
      duplicateSlides(archive(action), { selection, position: 2 }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("isolates repeat copies and preserves independently edited notes and charts", async () => {
    const first = await duplicateSlides(
      archive(await fixture()),
      { selection, position: 2 },
      context
    );
    const map = parts(first);
    for (const part of ["ppt/notesSlides/note-copy1.xml", "ppt/charts/chart-copy1.xml"]) {
      const xml = parseXmlPart(map.get(part)!, context.xmlLimits);
      map.set(
        part,
        xml
          .merge(xml.root, {
            attributes: [{ namespace: "", localName: "name", value: "Independent" }]
          })
          .bytes()
      );
    }
    const second = parts(await duplicateSlides(archive(map), { selection, position: 3 }, context));
    expect(attrs(second.get("ppt/presentation.xml")!, "sldId").map((x) => x.id)).toEqual([
      "256",
      "258",
      "259",
      "257"
    ]);
    expect(second.has("ppt/slides/slide1-copy2.xml")).toBe(true);
    expect(dec.decode(second.get("ppt/notesSlides/note-copy1.xml"))).toContain(
      'name="Independent"'
    );
    expect(dec.decode(second.get("ppt/notesSlides/note-copy2.xml"))).not.toContain(
      'name="Independent"'
    );
    expect(dec.decode(second.get("ppt/charts/chart-copy2.xml"))).not.toContain(
      'name="Independent"'
    );
    expect(second.get("ppt/charts/chart.xml")).toEqual(map.get("ppt/charts/chart.xml"));
  });
  it("copies Strict slide content without converting its namespaces", async () => {
    const map = await fixture();
    for (const [name, bytes] of map) {
      if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
      let xml = dec.decode(bytes);
      for (const [from, to] of [
        [p, "http://purl.oclc.org/ooxml/presentationml/main"],
        [a, "http://purl.oclc.org/ooxml/drawingml/main"],
        [r, "http://purl.oclc.org/ooxml/officeDocument/relationships"],
        [
          "http://schemas.openxmlformats.org/drawingml/2006/chart",
          "http://purl.oclc.org/ooxml/drawingml/chart"
        ]
      ])
        xml = xml.split(from!).join(to!);
      map.set(name, enc.encode(xml));
    }
    const output = parts(await duplicateSlides(archive(map), { selection, position: 2 }, context));
    expect(dec.decode(output.get("ppt/slides/slide1-copy1.xml"))).toContain(
      "http://purl.oclc.org/ooxml/presentationml/main"
    );
    expect(attrs(output.get("ppt/slides/slide1-copy1.xml")!, "spTgt")[0]!.spid).toBe("10");
  });
  it("rejects invalid positions and repeated selections", async () => {
    const input = archive(await fixture());
    await expect(duplicateSlides(input, { selection, position: 4 }, context)).rejects.toMatchObject(
      { code: "invalid-value" }
    );
    await expect(
      duplicateSlides(input, { selection: [selection, selection], position: 2 }, context)
    ).rejects.toMatchObject({ code: "invalid-selection" });
  });
});
