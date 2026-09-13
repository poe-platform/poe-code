import { expect, it, vi } from "vitest";
import { addShapePath, setShapePath } from "./shape-path-operations.js";
import { pathFromVertices, readShapePath } from "./shape-paths.js";
import { parseXmlPart } from "./xml.js";
const path = {
  unit: "emu",
  width: 10,
  height: 10,
  commands: [
    { type: "move", x: 0, y: 0 },
    { type: "line", x: 10, y: 10 }
  ]
} as const;
it("rejects unused edit properties before reading input", async () => {
  const read = vi.fn();
  await expect(
    setShapePath({ read }, { path, update: { name: "ignored" } } as never, {} as never)
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(read).not.toHaveBeenCalled();
});
it("rejects nested option getters without execution", async () => {
  let calls = 0;
  const update = {
    get name() {
      calls++;
      return "side effect";
    }
  };
  const read = vi.fn();
  await expect(addShapePath({ read }, { path, update }, {} as never)).rejects.toMatchObject({
    code: "invalid-value"
  });
  expect(calls).toBe(0);
  expect(read).not.toHaveBeenCalled();
});
it("accepts exact object vertices and rejects extra keys", () => {
  expect(
    pathFromVertices(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      ],
      false
    )
  ).toEqual(path);
  expect(() =>
    pathFromVertices(
      [
        { x: 0, y: 0, extra: 1 },
        { x: 10, y: 10 }
      ],
      false
    )
  ).toThrow();
});
it("marks geometry with unexpected text preserve-only", () => {
  const document = parseXmlPart(
    new TextEncoder().encode(
      '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spPr><a:custGeom>unexpected<a:pathLst><a:path w="10" h="10"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="10" y="10"/></a:lnTo></a:path></a:pathLst></a:custGeom></p:spPr></p:sp>'
    ),
    { maxBytes: 65536, maxNodes: 100, maxDepth: 12 }
  );
  expect(readShapePath(document, document.root)).toMatchObject({ path: null, unsupported: true });
});
it("rejects length property getters before shape option validation", async () => {
  let calls = 0;
  const update = {
    left: {
      get value() {
        calls++;
        return 0;
      },
      unit: "emu" as const
    },
    top: { value: 0, unit: "emu" as const },
    width: { value: 10, unit: "emu" as const },
    height: { value: 10, unit: "emu" as const }
  };
  await expect(
    addShapePath({ read: vi.fn() }, { path, update }, {} as never)
  ).rejects.toMatchObject({ code: "invalid-value" });
  expect(calls).toBe(0);
});
