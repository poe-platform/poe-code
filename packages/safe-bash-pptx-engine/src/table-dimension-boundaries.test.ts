import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import {
  Length,
  Presentation,
  Table,
  addTable,
  createPresentation,
  createTableXml,
  parseXmlPart
} from "./index.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
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
  xmlLimits: { maxBytes: 100000, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
function tableFixture(): Table {
  return new Table(
    parseXmlPart(
      new TextEncoder().encode(
        createTableXml(7, {
          rows: 2,
          columns: 2,
          left: new Length(0),
          top: new Length(0),
          width: new Length(4),
          height: new Length(4)
        })
      ),
      context.xmlLimits
    )
  );
}

it.each([
  [1, 4],
  [4, 1],
  [1, 1]
])("rejects %s-by-%s EMU table creation through bytes and live model", async (width, height) => {
  const bytes = await createPresentation({ slides: [{ name: "Marsh survey" }] }, context);
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/source.pptx", bytes);
  const box = {
    left: new Length(0),
    top: new Length(0),
    width: new Length(width!),
    height: new Length(height!)
  };
  await expect(
    addTable(bytes, { slide: 1, update: { rows: 2, columns: 2, ...box } }, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(bytes).toEqual(new Uint8Array(volume.readFileSync("/source.pptx") as Buffer));
  const deck = await Presentation(bytes, context);
  const before = await deck.save();
  expect(() =>
    deck.slides[0]!.shapes.add_table(2, 2, box.left, box.top, box.width, box.height)
  ).toThrowError(expect.objectContaining({ code: "invalid-value" }));
  expect(deck.slides[0]!.shapes.length).toBe(0);
  expect(await deck.save()).toEqual(before);
});

it.each(["width", "height", "rowHeight", "columnWidth"] as const)(
  "rejects a zero requested %s before changing the table",
  (key) => {
    const table = tableFixture(),
      before = table.xml.bytes();
    expect(() => table.update({ [key]: new Length(0) })).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
    expect(table.xml.bytes()).toEqual(before);
  }
);
it.each(["width", "height"] as const)(
  "rejects requested %s that would distribute zero-sized cells",
  (key) => {
    const table = tableFixture(),
      before = table.xml.bytes();
    expect(() => table.update({ [key]: new Length(1) })).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
    expect(table.xml.bytes()).toEqual(before);
  }
);
it.each(["row", "column"] as const)(
  "rejects a zero %s size through the public collection setter",
  (kind) => {
    const table = tableFixture(),
      before = table.xml.bytes();
    expect(() => {
      if (kind === "row") table.rows[0]!.height = new Length(0);
      else table.columns[0]!.width = new Length(0);
    }).toThrowError(expect.objectContaining({ code: "invalid-value" }));
    expect(table.xml.bytes()).toEqual(before);
  }
);
it("admits minimum positive cells and preserves exact total extents", () => {
  const table = tableFixture();
  table.update({ width: new Length(2), height: new Length(2) });
  expect([...table.columns].map((column) => column.width.emu)).toEqual([1, 1]);
  expect([...table.rows].map((row) => row.height.emu)).toEqual([1, 1]);
});
it("preserves imported zero-size grid entries during unrelated text and style edits", () => {
  const table = tableFixture();
  let xml = table.xml;
  const grid = () => xml.root.children[2]!.children[0]!.children[0]!;
  for (let index = 0; index < 2; index++) {
    const column = grid().children.find((node) => node.name.localName === "tblGrid")!.children[
      index
    ]!;
    xml = xml.merge(column, { attributes: [{ namespace: "", localName: "w", value: "0" }] });
    const row = grid().children.filter((node) => node.name.localName === "tr")[index]!;
    xml = xml.merge(row, { attributes: [{ namespace: "", localName: "h", value: "0" }] });
  }
  const imported = new Table(xml);
  imported.cell(0, 0).text = "Tidal pool";
  imported.first_row = true;
  expect(imported.cell(0, 0).text).toBe("Tidal pool");
  expect(imported.first_row).toBe(true);
  expect([...imported.columns].map((column) => column.width.emu)).toEqual([0, 0]);
  expect([...imported.rows].map((row) => row.height.emu)).toEqual([0, 0]);
  imported.rows[0]!.height = new Length(1);
  imported.columns[0]!.width = new Length(1);
  expect([...imported.columns].map((column) => column.width.emu)).toEqual([1, 0]);
  expect([...imported.rows].map((row) => row.height.emu)).toEqual([1, 0]);
});
