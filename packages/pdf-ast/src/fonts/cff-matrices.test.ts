import { expect, it, vi } from "vitest";
import { createCffGlyphRenderer } from "./cff.js";
import { CFFCompiler, type CffDict, type CffFont } from "../vendor/pdfjs-fonts.mjs";

function dictionary(matrix?: number[]): CffDict {
  const values = new Map<string, unknown>();
  if (matrix) values.set("FontMatrix", matrix);
  return {
    hasName: (name: string) => values.has(name),
    removeByName: (name: string) => { values.delete(name); },
    getByName: (name: string) => values.get(name),
    setByName: (name: string, value: unknown) => { values.set(name, value); },
  } as CffDict;
}

it.each([{ matrix: undefined }, { matrix: [2, 0, 0, 3, 10, 20] }])("normalizes CID font matrices without compiling an output font: $matrix", ({ matrix }) => {
  const top = dictionary([0.001, 0, 0, 0.001, 0, 0]);
  const child = dictionary(matrix);
  const cff = {
    isCIDFont: true, charset: { charset: [0] },
    charStrings: { objects: [new Uint8Array([139, 139, 21, 239, 139, 5, 14])] },
    globalSubrIndex: { objects: [] }, topDict: top,
    fdArray: [child], fdSelect: { getFDIndex: () => 0 },
  } as unknown as CffFont;
  const compile = vi.spyOn(CFFCompiler.prototype, "compile").mockImplementation(() => { throw new Error("unnecessary whole-font compilation"); });
  let path;
  try { path = createCffGlyphRenderer(cff)(0); }
  finally { compile.mockRestore(); }
  const first = path[0]!; const second = path[1]!;
  expect(first.kind).toBe("move"); expect(second.kind).toBe("line");
  if (first.kind !== "move" || second.kind !== "line") throw new Error("missing CFF path");
  expect(first.x).toBeCloseTo(matrix ? 0.01 : 0);
  expect(first.y).toBeCloseTo(matrix ? 0.02 : 0);
  expect(second.x).toBeCloseTo(matrix ? 0.21 : 0.1);
  expect(second.y).toBeCloseTo(matrix ? 0.02 : 0);
  // A second renderer must not apply the parent transform twice.
  expect(createCffGlyphRenderer(cff)(0)).toEqual(path);
  expect([...createCffGlyphRenderer(cff).segments(0)]).toEqual(path);
});
