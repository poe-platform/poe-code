import { expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import { Table } from "./tables-model.js";
import { applyTableStructure } from "./table-spans.js";
const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
function fixture() {
  const rows = [
    ["north", "east", "side"],
    ["south", "west", "edge"],
    ["base", "foot", "end"]
  ];
  return parseXmlPart(
    new TextEncoder().encode(
      `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${ns}"><p:nvGraphicFramePr><p:cNvPr id="8" name="Grid"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="60" cy="120"/></p:xfrm><a:graphic><a:graphicData uri="${ns.slice(0, -5)}/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="10"/><a:gridCol w="20"/><a:gridCol w="30"/></a:tblGrid>${rows.map((row, r) => `<a:tr h="${30 + r * 10}">${row.map((text) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1"/><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`).join("")}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
    ),
    { maxBytes: 1000000, maxNodes: 10000, maxDepth: 40 }
  );
}
function merged() {
  const doc = fixture();
  return applyTableStructure(doc, doc.root, {
    kind: "merge",
    from: { row: 0, column: 0 },
    to: { row: 1, column: 1 }
  });
}
it("combines origins in reading order and writes all four physical continuation combinations", () => {
  const table = new Table(merged());
  expect(table.cell(0, 0).text).toBe("north\neast\nsouth\nwest");
  expect([...table.iter_cells()].map((c) => [c.span_width, c.span_height, c.is_spanned])).toEqual([
    [2, 2, false],
    [1, 2, true],
    [1, 1, false],
    [2, 1, true],
    [1, 1, true],
    [1, 1, false],
    [1, 1, false],
    [1, 1, false],
    [1, 1, false]
  ]);
  expect(table.xml.markup(table.element)).toContain('b="1"');
  expect([...table.iter_cells()].map((c) => c.text)).toEqual([
    "north\neast\nsouth\nwest",
    "",
    "side",
    "",
    "",
    "edge",
    "base",
    "foot",
    "end"
  ]);
});
it("splits only an origin without redistributing owned text", () => {
  const doc = merged();
  expect(() =>
    applyTableStructure(doc, doc.root, { kind: "split", cell: { row: 1, column: 1 } })
  ).toThrow();
  const result = applyTableStructure(doc, doc.root, { kind: "split", cell: { row: 0, column: 0 } }),
    table = new Table(result);
  expect([...table.iter_cells()].every((c) => !c.is_spanned && !c.is_merge_origin)).toBe(true);
  expect(table.cell(0, 0).text).toBe("north\neast\nsouth\nwest");
  expect(table.cell(1, 1).text).toBe("");
});
it("rejects reversed rectangles and partial intersections but accepts full containment", () => {
  const doc = merged(),
    bytes = doc.bytes();
  for (const [from, to] of [
    [
      { row: 1, column: 1 },
      { row: 2, column: 2 }
    ],
    [
      { row: 2, column: 0 },
      { row: 0, column: 2 }
    ]
  ])
    expect(() =>
      applyTableStructure(doc, doc.root, { kind: "merge", from: from!, to: to! })
    ).toThrow();
  expect(doc.bytes()).toEqual(bytes);
  const t = new Table(
    applyTableStructure(doc, doc.root, {
      kind: "merge",
      from: { row: 0, column: 0 },
      to: { row: 2, column: 2 }
    })
  );
  expect(t.cell(0, 0).text).toBe("north\neast\nsouth\nwest\nside\nedge\nbase\nfoot\nend");
});
it.each(["rows", "columns"] as const)(
  "requires explicit policy for %s insertion and expands crossing spans",
  (axis) => {
    const doc = merged();
    expect(() =>
      applyTableStructure(doc, doc.root, { kind: `${axis}-add`, position: 1, spanPolicy: "reject" })
    ).toThrow();
    const t = new Table(
      applyTableStructure(doc, doc.root, { kind: `${axis}-add`, position: 1, spanPolicy: "expand" })
    );
    expect(axis === "rows" ? t.cell(0, 0).span_height : t.cell(0, 0).span_width).toBe(3);
    expect(
      axis === "rows"
        ? [...t.rows].map((r) => r.height.emu)
        : [...t.columns].map((c) => c.width.emu)
    ).toEqual(axis === "rows" ? [30, 40, 40, 50] : [10, 20, 20, 30]);
    expect(t.cell(0, 0).text).toBe("north\neast\nsouth\nwest");
  }
);
it.each(["rows", "columns"] as const)(
  "transfers origin content during %s deletion and shrinks spans",
  (axis) => {
    const doc = merged();
    expect(() =>
      applyTableStructure(doc, doc.root, {
        kind: `${axis}-remove`,
        position: 0,
        spanPolicy: "reject"
      })
    ).toThrow();
    const t = new Table(
      applyTableStructure(doc, doc.root, {
        kind: `${axis}-remove`,
        position: 0,
        spanPolicy: "shrink"
      })
    );
    expect(t.cell(0, 0).text).toBe("north\neast\nsouth\nwest");
    expect([t.cell(0, 0).span_width, t.cell(0, 0).span_height]).toEqual(
      axis === "rows" ? [2, 1] : [1, 2]
    );
    expect(
      axis === "rows"
        ? [...t.rows].map((r) => r.height.emu)
        : [...t.columns].map((c) => c.width.emu)
    ).toEqual(axis === "rows" ? [40, 50] : [20, 30]);
  }
);
it("supports neutral cell merge and split methods with owner identity", () => {
  const table = new Table(fixture());
  table.cell(0, 0).merge(table.cell(1, 1));
  expect(table.cell(0, 0).is_merge_origin).toBe(true);
  expect(() => table.cell(0, 0).merge(new Table(fixture()).cell(2, 2))).toThrow();
  table.cell(0, 0).split();
  expect(table.cell(0, 0).is_merge_origin).toBe(false);
});
it("invalidates retained coordinate handles and text frames after dimension changes", () => {
  const table = new Table(fixture()),
    cell = table.cell(1, 1),
    row = table.rows[1]!,
    column = table.columns[1]!,
    frame = cell.text_frame;
  table.structure({ kind: "rows-add", position: 0, spanPolicy: "expand" });
  for (const read of [() => cell.text, () => row.height, () => column.width, () => frame.text])
    expect(read).toThrow("invalidated");
  expect(() => {
    frame.text = "stale";
  }).toThrow("invalidated");
  expect(table.cell(2, 1).text).toBe("west");
});
it("rejects a last dimension deletion and refuses missing or accessor policies", () => {
  const doc = fixture();
  expect(() =>
    applyTableStructure(doc, doc.root, { kind: "rows-add", position: 0 } as never)
  ).toThrow();
  let calls = 0;
  expect(() =>
    applyTableStructure(doc, doc.root, {
      kind: "rows-add",
      position: 0,
      get spanPolicy() {
        calls++;
        return "expand" as const;
      }
    })
  ).toThrow();
  expect(calls).toBe(0);
  let current = doc;
  for (let i = 0; i < 2; i++)
    current = applyTableStructure(current, current.root, {
      kind: "columns-remove",
      position: 0,
      spanPolicy: "shrink"
    });
  expect(() =>
    applyTableStructure(current, current.root, {
      kind: "columns-remove",
      position: 0,
      spanPolicy: "shrink"
    })
  ).toThrow();
});
it.each(['hMerge="1"', 'gridSpan="4"', 'gridSpan="2"', 'rowSpan="0"'])(
  "rejects malformed rectangular metadata %s",
  (attributes) => {
    const original = fixture(),
      source = original.markup(original.root, true);
    const doc = parseXmlPart(
      new TextEncoder().encode(source.replace("<a:tc>", `<a:tc ${attributes}>`)),
      { maxBytes: 1000000, maxNodes: 10000, maxDepth: 40 }
    );
    expect(() =>
      applyTableStructure(doc, doc.root, { kind: "rows-add", position: 3, spanPolicy: "expand" })
    ).toThrow();
  }
);
it("keeps cell collections iterable and invalidates retained row cell collections", () => {
  const table = new Table(fixture()),
    cells = table.rows[0]!.cells;
  expect([...cells].map((cell) => cell.text)).toEqual(["north", "east", "side"]);
  table.structure({ kind: "columns-add", position: 0, spanPolicy: "expand" });
  expect(() => cells.length).toThrow("invalidated");
});
it("preserves identity merge bytes including empty paragraph formatting", () => {
  const doc = fixture(),
    result = applyTableStructure(doc, doc.root, {
      kind: "merge",
      from: { row: 0, column: 0 },
      to: { row: 0, column: 0 }
    });
  expect(result.bytes()).toEqual(doc.bytes());
  const span = merged();
  expect(
    applyTableStructure(span, span.root, {
      kind: "merge",
      from: { row: 0, column: 0 },
      to: { row: 1, column: 1 }
    }).bytes()
  ).toEqual(span.bytes());
});
it("refuses bulk assignment of text to continuation cells", () => {
  const table = new Table(merged());
  expect(() =>
    table.update({
      data: [
        ["owner", "hidden", "side"],
        ["", "", "edge"],
        ["base", "foot", "end"]
      ]
    })
  ).toThrow();
  expect(table.cell(0, 1).text).toBe("");
});
it("preserves admitted deeply nested foreign cell extensions", () => {
  const source = fixture(),
    xml = source.markup(source.root, true),
    opaque = '<z:node xmlns:z="urn:cell-data">'.repeat(75) + "payload" + "</z:node>".repeat(75);
  const doc = parseXmlPart(
    new TextEncoder().encode(xml.replace("<a:tcPr/>", "<a:tcPr/>" + opaque)),
    { maxBytes: 1000000, maxNodes: 10000, maxDepth: 128 }
  );
  const result = applyTableStructure(doc, doc.root, {
    kind: "merge",
    from: { row: 0, column: 0 },
    to: { row: 1, column: 1 }
  });
  expect(result.markup(result.root)).toContain(opaque);
});
it("retains semantic empty paragraphs and fields in merged origin content", () => {
  const source = fixture(),
    xml = source.markup(source.root, true);
  const doc = parseXmlPart(
    new TextEncoder().encode(
      xml.replace(
        '<a:r><a:rPr b="1"/><a:t>north</a:t></a:r>',
        '<a:pPr lvl="2"/><a:fld id="field-9" type="slidenum"><a:t/></a:fld>'
      )
    ),
    { maxBytes: 1000000, maxNodes: 10000, maxDepth: 128 }
  );
  const result = applyTableStructure(doc, doc.root, {
    kind: "merge",
    from: { row: 0, column: 0 },
    to: { row: 0, column: 1 }
  });
  expect(result.markup(result.root)).toContain('<a:pPr lvl="2"/>');
  expect(result.markup(result.root)).toContain('id="field-9"');
  expect(new Table(result).cell(0, 0).text).toBe("\neast");
});
it.each(["rows", "columns"] as const)(
  "inserts before and after %s spans without expanding them",
  (axis) => {
    for (const position of [0, 3]) {
      const doc = merged();
      const result = applyTableStructure(doc, doc.root, {
        kind: `${axis}-add`,
        position,
        spanPolicy: "reject"
      });
      const table = new Table(result);
      const origin = table.cell(
        axis === "rows" && position === 0 ? 1 : 0,
        axis === "columns" && position === 0 ? 1 : 0
      );
      expect([origin.span_width, origin.span_height, origin.text]).toEqual([
        2,
        2,
        "north\neast\nsouth\nwest"
      ]);
      const sizes =
        axis === "rows"
          ? [...table.rows].map((row) => row.height.emu)
          : [...table.columns].map((column) => column.width.emu);
      expect(sizes).toEqual(
        axis === "rows"
          ? position === 0
            ? [30, 30, 40, 50]
            : [30, 40, 50, 50]
          : position === 0
            ? [10, 10, 20, 30]
            : [10, 20, 30, 30]
      );
      const frame = result.root.children.find((node) => node.name.localName === "xfrm")!;
      const ext = frame.children.find((node) => node.name.localName === "ext")!;
      expect(
        ext.attributes.map((attribute) => [attribute.name.localName, attribute.value])
      ).toEqual([
        ["cx", String(axis === "columns" ? (position === 0 ? 70 : 90) : 60)],
        ["cy", String(axis === "rows" ? (position === 0 ? 150 : 170) : 120)]
      ]);
    }
  }
);
it.each(["rows", "columns"] as const)(
  "deletes inside and after %s spans with exact surviving text and dimensions",
  (axis) => {
    for (const position of [1, 2]) {
      const doc = merged();
      const result = applyTableStructure(doc, doc.root, {
        kind: `${axis}-remove`,
        position,
        spanPolicy: position === 1 ? "shrink" : "reject"
      });
      const table = new Table(result);
      expect([table.cell(0, 0).span_width, table.cell(0, 0).span_height]).toEqual(
        position === 2 ? [2, 2] : axis === "rows" ? [2, 1] : [1, 2]
      );
      expect([...table.iter_cells()].map((cell) => cell.text)).toEqual(
        axis === "rows"
          ? position === 1
            ? ["north\neast\nsouth\nwest", "", "side", "base", "foot", "end"]
            : ["north\neast\nsouth\nwest", "", "side", "", "", "edge"]
          : position === 1
            ? ["north\neast\nsouth\nwest", "side", "", "edge", "base", "end"]
            : ["north\neast\nsouth\nwest", "", "", "", "base", "foot"]
      );
      expect(
        axis === "rows"
          ? [...table.rows].map((row) => row.height.emu)
          : [...table.columns].map((column) => column.width.emu)
      ).toEqual(
        axis === "rows"
          ? position === 1
            ? [30, 50]
            : [30, 40]
          : position === 1
            ? [10, 30]
            : [10, 20]
      );
      const ext = result.root.children
        .find((node) => node.name.localName === "xfrm")!
        .children.find((node) => node.name.localName === "ext")!;
      expect(
        ext.attributes.map((attribute) => [attribute.name.localName, attribute.value])
      ).toEqual([
        ["cx", String(axis === "columns" ? (position === 1 ? 40 : 30) : 60)],
        ["cy", String(axis === "rows" ? (position === 1 ? 80 : 70) : 120)]
      ]);
    }
  }
);
it.each(["rows", "columns"] as const)(
  "removes a complete single-dimension span with its deleted %s",
  (axis) => {
    const source = fixture();
    const doc = applyTableStructure(source, source.root, {
      kind: "merge",
      from: { row: 0, column: 0 },
      to: axis === "rows" ? { row: 0, column: 1 } : { row: 1, column: 0 }
    });
    const table = new Table(
      applyTableStructure(doc, doc.root, {
        kind: `${axis}-remove`,
        position: 0,
        spanPolicy: "shrink"
      })
    );
    expect([...table.iter_cells()].every((cell) => !cell.is_spanned && !cell.is_merge_origin)).toBe(
      true
    );
    expect([...table.iter_cells()].map((cell) => cell.text)).toEqual(
      axis === "rows"
        ? ["south", "west", "edge", "base", "foot", "end"]
        : ["east", "side", "west", "edge", "foot", "end"]
    );
  }
);
it("rejects physical rows that do not match the rectangular column grid", () => {
  const doc = fixture();
  const graphic = doc.root.children.find((node) => node.name.localName === "graphic")!;
  const table = graphic.children[0]!.children[0]!;
  const row = table.children.find((node) => node.name.localName === "tr")!;
  const malformed = doc.spliceChildren(row, 0, 1, []);
  const bytes = malformed.bytes();
  expect(() =>
    applyTableStructure(malformed, malformed.root, {
      kind: "rows-add",
      position: 1,
      spanPolicy: "expand"
    })
  ).toThrow("physical cell rows");
  expect(malformed.bytes()).toEqual(bytes);
});
