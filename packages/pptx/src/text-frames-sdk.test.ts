import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation, mutateTextFrames, readTextFrames } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 },
  validationLimits: {
    maxBytes: 8192,
    maxNodes: 1000,
    maxDepth: 32,
    maxParts: 32,
    maxRelationships: 64,
    maxEntries: 32
  }
};

it("round trips multiple frame configurations through memory while preserving other package members", async () => {
  const volume = Volume.fromJSON({});
  const source = await createPresentation(
    {
      slides: [
        {
          shapes: [
            { name: "First", x: 0, y: 0, width: 200, height: 100, text: "Hill" },
            { name: "Second", x: 0, y: 100, width: 200, height: 100, text: "Valley" }
          ]
        }
      ]
    },
    context
  );
  volume.writeFileSync("/source.pptx", source);
  const result = await mutateTextFrames(
    new Uint8Array(volume.readFileSync("/source.pptx") as Buffer),
    {
      all: true,
      marginLeft: -2,
      marginRight: 4,
      marginTop: 0,
      marginBottom: 7,
      verticalAnchor: "middle",
      columns: 2,
      wrap: true,
      verticalText: "eaVert",
      rotation: -15,
      autofit: "shape"
    },
    context
  );
  volume.writeFileSync("/result.pptx", result.bytes);
  expect(result.affected).toBe(2);
  const raw = new TextDecoder().decode(
    inspectZip(result.bytes).find((e) => e.name === "ppt/slides/slide1.xml")!.payload
  );
  for (const fragment of [
    'lIns="-25400"',
    'rIns="50800"',
    'tIns="0"',
    'bIns="88900"',
    'anchor="ctr"',
    'numCol="2"',
    'wrap="square"',
    'vert="eaVert"',
    'rot="-900000"',
    "spAutoFit"
  ])
    expect(raw).toContain(fragment);
  const records = await readTextFrames(
    new Uint8Array(volume.readFileSync("/result.pptx") as Buffer),
    {},
    context
  );
  expect(records).toHaveLength(2);
  for (const record of records)
    expect(record.formatting).toEqual({
      marginLeft: -2,
      marginRight: 4,
      marginTop: 0,
      marginBottom: 7,
      verticalAnchor: "middle",
      columns: 2,
      wrap: true,
      verticalText: "eaVert",
      rotation: -15,
      autofit: "shape"
    });
  for (const entry of inspectZip(source).filter((e) => e.name !== "ppt/slides/slide1.xml"))
    expect(inspectZip(result.bytes).find((e) => e.name === entry.name)?.payload).toEqual(
      entry.payload
    );
  await expect(mutateTextFrames(source, { all: true, columns: 17 }, context)).rejects.toMatchObject(
    { code: "invalid-value" }
  );
  expect(new Uint8Array(volume.readFileSync("/source.pptx") as Buffer)).toEqual(source);
});
it("limits shape frames to shapes while preserving cell text and cell layout", async () => {
  const { storedArchive } = await import("../tests/fixtures/archive.js");
  const { parseXmlPart } = await import("./xml.js");
  const source = await createPresentation(
    {
      slides: [{ shapes: [{ name: "Label", x: 0, y: 0, width: 100, height: 100, text: "North" }] }]
    },
    context
  );
  const entries = inspectZip(source);
  const slide = entries.find((e) => e.name === "ppt/slides/slide1.xml")!;
  const xml = parseXmlPart(slide.payload, context.xmlLimits);
  const tree = xml.root.children
    .find((n) => n.name.localName === "cSld")!
    .children.find((n) => n.name.localName === "spTree")!;
  const table =
    '<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvGraphicFramePr><p:cNvPr id="44" name="Grid"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody><a:tcPr marL="300" anchor="b"/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
  const changed = xml.spliceChildren(tree, tree.children.length, 0, [table]);
  const bytes = storedArchive(
    entries.map((e) => ({ name: e.name, bytes: e === slide ? changed.bytes() : e.payload }))
  );
  expect(await readTextFrames(bytes, {}, context)).toHaveLength(1);
  const result = await mutateTextFrames(
    bytes,
    { all: true, marginLeft: 2, verticalAnchor: "middle" },
    context
  );
  expect(result.affected).toBe(1);
  const resultXml = parseXmlPart(
    inspectZip(result.bytes).find((e) => e.name === slide.name)!.payload,
    context.xmlLimits
  );
  const resultTable = resultXml.root.children
    .find((n) => n.name.localName === "cSld")!
    .children.find((n) => n.name.localName === "spTree")!
    .children.find((n) => n.name.localName === "graphicFrame")!;
  expect(resultXml.markup(resultTable)).toBe(table);
  expect(
    await readTextFrames(bytes, { select: { kind: "slide", id: "256" }, shape: "Grid" }, context)
  ).toEqual([]);
  await expect(
    mutateTextFrames(
      bytes,
      { select: { kind: "slide", id: "256" }, shape: "Grid", marginLeft: 2 },
      context
    )
  ).rejects.toMatchObject({ code: "missing-selection" });
  expect(
    (
      await mutateTextFrames(
        bytes,
        { select: { kind: "slide", id: "256" }, shape: "Grid", allowEmpty: true, marginLeft: 2 },
        context
      )
    ).affected
  ).toBe(0);
});
