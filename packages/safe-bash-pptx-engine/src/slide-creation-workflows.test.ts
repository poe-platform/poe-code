import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { SaxesParser } from "saxes";
import { Volume } from "memfs";
import {
  GraphicFrame,
  Length,
  Inches,
  Presentation,
  createPresentation,
  SlideShapes,
  parseXmlPart
} from "./index.js";

import { inspectZip } from "../tests/zip-reader.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

function textValues(bytes: Uint8Array): string[] {
  const result: string[] = [];
  let inside = false;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    inside =
      tag.local === "t" && tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main";
  });
  parser.on("text", (value) => {
    if (inside) result.push(value);
  });
  parser.on("closetag", () => {
    inside = false;
  });
  parser.write(new TextDecoder().decode(bytes)).close();
  return result;
}

const limits = { maxBytes: 100000, maxNodes: 1000, maxDepth: 32 };
function surface(strict = false) {
  const volume = Volume.fromJSON({});
  let xml = parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${strict ? "http://purl.oclc.org/ooxml/presentationml/main" : "http://schemas.openxmlformats.org/presentationml/2006/main"}" xmlns:a="${strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main"}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`
    ),
    limits
  );
  const owner = {
    read: () => xml,
    write: (updated: typeof xml) => {
      xml = updated;
      volume.writeFileSync("/slide.xml", xml.bytes());
    }
  };
  return { shapes: new SlideShapes(owner), owner, volume };
}
it("adds a table synchronously and returns the live frame with exact grid remainders", () => {
  const { shapes, owner, volume } = surface();
  const frame = shapes.add_table(2, 2, new Length(3), new Length(4), new Length(9), new Length(7));
  expect(frame).toBeInstanceOf(GraphicFrame);
  expect(frame.has_table).toBe(true);
  expect(frame.shape_id).toBe(2);
  expect([frame.left?.emu, frame.top?.emu, frame.width?.emu, frame.height?.emu]).toEqual([
    3, 4, 9, 7
  ]);
  expect([...frame.table.columns].map((column) => column.width.emu)).toEqual([5, 4]);
  expect([...frame.table.rows].map((row) => row.height.emu)).toEqual([4, 3]);
  frame.table.cell(1, 1).text = "Reef observations";
  expect((shapes[0] as GraphicFrame).table.cell(1, 1).text).toBe("Reef observations");
  expect(textValues(new Uint8Array(volume.readFileSync("/slide.xml") as Buffer))).toEqual([
    "Reef observations"
  ]);
  expect(owner.read().bytes()).toEqual(new Uint8Array(volume.readFileSync("/slide.xml") as Buffer));
});
it.each([0, -1, 1.5, Number.NaN])("rejects invalid table row count %s without mutation", (rows) => {
  const { shapes, owner } = surface();
  const before = owner.read().bytes();
  expect(() =>
    shapes.add_table(rows, 2, new Length(0), new Length(0), new Length(9), new Length(7))
  ).toThrowError(expect.objectContaining({ code: "invalid-value" }));
  expect(owner.read().bytes()).toEqual(before);
  expect(shapes.length).toBe(0);
});
it("adds tables inside groups with slide-wide unique IDs and recomputed bounds", () => {
  const { shapes } = surface();
  const group = shapes.add_group_shape();
  const frame = group.shapes.add_table(
    1,
    1,
    new Length(10),
    new Length(20),
    new Length(30),
    new Length(40)
  );
  const next = shapes.add_table(1, 1, new Length(0), new Length(0), new Length(5), new Length(5));
  expect([group.shape_id, frame.shape_id, next.shape_id]).toEqual([2, 3, 4]);
  expect([group.left?.emu, group.top?.emu, group.width?.emu, group.height?.emu]).toEqual([
    10, 20, 30, 40
  ]);
  frame.table.cell(0, 0).text = "Buoy";
  expect((group.shapes[0] as GraphicFrame).table.cell(0, 0).text).toBe("Buoy");
});

it("saves a newly inserted table through its presentation owner", async () => {
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
    xmlLimits: limits,
    relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
  };
  const deck = await Presentation(
    await createPresentation({ slides: [{ name: "Shore log" }] }, context),
    context
  );
  const frame = deck.slides[0]!.shapes.add_table(
    2,
    2,
    new Inches(1),
    new Inches(2),
    new Inches(3),
    new Inches(1)
  );
  frame.table.cell(1, 1).text = "Reef observations";
  frame.table.first_row = true;
  const saved = await deck.save();
  const xml = inspectZip(saved).find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload;
  expect(textValues(xml)).toEqual(["Reef observations"]);
  const reopened = await Presentation(saved, context);
  const read = reopened.slides[0]!.shapes[0] as GraphicFrame;
  expect(read.table.cell(1, 1).text).toBe("Reef observations");
  expect(read.table.first_row).toBe(true);
  expect([...read.table.columns].map((column) => column.width.emu)).toEqual([1371600, 1371600]);
  expect([...read.table.rows].map((row) => row.height.emu)).toEqual([457200, 457200]);
});

it.each([
  [0, 9, 7],
  [-1, 9, 7],
  [1.5, 9, 7],
  [2, 0, 7],
  [2, 9, 0]
])("rejects invalid columns or undersized geometry %s/%s/%s atomically", (cols, width, height) => {
  const { shapes, owner } = surface();
  const before = owner.read().bytes();
  expect(() =>
    shapes.add_table(
      2,
      cols!,
      new Length(0),
      new Length(0),
      new Length(width!),
      new Length(height!)
    )
  ).toThrowError(expect.objectContaining({ code: "invalid-value" }));
  expect(owner.read().bytes()).toEqual(before);
  expect(shapes.length).toBe(0);
});

it("inserts a table using its strict owner namespaces", () => {
  const { shapes, owner } = surface(true);
  const frame = shapes.add_table(
    1,
    1,
    new Length(0),
    new Length(0),
    new Length(10),
    new Length(10)
  );
  expect(frame.has_table).toBe(true);
  const namespaces: string[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    namespaces.push(tag.uri);
  });
  parser.write(new TextDecoder().decode(owner.read().bytes())).close();
  expect(new Set(namespaces)).toEqual(
    new Set([
      "http://purl.oclc.org/ooxml/presentationml/main",
      "http://purl.oclc.org/ooxml/drawingml/main"
    ])
  );
});
