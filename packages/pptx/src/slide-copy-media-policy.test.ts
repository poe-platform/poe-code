import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPresentation } from "./creation.js";
import { duplicateSlides } from "./slide-copy.js";
import { applyTemplateRepeat } from "./template-repeat.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { inspectZip } from "../tests/zip-reader.js";
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
const p = "http://schemas.openxmlformats.org/presentationml/2006/main",
  r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const encode = new TextEncoder();
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, ms?: number) =>
    ms === 0 ? queueMicrotask(cb) : timer(cb, ms)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
function attributes(bytes: Uint8Array, name: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === name)
      result.push(Object.fromEntries(Object.values(tag.attributes).map((a) => [a.name, a.value])));
  });
  parser.write(new TextDecoder().decode(bytes)).close();
  return result;
}
async function fixture(linked = false) {
  const original = await createPresentation(
    { slides: [{ shapes: [{ x: 0, y: 0, width: 100, height: 100, text: "{{title}}" }] }, {}] },
    context
  );
  const parts = new Map<string, Uint8Array>(
    inspectZip(original).map((entry) => [entry.name, entry.payload])
  );
  const append = (name: string, xml: string) => {
    const document = parseXmlPart(parts.get(name)!, context.xmlLimits);
    parts.set(
      name,
      document.spliceChildren(document.root, document.root.children.length, 0, [xml]).bytes()
    );
  };
  const add = (name: string, contentType: string, data: string | number[]) => {
    parts.set(name, typeof data === "string" ? encode.encode(data) : new Uint8Array(data));
    append(
      "[Content_Types].xml",
      `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${name}" ContentType="${contentType}"/>`
    );
  };
  add(
    "ppt/notesSlides/note.xml",
    "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
    `<p:notes xmlns:p="${p}"><p:cSld name="Carry water"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:notes>`
  );
  add(
    "ppt/notesMasters/master.xml",
    "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
    `<p:notesMaster xmlns:p="${p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap/></p:notesMaster>`
  );
  parts.set(
    "ppt/notesSlides/_rels/note.xml.rels",
    encode.encode(
      `<Relationships xmlns="${rel}"><Relationship Id="back" Type="${r}/slide" Target="../slides/slide1.xml"/><Relationship Id="master" Type="${r}/notesMaster" Target="../notesMasters/master.xml"/></Relationships>`
    )
  );
  add(
    "ppt/charts/chart.xml",
    "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${r}"><c:chart/><c:externalData r:id="sheet"/></c:chartSpace>`
  );
  parts.set(
    "ppt/charts/_rels/chart.xml.rels",
    encode.encode(
      `<Relationships xmlns="${rel}"><Relationship Id="sheet" Type="${r}/package" Target="../embeddings/data.xlsx"/></Relationships>`
    )
  );
  add(
    "ppt/embeddings/data.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    [80, 75, 3, 4, 17]
  );
  for (const kind of ["image", "audio", "video"])
    add(`ppt/media/${kind}.bin`, `${kind}/test`, [11, 22, 33]);
  for (const [kind, target] of [
    ["notesSlide", "../notesSlides/note.xml"],
    ["chart", "../charts/chart.xml"],
    ...["image", "audio", "video"].map((kind) => [kind, `../media/${kind}.bin`]),
    ...(linked ? [["slide", "slide2.xml"]] : [])
  ])
    append(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationship xmlns="${rel}" Id="${kind}" Type="${r}/${kind}" Target="${target}"/>`
    );
  append(
    "ppt/slides/slide1.xml",
    `<p:timing xmlns:p="${p}"><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:anim><p:cBhvr><p:cTn id="2"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`
  );
  const bytes = storedArchive([...parts].map(([name, bytes]) => ({ name, bytes })));
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Uint8Array(volume.readFileSync("/deck") as Buffer);
}
it.each(["shared-media", "isolated-instance"] as const)(
  "repeats notes, charts, media and timings with %s",
  async (mediaPolicy) => {
    const input = await fixture();
    const result = await applyTemplateRepeat(
      input,
      {
        kind: "repeat",
        slides: [1],
        mediaPolicy,
        records: ["North", "South"].map((text) => [
          { kind: "text", name: "title", slide: 1, scope: "slides", cardinality: "one", text }
        ])
      },
      context
    );
    const parts = new Map(inspectZip(result.bytes).map((entry) => [entry.name, entry.payload]));
    for (const number of [1, 2]) {
      const relations = attributes(
        parts.get(`ppt/slides/_rels/slide1-copy${number}.xml.rels`)!,
        "Relationship"
      );
      for (const kind of ["image", "audio", "video"]) {
        expect(relations.find((edge) => edge.Type === `${r}/${kind}`)!.Target).toBe(
          `../media/${kind}${mediaPolicy === "isolated-instance" ? `-copy${number}` : ""}.bin`
        );
        expect(
          parts.get(
            `ppt/media/${kind}${mediaPolicy === "isolated-instance" ? `-copy${number}` : ""}.bin`
          )
        ).toEqual(new Uint8Array([11, 22, 33]));
      }
      expect(relations.find((edge) => edge.Type === `${r}/notesSlide`)!.Target).toBe(
        `../notesSlides/note-copy${number}.xml`
      );
      expect(
        attributes(
          parts.get(`ppt/notesSlides/_rels/note-copy${number}.xml.rels`)!,
          "Relationship"
        )[0]!.Target
      ).toBe(`../slides/slide1-copy${number}.xml`);
      expect(
        attributes(parts.get(`ppt/notesSlides/note-copy${number}.xml`)!, "cSld")[0]!.name
      ).toBe("Carry water");
      expect(
        attributes(parts.get(`ppt/charts/_rels/chart-copy${number}.xml.rels`)!, "Relationship")[0]!
          .Target
      ).toBe(`../embeddings/data-copy${number}.xlsx`);
      expect(parts.get(`ppt/embeddings/data-copy${number}.xlsx`)).toEqual(
        new Uint8Array([80, 75, 3, 4, 17])
      );
      expect(attributes(parts.get(`ppt/slides/slide1-copy${number}.xml`)!, "spTgt")[0]!.spid).toBe(
        "4"
      );
    }
  }
);
it("remaps links between designated slides inside each copied group", async () => {
  const input = await fixture(true);
  const result = await duplicateSlides(
    input,
    {
      selection: [
        { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
        { kind: "slide", position: { coordinateSystem: "one-based", value: 2 } }
      ],
      position: 3
    },
    context
  );
  const parts = new Map(inspectZip(result).map((entry) => [entry.name, entry.payload]));
  expect(
    attributes(parts.get("ppt/slides/_rels/slide1-copy1.xml.rels")!, "Relationship").find(
      (edge) => edge.Type === `${r}/slide`
    )!.Target
  ).toBe("slide2-copy1.xml");
});
it("owns the selected media policy before asynchronous input admission", async () => {
  const input = await fixture();
  const options = {
    selection: {
      kind: "slide" as const,
      position: { coordinateSystem: "one-based" as const, value: 1 }
    },
    position: 3,
    mediaPolicy: "isolated-instance" as "isolated-instance" | "shared-media"
  };
  const pending = duplicateSlides(input, options, context);
  options.mediaPolicy = "shared-media";
  const parts = new Map(inspectZip(await pending).map((entry) => [entry.name, entry.payload]));
  expect(parts.has("ppt/media/image-copy1.bin")).toBe(true);
});
it("rejects a media policy accessor without invoking it", async () => {
  const getter = vi.fn(() => "isolated-instance" as const),
    read = vi.fn(async () => null);
  await expect(
    duplicateSlides(
      { read },
      {
        selection: { kind: "slide", all: true },
        position: 1,
        get mediaPolicy() {
          return getter();
        }
      },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(getter).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
