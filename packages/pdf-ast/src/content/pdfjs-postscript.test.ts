import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { decodeXObjectImageToRgba } from "../extract/images.js";
import { evalShadingFunctionToComponents } from "./evaluator.js";

const numbers = (values: readonly number[]) => cosArray(values.map(value => cosNumber(value)));
function calculator(source: string, domain: readonly number[], range: readonly number[]) {
  return cosStream(new TextEncoder().encode(source), { dict: cosDict({ FunctionType: cosNumber(4), Domain: numbers(domain), Range: numbers(range) }) });
}
const doc = PdfDocument.create();

// Source strings, domains, ranges, inputs and expected results ported from
// Mozilla PDF.js test/unit/postscript_spec.js at the revision in our notices.
// The upstream compileAndRun helper tests JS and Wasm; these exercise PDF COS.
const vectors: [string, number[], number[], number[], number[]][] = [
  ["{ add }", [0, 1, 0, 1], [0, 2], [0.3, 0.7], [1]],
  ["{ sub }", [0, 1, 0, 1], [0, 1], [0.8, 0.3], [0.5]],
  ["{ 0.5 mul }", [0, 1], [0, 1], [0.4], [0.2]],
  ["{ div }", [0, 10, 0, 10], [0, 10], [6, 3], [2]],
  ["{ div }", [0, 10, 0, 10], [0, 10], [5, 0], [0]],
  ["{ idiv }", [0, 10, 1, 10], [0, 10], [7, 2], [3]],
  ["{ mod }", [0, 10, 1, 10], [0, 10], [7, 3], [1]],
  ["{ 5 xor }", [-128, 127], [-128, 127], [3], [6]],
  ["{ neg }", [-1, 1], [-1, 1], [-0.5], [0.5]],
  ["{ neg abs }", [-1, 1], [0, 1], [-0.8], [0.8]],
  ["{ 1.7 add cvi }", [0, 2], [0, 4], [0.5], [2]],
  ["{ cvr }", [0, 1], [0, 1], [0.7], [0.7]],
  ["{ sqrt }", [0, 100], [0, 10], [9], [3]],
  ["{ floor }", [-2, 2], [-2, 2], [1.7], [1]],
  ["{ ceiling }", [-2, 2], [-2, 2], [1.2], [2]],
  ["{ round }", [-2, 2], [-2, 2], [1.5], [2]],
  ["{ truncate }", [-2, 2], [-2, 2], [-1.9], [-1]],
  ["{ ln }", [0.001, 10], [-10, 10], [Math.E], [1]],
  ["{ log }", [0.001, 1000], [-3, 3], [100], [2]],
  ["{ 2 1 roll }", [0, 1, 0, 1], [0, 1, 0, 1], [0.3, 0.7], [0.7, 0.3]],
  ["{ 3 1 roll }", [0, 1, 0, 1, 0, 1], [0, 1, 0, 1, 0, 1], [0.1, 0.2, 0.3], [0.3, 0.1, 0.2]],
  ["{ dup dup }", [0, 1], [0, 1, 0, 1, 0, 1], [0.5], [0.5, 0.5, 0.5]],
  ["{ eq }", [0, 1, 0, 1], [0, 1], [0.5, 0.5], [1]],
  ["{ 0.5 ne }", [0, 1], [0, 1], [0.3], [1]],
  ["{ dup 0.5 gt { 2 mul } { 0.5 mul } ifelse }", [0, 1], [0, 2], [0.8], [1.6]],
  ["{ dup 0.5 gt { 2 mul } { 0.5 mul } ifelse }", [0, 1], [0, 2], [0.2], [0.1]],
  ["{ dup 1 gt { pop 1 } if }", [0, 2], [0, 2], [1.5], [1]],
  ["{ dup 1 gt { pop 1 } if }", [0, 2], [0, 2], [0.5], [0.5]],
  ["{ add }", [0, 1, 0, 1], [0, 0.5], [0.4, 0.4], [0.5]],
  ["{ 3 bitshift }", [0, 256], [0, 256], [1], [8]],
  ["{ -2 bitshift }", [-256, 256], [-256, 256], [8], [2]],
  ["{ not }", [-256, 256], [-256, 256], [5], [-6]],
  ["{ dup eq not }", [0, 1], [0, 1], [0.5], [0]],
  ["{ dup 0.3 gt exch 0.7 lt and }", [0, 1], [0, 1], [0.5], [1]],
  ["{ dup 0.3 lt exch 0.7 gt or }", [0, 1], [0, 1], [0.5], [0]],
];

describe("PDF.js calculator function reference vectors", () => {
  it.each(vectors)("evaluates %s with the declared inputs and outputs", (source, domain, range, input, expected) => {
    const actual = evalShadingFunctionToComponents(doc.cos, calculator(source, domain, range), input);
    expect(actual).toHaveLength(expected.length);
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));
  });

  it("skips PDF.js percent comments without executing their operands", () => {
    expect(evalShadingFunctionToComponents(doc.cos, calculator("{ % 100 add\n 2 mul }", [0, 1], [0, 2]), 0.3)).toEqual([0.6]);
  });

  it("keeps numeric bitwise and/or separate from boolean operations", () => {
    expect(evalShadingFunctionToComponents(doc.cos, calculator("{ 5 and }", [0, 10], [0, 10]), 3)).toEqual([1]);
    expect(evalShadingFunctionToComponents(doc.cos, calculator("{ 5 or }", [0, 10], [0, 10]), 3)).toEqual([7]);
  });

  it("applies calculator bitwise functions to image tints", () => {
    const fn = calculator("{ 255 mul cvi 5 xor 255 div }", [0, 1], [0, 1]);
    const colorSpace = cosArray([cosName("Separation"), cosName("Spot"), cosName("DeviceGray"), fn]);
    const image = cosStream(new Uint8Array([3]), { dict: cosDict({ Width: cosNumber(1), Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: colorSpace }) });
    expect(Array.from(decodeXObjectImageToRgba(doc.cos, image, undefined).rgba)).toEqual([6, 6, 6, 255]);
  });

  it("limits surplus stack values to the outputs recovered by PDF.js", () => {
    // PDF.js's default JS compiler recovers the first declared output when
    // malformed code leaves extra values; preserve that library behavior.
    expect(evalShadingFunctionToComponents(doc.cos, calculator("{ dup 2 mul }", [0, 1], [0, 2]), 0.3)).toEqual([0.3]);
  });

  it("does not reuse a compiled function after edits to its code or ranges", () => {
    const fn = calculator("{ 2 mul }", [0, 1], [0, 2]);
    expect(evalShadingFunctionToComponents(doc.cos, fn, 0.4)).toEqual([0.8]);
    dictSet(fn.dict, "Range", numbers([0, 0.5]));
    expect(evalShadingFunctionToComponents(doc.cos, fn, 0.4)).toEqual([0.5]);
    fn.decodedBytes!.set(new TextEncoder().encode("{ 1 mul }"));
    expect(evalShadingFunctionToComponents(doc.cos, fn, 0.4)).toEqual([0.4]);
    dictSet(fn.dict, "Domain", numbers([0, 0.2]));
    expect(evalShadingFunctionToComponents(doc.cos, fn, 0.4)).toEqual([0.2]);
  });
});


it.each(vectors)("retains native calculator results through stored instructions: %s",async(source,domain,range,input,expected)=>{
 const {createMemoryFileSystem}=await import("@poe-code/safe-fs"),{PagedStorage}=await import("@poe-code/safe-fs/storage");
 const {compileStoredPostScript}=await import("./stored-postscript.js"),{evalShadingFunctionSteps}=await import("./evaluator.js");
 const fs=createMemoryFileSystem(),storage=new PagedStorage({fs,cwd:"/",env:{},signal:new AbortController().signal},2),stream=calculator(source,domain,range);
 try{
  const compiled=await compileStoredPostScript({size:stream.rawBytes.length,async read(at,length){return stream.rawBytes.slice(at,at+length);}},storage,()=>{});
  const work=evalShadingFunctionSteps(doc.cos,stream,input,new WeakMap([[stream,compiled]]));let step=work.next();while(!step.done)step=work.next(await step.value.source.read(step.value.position,step.value.length));
  expect(step.value).toHaveLength(expected.length);step.value.forEach((value,index)=>expect(value).toBeCloseTo(expected[index]!,9));
 }finally{await storage.close();}
});
