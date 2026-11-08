import { expect, it } from "vitest";
import {
  applyShapeSelection,
  validateShapeSelectionOptions,
  type ShapeSelectionOptions
} from "./shape-selection.js";
import { parseXmlPart } from "./xml.js";
import { attr, required } from "./masters.js";
import { nodeFor } from "./shape-operations.js";
import { readShape } from "./shapes.js";
import { Length } from "./length.js";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const shape = (id: number, x = 0, y = 0, w = 10, h = 10, extra = "") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Panel ${id}"/><p:cNvSpPr>${extra}</p:cNvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
const doc = (body: string, tail = "") =>
  parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${body}<p:extLst/></p:spTree></p:cSld>${tail}</p:sld>`
    ),
    { maxBytes: 100000, maxNodes: 2000, maxDepth: 40 }
  );
const ids = (source: ReturnType<typeof doc>) =>
  required(required(source.root, "cSld"), "spTree")
    .children.filter((n) => n.name.localName !== "extLst")
    .map((n) => attr(required(n.children[0]!, "cNvPr"), "id"));
const coordinateSystem = "slide" as const;
it.each([
  ["front", ["1", "3", "5", "2", "4"]],
  ["back", ["2", "4", "1", "3", "5"]],
  ["forward", ["1", "3", "2", "5", "4"]],
  ["backward", ["2", "1", "4", "3", "5"]]
] as const)("moves a disjoint selection %s in original sibling order", (order, expected) => {
  const source = doc([1, 2, 3, 4, 5].map((id) => shape(id)).join(""));
  const result = applyShapeSelection(source, ["4", "2"], {
    action: "move",
    order,
    coordinateSystem
  });
  expect(ids(result.doc)).toEqual(expected);
  expect(result.doc.root.children[0]!.children[0]!.children.at(-1)!.name.localName).toBe("extLst");
  expect(ids(source)).toEqual(["1", "2", "3", "4", "5"]);
});
it("moves a selection block to an explicit one-based position", () => {
  const result = applyShapeSelection(
    doc([1, 2, 3, 4, 5].map((id) => shape(id)).join("")),
    ["4", "2"],
    { action: "move", position: 2, coordinateSystem }
  );
  expect(ids(result.doc)).toEqual(["1", "2", "4", "3", "5"]);
});
it.each([
  ["left", [0, 0], [0, 20]],
  ["center", [15, 5], [0, 20]],
  ["right", [30, 10], [0, 20]],
  ["top", [0, 10], [0, 0]],
  ["middle", [0, 10], [20, 10]],
  ["bottom", [0, 10], [40, 20]]
] as const)("aligns %s against the selected stored union", (alignment, x, y) => {
  const result = applyShapeSelection(
    doc(shape(1, 0, 0, 10, 10) + shape(2, 10, 20, 30, 30)),
    ["2", "1"],
    { action: "align", alignment, coordinateSystem }
  );
  const records = ["1", "2"].map((id) => readShape(nodeFor(result.doc.root, id)));
  expect(records.map((r) => r.left)).toEqual(x);
  expect(records.map((r) => r.top)).toEqual(y);
});
it("rounds negative half-coordinate alignment ties away from zero", () => {
  const result = applyShapeSelection(doc(shape(1, -4, 0, 2) + shape(2, -3, 0, 3)), ["1", "2"], {
    action: "align",
    alignment: "center",
    coordinateSystem
  });
  expect(readShape(nodeFor(result.doc.root, "1")).left).toBe(-3);
  expect(readShape(nodeFor(result.doc.root, "2")).left).toBe(-4);
});
it("distributes variable widths by edge gaps with stable coordinate ties", () => {
  const result = applyShapeSelection(
    doc(shape(1, 0, 0, 10) + shape(2, 0, 0, 20) + shape(3, 100, 0, 30) + shape(4, 17, 0, 5)),
    ["4", "3", "2", "1"],
    { action: "distribute", axis: "horizontal", coordinateSystem }
  );
  expect([1, 2, 3, 4].map((id) => readShape(nodeFor(result.doc.root, String(id))).left)).toEqual([
    0, 32, 100, 73
  ]);
  expect(ids(result.doc)).toEqual(["1", "2", "3", "4"]);
});
it("allows negative vertical gaps and preserves both endpoints", () => {
  const result = applyShapeSelection(
    doc(shape(1, 0, 0, 10, 20) + shape(2, 0, 1, 10, 30) + shape(3, 0, 10, 10, 20)),
    ["1", "2", "3"],
    { action: "distribute", axis: "vertical", coordinateSystem }
  );
  expect([1, 2, 3].map((id) => readShape(nodeFor(result.doc.root, String(id))).top)).toEqual([
    0, 0, 10
  ]);
});
it("rejects locked selections atomically and includes explicitly hidden shapes", () => {
  const source = doc(shape(1) + shape(2, 20, 0, 10, 10, '<a:spLocks noMove="1"/>'));
  expect(() =>
    applyShapeSelection(source, ["1", "2"], {
      action: "align",
      alignment: "left",
      coordinateSystem
    })
  ).toThrow(/locked/i);
  const hidden = doc(
    shape(1).replace('name="Panel 1"', 'name="Panel 1" hidden="1"') + shape(2, 20)
  );
  const result = applyShapeSelection(hidden, ["1", "2"], {
    action: "align",
    alignment: "right",
    coordinateSystem
  });
  expect(readShape(nodeFor(result.doc.root, "1")).left).toBe(20);
  expect(result.doc.markup(nodeFor(result.doc.root, "1"))).toContain('hidden="1"');
});
const group = (body: string) =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="40" name="Assembly"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="200" cy="300"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></p:grpSpPr>${body}</p:grpSp>`;
it("uses child coordinates only for siblings in an explicit group space", () => {
  const source = doc(shape(1) + group(shape(2, 5) + shape(3, 25)));
  expect(() =>
    applyShapeSelection(source, ["1", "2"], {
      action: "align",
      alignment: "left",
      coordinateSystem
    })
  ).toThrow();
  expect(() =>
    applyShapeSelection(source, ["40", "2"], {
      action: "align",
      alignment: "left",
      coordinateSystem: "group"
    })
  ).toThrow();
  expect(() =>
    applyShapeSelection(source, ["2", "3"], {
      action: "align",
      alignment: "left",
      coordinateSystem
    })
  ).toThrow();
  const result = applyShapeSelection(source, ["2", "3"], {
    action: "align",
    alignment: "left",
    coordinateSystem: "group"
  });
  expect(readShape(nodeFor(result.doc.root, "3")).left).toBe(5);
  expect(result.doc.markup(required(nodeFor(result.doc.root, "40"), "grpSpPr"))).toBe(
    source.markup(required(nodeFor(source.root, "40"), "grpSpPr"))
  );
});
const connector = (id: number, start: number, end: number) =>
  `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Link"/><p:cNvCxnSpPr><a:stCxn id="${start}" idx="0"/><a:endCxn id="${end}" idx="2"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm><a:prstGeom prst="line"/></p:spPr></p:cxnSp>`;
it("duplicates in source order with fresh recursive IDs and remaps only internal connector ends", () => {
  const source = doc(shape(1) + group(shape(2) + connector(3, 2, 1)) + connector(41, 40, 1));
  const result = applyShapeSelection(source, ["41", "40"], {
    action: "duplicate",
    coordinateSystem,
    offsetX: new Length(7),
    offsetY: new Length(-3)
  });
  expect(result.ids).toEqual(["42", "45"]);
  expect(ids(result.doc)).toEqual(["1", "40", "41", "42", "45"]);
  expect(readShape(nodeFor(result.doc.root, "42"))).toMatchObject({ left: 107, top: 197 });
  expect(readShape(nodeFor(result.doc.root, "43"))).toMatchObject({ left: 0, top: 0 });
  expect(result.doc.markup(nodeFor(result.doc.root, "44"))).toContain('<a:stCxn id="43" idx="0"/>');
  expect(result.doc.markup(nodeFor(result.doc.root, "45"))).toContain('<a:stCxn id="42" idx="0"/>');
  expect(result.doc.markup(nodeFor(result.doc.root, "45"))).toContain('<a:endCxn id="1" idx="2"/>');
  expect(result.doc.markup(nodeFor(result.doc.root, "40"))).toBe(
    source.markup(nodeFor(source.root, "40"))
  );
});
it("preserves timing targeting originals and rejects opaque duplicate-local identity extensions", () => {
  const source = doc(shape(1), '<p:timing><p:tnLst><p:spTgt spid="1"/></p:tnLst></p:timing>');
  const result = applyShapeSelection(source, ["1"], {
    action: "duplicate",
    coordinateSystem,
    offsetX: new Length(0),
    offsetY: new Length(0)
  });
  expect(result.doc.markup(required(result.doc.root, "timing"))).toBe(
    source.markup(required(source.root, "timing"))
  );
  expect(() =>
    applyShapeSelection(
      doc(shape(1).replace("</p:sp>", '<p:extLst><p:ext uri="opaque"/></p:extLst></p:sp>')),
      ["1"],
      { action: "duplicate", coordinateSystem, offsetX: new Length(0), offsetY: new Length(0) }
    )
  ).toThrow(/opaque/i);
});
it("rejects duplicate identities, missing space, unsafe offsets and insufficient selections", () => {
  const source = doc(shape(1) + shape(2));
  expect(() =>
    applyShapeSelection(source, ["1", "1"], {
      action: "align",
      alignment: "left",
      coordinateSystem
    })
  ).toThrow();
  expect(() =>
    applyShapeSelection(source, ["1"], { action: "align", alignment: "left", coordinateSystem })
  ).toThrow();
  expect(() =>
    applyShapeSelection(source, ["1", "2"], {
      action: "distribute",
      axis: "horizontal",
      coordinateSystem
    })
  ).toThrow();
  expect(() =>
    applyShapeSelection(source, ["1"], {
      action: "duplicate",
      coordinateSystem,
      offsetX: new Length(27273042316901),
      offsetY: new Length(0)
    })
  ).toThrow();
});
it("appends copies above every existing sibling while retaining trailing metadata", () => {
  const result = applyShapeSelection(doc(shape(1) + shape(2) + shape(3)), ["1"], {
    action: "duplicate",
    coordinateSystem,
    offsetX: new Length(0),
    offsetY: new Length(0)
  });
  expect(ids(result.doc)).toEqual(["1", "2", "3", "4"]);
});
it("rejects foreign connector lookalikes and opaque copied attributes", () => {
  for (const extra of [
    '<z:stCxn xmlns:z="urn:private" id="1"/>',
    '<a:stCxn xmlns:z="urn:private" z:id="1"/>'
  ]) {
    expect(() =>
      applyShapeSelection(doc(shape(1, 0, 0, 10, 10, extra)), ["1"], {
        action: "duplicate",
        coordinateSystem,
        offsetX: new Length(0),
        offsetY: new Length(0)
      })
    ).toThrow(/opaque/i);
  }
});
it.each([
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4]
] as const)("allocates the next numeric identity after %s", (existing, next) => {
  const result = applyShapeSelection(doc(shape(existing)), [String(existing)], {
    action: "duplicate",
    coordinateSystem,
    offsetX: new Length(0),
    offsetY: new Length(0)
  });
  expect(result.ids).toEqual([String(next)]);
});
it("uses the maximum valid identity and reuses a hole only after exhaustion", () => {
  const options = {
    action: "duplicate",
    coordinateSystem,
    offsetX: new Length(0),
    offsetY: new Length(0)
  } as const;
  expect(applyShapeSelection(doc(shape(1) + shape(3)), ["1"], options).ids).toEqual(["4"]);
  expect(applyShapeSelection(doc(shape(2) + shape(4294967295)), ["2"], options).ids).toEqual(["1"]);
});
it.each(["word", "1word", "1"])("rejects malformed or colliding existing identity %s", (value) => {
  const source = doc(shape(1) + shape(2).replace('id="2"', `id="${value}"`));
  expect(() =>
    applyShapeSelection(source, ["1"], {
      action: "duplicate",
      coordinateSystem,
      offsetX: new Length(0),
      offsetY: new Length(0)
    })
  ).toThrow(/identity/i);
});
it("preserves unrelated grouping size and rotation locks during alignment", () => {
  const source = doc(
    shape(1) + shape(2, 30, 0, 10, 10, '<a:spLocks noGrp="1" noResize="1" noRot="1"/>')
  );
  const result = applyShapeSelection(source, ["1", "2"], {
    action: "align",
    alignment: "left",
    coordinateSystem
  });
  expect(readShape(nodeFor(result.doc.root, "2")).left).toBe(0);
  expect(result.doc.markup(nodeFor(result.doc.root, "2"))).toContain(
    '<a:spLocks noGrp="1" noResize="1" noRot="1"/>'
  );
});
it("rejects copying when the selection or its containing group prohibits copies", () => {
  for (const source of [
    doc(shape(1, 0, 0, 10, 10, '<a:spLocks noCopy="1"/>')),
    doc(
      group(shape(1)).replace(
        "<p:cNvGrpSpPr/>",
        '<p:cNvGrpSpPr><a:grpSpLocks noCopy="1"/></p:cNvGrpSpPr>'
      )
    )
  ]) {
    expect(() =>
      applyShapeSelection(source, ["1"], {
        action: "duplicate",
        coordinateSystem: ids(source).includes("40") ? "group" : "slide",
        offsetX: new Length(0),
        offsetY: new Length(0)
      })
    ).toThrow(/locked/i);
  }
});
it("maps connector targets by numeric identity when source lexical forms differ", () => {
  const source = doc(shape(1).replace('id="1"', 'id="001"') + connector(2, 1, 1));
  const result = applyShapeSelection(source, ["001", "2"], {
    action: "duplicate",
    coordinateSystem,
    offsetX: new Length(0),
    offsetY: new Length(0)
  });
  expect(result.ids).toEqual(["3", "4"]);
  expect(result.doc.markup(nodeFor(result.doc.root, "4"))).toContain('<a:stCxn id="3" idx="0"/>');
  expect(result.doc.markup(nodeFor(result.doc.root, "4"))).toContain('<a:endCxn id="3" idx="2"/>');
});
it("moves selected runs one neighbor without crossing order boundaries", () => {
  const source = doc([1, 2, 3, 4, 5].map((id) => shape(id)).join(""));
  expect(
    ids(
      applyShapeSelection(source, ["3", "2"], {
        action: "move",
        order: "forward",
        coordinateSystem
      }).doc
    )
  ).toEqual(["1", "4", "2", "3", "5"]);
  expect(
    ids(
      applyShapeSelection(source, ["5", "4"], {
        action: "move",
        order: "forward",
        coordinateSystem
      }).doc
    )
  ).toEqual(["1", "2", "3", "4", "5"]);
  expect(
    ids(
      applyShapeSelection(source, ["1", "2"], {
        action: "move",
        order: "backward",
        coordinateSystem
      }).doc
    )
  ).toEqual(["1", "2", "3", "4", "5"]);
});
it("does not treat an unselected locked sibling as an ordering barrier", () => {
  const source = doc(shape(1) + shape(2, 0, 0, 10, 10, '<a:spLocks noSelect="1"/>') + shape(3));
  expect(
    ids(
      applyShapeSelection(source, ["1"], { action: "move", order: "front", coordinateSystem }).doc
    )
  ).toEqual(["2", "3", "1"]);
});
it("preserves external relationship attributes when duplicating shape content", () => {
  const source = doc(
    shape(1).replace(
      "<p:cNvSpPr></p:cNvSpPr>",
      '<p:cNvSpPr/><a:hlinkClick xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId7"/>'
    )
  );
  const result = applyShapeSelection(source, ["1"], {
    action: "duplicate",
    coordinateSystem,
    offsetX: new Length(0),
    offsetY: new Length(0)
  });
  expect(result.doc.markup(nodeFor(result.doc.root, "2"))).toContain('r:id="rId7"');
});
it("rejects missing space and accessor-backed selection fields without evaluating them", () => {
  let calls = 0;
  const options = {
    action: "move",
    order: "front",
    coordinateSystem,
    get shape() {
      calls++;
      return "Panel";
    }
  };
  expect(() => validateShapeSelectionOptions(options as ShapeSelectionOptions)).toThrow();
  expect(calls).toBe(0);
  expect(() =>
    validateShapeSelectionOptions({ action: "move", order: "front" } as ShapeSelectionOptions)
  ).toThrow(/space/i);
});
it("rejects sparse and accessor-backed identity arrays before evaluating entries", () => {
  let calls = 0;
  const shapes = new Array(1);
  Object.defineProperty(shapes, "0", {
    get() {
      calls++;
      return {
        fingerprint: "f",
        scope: "slides",
        owner: "part",
        objectId: "1",
        coordinateSystem: "identity"
      };
    }
  });
  expect(() =>
    validateShapeSelectionOptions({ action: "move", order: "front", coordinateSystem, shapes })
  ).toThrow();
  expect(calls).toBe(0);
  expect(() =>
    validateShapeSelectionOptions({
      action: "move",
      order: "front",
      coordinateSystem,
      shapes: new Array(1)
    })
  ).toThrow();
});
it("preserves unrelated foreign lock lookalikes during layout edits", () => {
  const source = doc(
    shape(1) + shape(2, 30, 0, 10, 10, '<z:spLocks xmlns:z="urn:private" noMove="1"/>')
  );
  const result = applyShapeSelection(source, ["1", "2"], {
    action: "align",
    alignment: "left",
    coordinateSystem
  });
  expect(readShape(nodeFor(result.doc.root, "2")).left).toBe(0);
  expect(result.doc.markup(nodeFor(result.doc.root, "2"))).toContain('noMove="1"');
});
it("keeps distribution arithmetic exact across large coordinate spans", () => {
  const source = doc(
    shape(1, -27273042316000, 0, 11) +
      shape(2, -1000, 0, 13) +
      shape(3, 2000, 0, 17) +
      shape(4, 27273042316000, 0, 19)
  );
  const result = applyShapeSelection(source, ["4", "3", "2", "1"], {
    action: "distribute",
    axis: "horizontal",
    coordinateSystem
  });
  expect([1, 2, 3, 4].map((id) => readShape(nodeFor(result.doc.root, String(id))).left)).toEqual([
    -27273042316000, -9091014105336, 9091014105330, 27273042316000
  ]);
});
