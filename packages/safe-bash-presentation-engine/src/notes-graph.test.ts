import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPresentation,
  duplicateSlides,
  importSlides,
  removeSlides,
  type SelectionQuery
} from "./index.js";
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
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const selection: SelectionQuery = {
  kind: "slide",
  position: { coordinateSystem: "one-based", value: 1 }
};
function parts(bytes: Uint8Array): Map<string, Uint8Array> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((part) => [
      part.name,
      part.payload
    ])
  );
}
function archive(map: Map<string, Uint8Array>) {
  return storedArchive([...map].map(([name, bytes]) => ({ name, bytes })));
}
function append(map: Map<string, Uint8Array>, part: string, fragment: string) {
  const xml = parseXmlPart(map.get(part)!, context.xmlLimits);
  map.set(part, xml.spliceChildren(xml.root, xml.root.children.length, 0, [fragment]).bytes());
}
function attributes(bytes: Uint8Array, local: string) {
  const found: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      found.push(
        Object.fromEntries(Object.values(tag.attributes).map((attr) => [attr.name, attr.value]))
      );
  });
  parser.write(decoder.decode(bytes)).close();
  return found;
}
function target(map: Map<string, Uint8Array>, part: string, kind: string) {
  return attributes(map.get(part)!, "Relationship").find((edge) => edge.Type === `${r}/${kind}`)
    ?.Target;
}
async function fixture(opaque = false, distinctMasters = false) {
  const map = parts(
    await createPresentation({ slides: [{ name: "Station" }, { name: "Meadow" }] }, context)
  );
  const tree =
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
  for (let i = 1; i <= 2; i++) {
    const master = distinctMasters ? i : 1;
    const shape = (id: number, type: string, text: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${type}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
    map.set(
      `ppt/notesSlides/note${i}.xml`,
      encoder.encode(
        `<p:notes xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${tree}${shape(2, "body", `Speaker ${i}`)}${shape(3, "sldImg", "Preview label")}${shape(4, "dt", "Date label")}${shape(5, "ftr", "Footer label")}</p:spTree></p:cSld>${opaque ? '<p:extLst><p:ext uri="urn:retained"><x:payload xmlns:x="urn:retained" code="29">Original annotation</x:payload></p:ext></p:extLst>' : ""}</p:notes>`
      )
    );
    map.set(
      `ppt/notesSlides/_rels/note${i}.xml.rels`,
      encoder.encode(
        `<Relationships xmlns="${rel}"><Relationship Id="owner" Type="${r}/slide" Target="../slides/slide${i}.xml"/><Relationship Id="master" Type="${r}/notesMaster" Target="../notesMasters/master${master}.xml"/></Relationships>`
      )
    );
    append(
      map,
      `ppt/slides/_rels/slide${i}.xml.rels`,
      `<Relationship xmlns="${rel}" Id="notes" Type="${r}/notesSlide" Target="../notesSlides/note${i}.xml"/>`
    );
    append(
      map,
      "[Content_Types].xml",
      `<Override xmlns="${ct}" PartName="/ppt/notesSlides/note${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
    );
  }
  for (let i = 1; i <= (distinctMasters ? 2 : 1); i++) {
    map.set(
      `ppt/notesMasters/master${i}.xml`,
      encoder.encode(
        `<p:notesMaster xmlns:p="${p}"><p:cSld name="Notes style ${i}"><p:spTree>${tree}</p:spTree></p:cSld><p:clrMap/></p:notesMaster>`
      )
    );
    append(
      map,
      "[Content_Types].xml",
      `<Override xmlns="${ct}" PartName="/ppt/notesMasters/master${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`
    );
  }
  append(
    map,
    "ppt/_rels/presentation.xml.rels",
    `<Relationship xmlns="${rel}" Id="notesMaster" Type="${r}/notesMaster" Target="notesMasters/master1.xml"/>`
  );
  const xml = parseXmlPart(map.get("ppt/presentation.xml")!, context.xmlLimits);
  map.set(
    "ppt/presentation.xml",
    xml
      .spliceChildren(xml.root, 1, 0, [
        `<p:notesMasterIdLst xmlns:p="${p}" xmlns:r="${r}"><p:notesMasterId r:id="notesMaster"/></p:notesMasterIdLst>`
      ])
      .bytes()
  );
  return map;
}

describe("notes graph ownership", () => {
  beforeAll(() => {
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) =>
      delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
  });
  afterAll(() => vi.restoreAllMocks());
  it("duplicates a private notes slide with a reciprocal owner and the shared master", async () => {
    const source = await fixture();
    const result = parts(
      await duplicateSlides(archive(source), { selection, position: 2 }, context)
    );
    expect(target(result, "ppt/slides/_rels/slide1-copy1.xml.rels", "notesSlide")).toBe(
      "../notesSlides/note1-copy1.xml"
    );
    expect(target(result, "ppt/notesSlides/_rels/note1-copy1.xml.rels", "slide")).toBe(
      "../slides/slide1-copy1.xml"
    );
    expect(target(result, "ppt/notesSlides/_rels/note1-copy1.xml.rels", "notesMaster")).toBe(
      "../notesMasters/master1.xml"
    );
    expect(
      attributes(result.get("ppt/notesSlides/note1-copy1.xml")!, "ph").map((shape) => shape.type)
    ).toEqual(["body", "sldImg", "dt", "ftr"]);
    expect(decoder.decode(result.get("ppt/notesSlides/note1-copy1.xml"))).toContain("Speaker 1");
    for (const name of [
      "ppt/notesSlides/note1.xml",
      "ppt/notesSlides/note2.xml",
      "ppt/notesMasters/master1.xml"
    ])
      expect(result.get(name), name).toEqual(source.get(name));
  });
  it("deletes the selected opaque notes with its slide and retains survivor notes and shared master", async () => {
    const source = await fixture(true);
    source.set("ppt/notesSlides/note2.xml", (await fixture()).get("ppt/notesSlides/note2.xml")!);
    const result = parts(await removeSlides(archive(source), { selection }, context));
    expect(result.has("ppt/notesSlides/note1.xml")).toBe(false);
    expect(result.has("ppt/notesSlides/_rels/note1.xml.rels")).toBe(false);
    expect(result.get("ppt/notesSlides/note2.xml")).toEqual(
      source.get("ppt/notesSlides/note2.xml")
    );
    expect(result.get("ppt/notesMasters/master1.xml")).toEqual(
      source.get("ppt/notesMasters/master1.xml")
    );
    expect(target(result, "ppt/notesSlides/_rels/note2.xml.rels", "slide")).toBe(
      "../slides/slide2.xml"
    );
    expect(
      attributes(result.get("[Content_Types].xml")!, "Override").some(
        (entry) => entry.PartName === "/ppt/notesSlides/note1.xml"
      )
    ).toBe(false);
  });
  it("imports two associated notes slides with one copied master and unchanged placeholder roles", async () => {
    const destination = await createPresentation({ slides: [] }, context);
    const result = parts(
      await importSlides(
        destination,
        archive(await fixture()),
        { sourceSlides: [2, 1], themePolicy: "source" },
        context
      )
    );
    expect(attributes(result.get("ppt/presentation.xml")!, "notesMasterId")).toHaveLength(1);
    for (const i of [1, 2]) {
      expect(target(result, `ppt/notesSlides/_rels/note${i}-import1.xml.rels`, "slide")).toBe(
        `../slides/slide${i}-import1.xml`
      );
      expect(target(result, `ppt/notesSlides/_rels/note${i}-import1.xml.rels`, "notesMaster")).toBe(
        "../notesMasters/master1-import1.xml"
      );
      expect(
        attributes(result.get(`ppt/notesSlides/note${i}-import1.xml`)!, "ph").map(
          (shape) => shape.type
        )
      ).toEqual(["body", "sldImg", "dt", "ftr"]);
    }
  });
  it("rejects deletion when opaque survivor notes may contain hidden slide references", async () => {
    const source = archive(await fixture(true));
    const before = source.slice();
    await expect(removeSlides(source, { selection }, context)).rejects.toMatchObject({
      code: "dangling-reference"
    });
    expect(source).toEqual(before);
  });
  it.each(["source", "destination"] as const)(
    "rejects competing %s notes masters without rewriting either input",
    async (kind) => {
      const source = archive(await fixture(false, kind === "source"));
      const destination =
        kind === "destination"
          ? archive(await fixture())
          : await createPresentation({ slides: [] }, context);
      const before = [source.slice(), destination.slice()];
      await expect(
        importSlides(destination, source, { sourceSlides: [1, 2] }, context)
      ).rejects.toMatchObject({ code: "unsupported-edit" });
      expect(source).toEqual(before[0]);
      expect(destination).toEqual(before[1]);
    }
  );
  it.each(["duplicate", "import"] as const)(
    "rejects opaque note graph remapping during %s without altering source",
    async (operation) => {
      const source = archive(await fixture(true));
      const before = source.slice();
      const run =
        operation === "duplicate"
          ? duplicateSlides(source, { selection, position: 2 }, context)
          : importSlides(
              await createPresentation({ slides: [] }, context),
              source,
              { sourceSlides: [1] },
              context
            );
      await expect(run).rejects.toMatchObject({ code: "unsupported-edit" });
      expect(source).toEqual(before);
    }
  );
});
