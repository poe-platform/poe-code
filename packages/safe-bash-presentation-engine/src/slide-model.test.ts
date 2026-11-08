import { expect, it } from "vitest";
import { Volume } from "memfs";
import { SlideShapes, SlidePlaceholders, GraphicFrame, SlidePlaceholder } from "./slide-model.js";
import { parseXmlPart } from "./xml.js";
import { Length } from "./length.js";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
function slot(id: number, idx: number, type = "tbl", geometry = "") {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Slot ${idx}"/><p:cNvSpPr/><p:nvPr><p:ph idx="${idx}" type="${type}"/></p:nvPr></p:nvSpPr><p:spPr>${geometry}</p:spPr></p:sp>`;
}
function fixture(
  shapes = slot(2, 10) + slot(3, 0),
  inherited = slot(
    2,
    10,
    "tbl",
    '<a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm>'
  )
) {
  const volume = Volume.fromJSON({});
  const parse = (body: string) =>
    parseXmlPart(
      new TextEncoder().encode(
        `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`
      ),
      { maxBytes: 100000, maxNodes: 1000, maxDepth: 32 }
    );
  let xml = parse(shapes);
  const owner = {
    read: () => xml,
    write: (next: typeof xml) => {
      xml = next;
      volume.writeFileSync("/slide", xml.bytes());
    },
    inherited: () => [parse(inherited)]
  };
  return {
    owner,
    shapes: new SlideShapes(owner),
    placeholders: new SlidePlaceholders(owner),
    volume
  };
}
it("looks up sparse placeholder idx keys and iterates in key order", () => {
  const { placeholders, shapes } = fixture();
  expect(placeholders.length).toBe(2);
  expect(placeholders[10]!.shape_id).toBe(2);
  expect(placeholders.get(0).shape_id).toBe(3);
  expect([...placeholders].map((x) => x.placeholder_format.idx)).toEqual([0, 10]);
  expect(() => placeholders.get(1)).toThrowError(expect.objectContaining({ code: "missing-key" }));
  expect(() => placeholders.get(-1)).toThrowError(expect.objectContaining({ code: "missing-key" }));
  expect(shapes.length).toBe(2);
  expect(shapes[0]!.shape_id).toBe(2);
});
it("inherits geometry without materializing it and retains local coordinate overrides", () => {
  const { placeholders, owner } = fixture();
  const shape = placeholders.get(10);
  const original = owner.read().bytes();
  expect([shape.left?.emu, shape.top?.emu, shape.width?.emu, shape.height?.emu]).toEqual([
    100, 200, 300, 400
  ]);
  expect(owner.read().bytes()).toEqual(original);
  shape.left = new Length(120);
  expect([shape.left?.emu, shape.top?.emu, shape.width?.emu, shape.height?.emu]).toEqual([
    120, 200, 300, 400
  ]);
});
it("inserts a table frame at the old z-order, preserves idx and invalidates old handles", () => {
  const { placeholders, shapes, volume } = fixture();
  const old = placeholders.get(10) as SlidePlaceholder;
  const frame = old.insert_table(2, 3);
  expect(frame).toBeInstanceOf(GraphicFrame);
  expect(frame.has_table).toBe(true);
  expect(frame.has_chart).toBe(false);
  expect(frame.shape_id).toBe(2);
  expect(frame.placeholder_format.idx).toBe(10);
  expect(shapes[0]!.shape_id).toBe(2);
  expect(placeholders[10]).toBeInstanceOf(GraphicFrame);
  expect(() => old.left).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
  expect(() => {
    old.text = "stale";
  }).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
  frame.table.cell(0, 0).text = "Lake";
  expect(new TextDecoder().decode(volume.readFileSync("/slide") as Buffer)).toContain("Lake");
});
it("rejects ambiguous keys and invalid table replacement without invalidating its handle", () => {
  expect(() => fixture(slot(2, 7) + slot(3, 7)).placeholders.get(7)).toThrowError(
    expect.objectContaining({ code: "ambiguous-selection" })
  );
  const old = fixture().placeholders.get(10) as SlidePlaceholder;
  expect(() => old.insert_table(0, 2)).toThrow();
  expect(old.shape_id).toBe(2);
});
it("adds group children, connectors and freeforms with drawing-wide identities", () => {
  const { shapes } = fixture();
  shapes.turbo_add_enabled = true;
  expect(shapes.turbo_add_enabled).toBe(true);
  const group = shapes.add_group_shape();
  expect(group.shapes.length).toBe(0);
  const rect = group.shapes.add_shape(
    "RECTANGLE",
    new Length(10),
    new Length(20),
    new Length(30),
    new Length(40)
  );
  expect(rect.shape_id).toBe(5);
  expect(group.shapes[0]!.shape_id).toBe(5);
  expect([group.left?.emu, group.top?.emu, group.width?.emu, group.height?.emu]).toEqual([
    10, 20, 30, 40
  ]);
  const path = group.shapes
    .build_freeform(0, 0)
    .add_line_segments([
      [10, 20],
      [20, 0]
    ])
    .convert_to_shape();
  expect(path.shape_id).toBe(6);
  expect(path.shape_type).toBe(5);
  const connector = shapes.add_connector(
    1,
    new Length(0),
    new Length(0),
    new Length(30),
    new Length(40)
  );
  expect(connector.shape_id).toBe(7);
  expect(connector.begin_x.emu).toBe(0);
  expect(
    shapes.add_textbox(new Length(0), new Length(0), new Length(30), new Length(40)).shape_id
  ).toBe(8);
});
it("preserves explicit zero and exposes bounded collection access without treating sparse keys as positions", () => {
  const { shapes, placeholders } = fixture(
    slot(2, 10, "tbl", '<a:xfrm><a:off x="0" y="0"/></a:xfrm>')
  );
  const item = placeholders.get(10);
  expect([item.left?.emu, item.top?.emu, item.width?.emu, item.height?.emu]).toEqual([
    0, 0, 300, 400
  ]);
  item.top = new Length(30);
  item.width = new Length(500);
  item.height = new Length(600);
  expect([item.left?.emu, item.top?.emu, item.width?.emu, item.height?.emu]).toEqual([
    0, 30, 500, 600
  ]);
  expect(shapes.at(-1).shape_id).toBe(2);
  expect(shapes.get_by_id(2)?.shape_id).toBe(2);
  expect(shapes.get_by_id(900)).toBeNull();
  expect(shapes.title).toBeNull();
  expect(() => Reflect.set(placeholders, "10", item)).toThrow();
  expect(() => Reflect.defineProperty(placeholders, "10", { value: item })).toThrow();
  expect(() => Reflect.deleteProperty(placeholders, "10")).toThrow();
  expect(() => shapes.get(-1)).toThrow();
  expect(() => shapes.at(-2)).toThrow();
});
it("validates replacement methods and unresolved geometry without consuming its placeholder", async () => {
  const { placeholders } = fixture();
  const item = placeholders.get(10) as SlidePlaceholder;
  await expect(item.insert_picture(new Uint8Array())).rejects.toThrow();
  expect(() => item.insert_chart("LINE", { series: [] })).toThrow();
  const picture = fixture(slot(2, 10, "pic")).placeholders.get(10) as SlidePlaceholder;
  await expect(picture.insert_picture(new Uint8Array())).rejects.toMatchObject({
    code: "property-unavailable"
  });
  expect(picture.shape_id).toBe(2);
  const chart = fixture(slot(2, 10, "chart")).placeholders.get(10) as SlidePlaceholder;
  expect(() => chart.insert_chart("LINE", { series: [] })).toThrowError(
    expect.objectContaining({
      code: "property-unavailable"
    })
  );
  expect(() => fixture(slot(2, 10), "").placeholders.get(10).left).not.toThrow();
});
it("moves explicit owned shapes into a new group atomically and refuses foreign or duplicate handles", () => {
  const { shapes } = fixture("", "");
  const first = shapes.add_shape(
    "RECTANGLE",
    new Length(10),
    new Length(20),
    new Length(30),
    new Length(40)
  );
  const second = shapes.add_textbox(new Length(50), new Length(60), new Length(30), new Length(40));
  const foreign = fixture("", "").shapes.add_textbox(
    new Length(0),
    new Length(0),
    new Length(2),
    new Length(3)
  );
  expect(() => shapes.add_group_shape([foreign])).toThrow();
  expect(() => shapes.add_group_shape([first, first])).toThrow();
  expect(shapes.length).toBe(2);
  const group = shapes.add_group_shape([second, first]);
  expect(shapes.length).toBe(1);
  expect([...group.shapes].map((x) => x.shape_id)).toEqual([3, 2]);
  expect([group.left?.emu, group.top?.emu, group.width?.emu, group.height?.emu]).toEqual([
    10, 20, 70, 80
  ]);
  expect(first.shape_id).toBe(2);
  first.name = "Moved";
  expect(group.shapes.get_by_id(2)?.name).toBe("Moved");
});
