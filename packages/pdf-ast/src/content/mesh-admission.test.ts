import { expect, it, vi } from "vitest";
import { cosArray, cosDict, cosName, cosNumber } from "../ast.js";
import { PdfDocument } from "../document.js";
import { evaluateContentStreamSteps } from "./evaluator.js";
import { parseContentEvents } from "./parser.js";
import { MeshShading, Stream } from "../vendor/pdfjs-fonts.mjs";

function mesh(onAllocation?: (bytes: number) => void, type = 4) {
  const bytes = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255]);
  const points = [0, 0, 0, 85, 0, 170, 0, 255, 85, 255, 170, 255, 255, 255, 255, 170, 255, 85, 255, 0, 170, 0, 85, 0, 85, 85, 85, 170, 170, 170, 170, 85];
  const input = type === 4 ? bytes : type === 5 ? new Uint8Array([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    : new Uint8Array([0, ...points.slice(0, type === 6 ? 24 : 32), 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const stream = new Stream(input);
  const context = { bitsPerCoordinate: 8, bitsPerComponent: 8, bitsPerFlag: 8,
    decode: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1], colorFn: null, numComps: 3,
    colorSpace: { numComps: 3, getRgb: (values: Float32Array) => Uint8Array.from(values, value => Math.round(value * 255)) },
    onAllocation };
  return { stream, create: () => new MeshShading(type, stream, context, 2) };
}
it("admits mesh state before input consumption and preserves owner rejection", () => {
  const rejection = { reason: "mesh budget" };
  const f = mesh(() => { throw rejection; });
  expect(() => f.create()).toThrow();
  expect(f.stream).toMatchObject({ pos: 0 });
  try { f.create(); } catch (error) { expect(error).toBe(rejection); }
});
it("admits packed geometry and vertex output without changing mesh values", () => {
  const admit = vi.fn(); const actual = mesh(admit).create();
  const expected = mesh().create().getIR();
  const before = admit.mock.calls.length;
  expect(actual.getIR()).toEqual(expected);
  expect(admit.mock.calls.length).toBeGreaterThan(before);
  const charges = admit.mock.calls.map(call => call[0] as number);
  expect(charges.every(bytes => Number.isSafeInteger(bytes) && bytes > 0)).toBe(true);
  expect(charges.reduce((a, b) => a + b, 0)).toBeGreaterThan(expected[2].byteLength + expected[3].byteLength);
  for (let index = 0; index < charges.length; index++) {
    let calls = 0; const rejection = { index };
    const f = mesh(() => { if (calls++ === index) throw rejection; });
    let caught: unknown;
    try { f.create().getIR(); } catch (error) { caught = error; }
    expect(caught).toBe(rejection);
  }
});

it("routes shading surface admission to the containing evaluation owner", () => {
  const doc = PdfDocument.create();
  const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));
  const shading = cosDict({ ShadingType: cosNumber(2), ColorSpace: cosName("DeviceRGB"), Coords: numbers([0, 0, 10, 0]),
    Function: cosDict({ FunctionType: cosNumber(2), N: cosNumber(1), C0: numbers([0, 0, 0]), C1: numbers([1, 1, 1]) }) });
  const rejection = { reason: "surface" };
  const options = { pageIndex: 0, width: 10, height: 10, cosDoc: doc.cos, resourcesDict: cosDict({ Shading: cosDict({ S: shading }) }),
    nodes: parseContentEvents(new TextEncoder().encode("/S sh")), onShadingAllocation: () => { throw rejection; } };
  let caught: unknown;
  try { Array.from(evaluateContentStreamSteps(options)); } catch (error) { caught = error; }
  expect(caught).toBe(rejection);
});

it.each([5, 6, 7])("admits type %s mesh geometry independently for each owner", type => {
  const baseline = mesh(undefined, type).create().getIR();
  const allocations: number[][] = [];
  for (let run = 0; run < 2; run++) {
    const charges: number[] = [];
    expect(mesh(bytes => charges.push(bytes), type).create().getIR()).toEqual(baseline);
    allocations.push(charges);
  }
  expect(allocations[0]).toEqual(allocations[1]);
  const charges = allocations[0]!;
  expect(charges.length).toBeGreaterThan(10);
  for (const stop of [0, Math.floor(charges.length / 2), charges.length - 1]) {
    let calls = 0; const rejection = { stop };
    let caught: unknown;
    try { mesh(() => { if (calls++ === stop) throw rejection; }, type).create().getIR(); } catch (error) { caught = error; }
    expect(caught).toBe(rejection);
  }
});
