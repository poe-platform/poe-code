import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { decodeXObjectImageToRgba } from "../extract/images.js";
import { evalShadingFunctionToComponents } from "./evaluator.js";

const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));
const doc = PdfDocument.create();

function exponential(domain: number[], n = 2, c0 = [0], c1 = [1]) {
  return cosDict({ FunctionType: cosNumber(2), Domain: numbers(domain), N: cosNumber(n), C0: numbers(c0), C1: numbers(c1) });
}

describe("PDF function domains", () => {
  // PDF.js PDFFunction.constructInterpolated raises the input itself to N.
  it("does not normalize exponential inputs to a unit interval", () => {
    expect(evalShadingFunctionToComponents(doc.cos, exponential([0.2, 0.8]), 0.4)[0]).toBeCloseTo(0.16, 12);
    expect(evalShadingFunctionToComponents(doc.cos, exponential([2, 4], 1, [0], [0.25]), 3)).toEqual([0.75]);
  });

  it("clips exponential inputs to Domain and outputs to Range", () => {
    const fn = exponential([0.2, 0.8]);
    dictSet(fn, "Range", numbers([0.1, 0.5]));
    expect(evalShadingFunctionToComponents(doc.cos, fn, -1)).toEqual([0.1]);
    expect(evalShadingFunctionToComponents(doc.cos, fn, 2)).toEqual([0.5]);
  });

  it("supports zero and negative exponents", () => {
    expect(evalShadingFunctionToComponents(doc.cos, exponential([0, 1], 0), 0.4)).toEqual([1]);
    expect(evalShadingFunctionToComponents(doc.cos, exponential([1, 4], -1), 2)).toEqual([0.5]);
  });

  it("defaults exponential functions to one output component", () => {
    const fn = cosDict({ FunctionType: cosNumber(2), Domain: numbers([0, 1]), N: cosNumber(1) });
    expect(evalShadingFunctionToComponents(doc.cos, fn, 0.4)).toEqual([0.4]);
  });

  it.each(["Separation", "DeviceN"])("applies exponential Range and zero N to %s images", family => {
    const fn = exponential([0, 1], 0);
    dictSet(fn, "Range", numbers([0, 0.4]));
    const colorSpace = cosArray([cosName(family), family === "DeviceN" ? cosArray([cosName("Spot")]) : cosName("Spot"), cosName("DeviceGray"), fn]);
    const stream = cosStream(new Uint8Array([128]), { dict: cosDict({ Width: cosNumber(1), Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: colorSpace }) });
    expect(Array.from(decodeXObjectImageToRgba(doc.cos, stream, undefined).rgba)).toEqual([102, 102, 102, 255]);
  });

  // PDF.js constructStitched clips the source, then maps it through Encode
  // without imposing a [0, 1] range on the child function's input.
  it.each([[0, 0.5], [0.5, 0.75], [1, 1], [-1, 0.5], [2, 1]])("preserves non-unit child domains at %s", (input, expected) => {
    const fn = cosDict({
      FunctionType: cosNumber(3), Domain: numbers([0, 1]), Bounds: numbers([]), Encode: numbers([2, 4]),
      Functions: cosArray([exponential([2, 4], 1, [0], [0.25])]),
    });
    expect(evalShadingFunctionToComponents(doc.cos, fn, input)).toEqual([expected]);
  });

  it("selects the following segment at a bound and honors reversed Encode", () => {
    const fn = cosDict({
      FunctionType: cosNumber(3), Domain: numbers([10, 20]), Bounds: numbers([15]), Encode: numbers([0, 1, 4, 2]),
      Functions: cosArray([exponential([0, 1], 1), exponential([2, 4], 1, [0], [0.25])]),
      Range: numbers([0, 0.8]),
    });
    expect([10, 12.5, 15, 17.5, 20].map(input => evalShadingFunctionToComponents(doc.cos, fn, input)[0])).toEqual([0, 0.5, 0.8, 0.75, 0.5]);
  });
});
