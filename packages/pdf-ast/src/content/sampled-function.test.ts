import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosNumber, cosStream } from "../ast.js";
import { PdfDocument } from "../document.js";
import { evalShadingFunctionToComponents } from "./evaluator.js";

const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));

function sampled(samples: number[], bits = 8, options: { size?: number[]; domain?: number[]; range?: number[]; encode?: number[]; decode?: number[]; order?: number } = {}) {
  const bytes = new Uint8Array(Math.ceil(samples.length * bits / 8));
  // Pack MSB first, including samples crossing byte boundaries.
  samples.forEach((sample, index) => {
    for (let bit = 0; bit < bits; bit++) {
      const offset = index * bits + bit;
      bytes[Math.floor(offset / 8)]! |= Math.floor(sample / 2 ** (bits - bit - 1)) % 2 * 2 ** (7 - offset % 8);
    }
  });
  const stream = cosStream(bytes, { dict: cosDict({
    FunctionType: cosNumber(0), BitsPerSample: cosNumber(bits),
    Domain: numbers(options.domain ?? [0, 1]), Range: numbers(options.range ?? [0, 1]),
    Size: numbers(options.size ?? [samples.length]),
    ...(options.encode ? { Encode: numbers(options.encode) } : {}),
    ...(options.decode ? { Decode: numbers(options.decode) } : {}),
    ...(options.order ? { Order: cosNumber(options.order) } : {}),
  }) });
  const doc = PdfDocument.create();
  return (inputs: number | number[]) => evalShadingFunctionToComponents(doc.cos, stream, inputs);
}

describe("PDF.js sampled-function interpolation", () => {
  it.each([1, 2, 4, 8, 12, 16, 24, 32])("interpolates unsigned %s-bit samples", bits => {
    const evaluate = sampled([0, 2 ** bits - 1], bits);
    for (const input of [-1, 0, 0.25, 0.5, 0.75, 1, 2]) {
      expect(evaluate(input)[0]).toBeCloseTo(Math.max(0, Math.min(1, input)), 12);
    }
  });

  it("reads non-byte-aligned output tuples without mixing adjacent samples", () => {
    const evaluate = sampled([0, 7, 15, 15, 8, 0], 4, { size: [2], range: [0, 1, 0, 1, 0, 1] });
    expect(evaluate(0)).toEqual([0, 7 / 15, 1]);
    expect(evaluate(0.5)).toEqual([0.5, 0.5, 0.5]);
    expect(evaluate(1)).toEqual([1, 8 / 15, 0]);
  });

  it("maps Domain through reversed Encode and applies Decode before Range", () => {
    const evaluate = sampled([0, 255], 8, { domain: [10, 20], encode: [1, 0], decode: [-1, 3], range: [0, 1] });
    expect([9, 12.5, 15, 17.5, 20, 21].map(x => evaluate(x)[0])).toEqual([1, 1, 1, 0, 0, 0]);
    expect(evaluate(16.25)).toEqual([0.5]);
  });

  it("interpolates every input axis with the first input varying fastest", () => {
    const evaluate = sampled([0, 100, 200, 255], 8, { size: [2, 2], domain: [0, 1, 0, 1] });
    expect(evaluate([1, 0])).toEqual([100 / 255]);
    expect(evaluate([0, 1])).toEqual([200 / 255]);
    expect(evaluate([0.25, 0.75])[0]).toBeCloseTo((0 * 0.75 * 0.25 + 100 * 0.25 * 0.25 + 200 * 0.75 * 0.75 + 255 * 0.25 * 0.75) / 255, 12);
  });

  // Ported from PDF.js colorspace_spec.js, AlternateCS's sampled function
  // with a degenerate Domain. Assert tint components before RGB conversion.
  it("handles PDF.js's degenerate /None input without affecting other axes", () => {
    const samples: number[] = [];
    for (let index = 0; index < 8; index++) {
      const spot = index & 1, black = (index >> 2) & 1;
      samples.push(spot * 255, spot * 51, spot * 184, black * 255);
    }
    const evaluate = sampled(samples, 8, { size: [2, 2, 2], domain: [0, 1, 0, 0, 0, 1], range: [0, 1, 0, 1, 0, 1, 0, 1] });
    expect(evaluate([0.5, 0, 0])).toEqual([0.5, 0.1, 92 / 255, 0]);
    expect(evaluate([0, 0, 1])).toEqual([0, 0, 0, 1]);
  });

  it("keeps singleton sample axes constant", () => {
    const evaluate = sampled([64, 192], 8, { size: [1, 2], domain: [0, 1, 0, 1] });
    expect(evaluate([0.25, 0.5])).toEqual([128 / 255]);
    expect(evaluate([1, 0.5])).toEqual([128 / 255]);
    expect(sampled([191], 8)(1)).toEqual([191 / 255]);
  });

  it("uses linear interpolation for Order 3 as PDF.js and Poppler do", () => {
    expect(sampled([0, 255], 8, { order: 3 })(0.25)).toEqual([0.25]);
  });

  it("does not expand absent vertices in a truncated high-dimensional grid", () => {
    const evaluate = sampled([64], 8, { size: Array(30).fill(2), domain: Array.from({ length: 30 }, () => [0, 1]).flat() });
    expect(evaluate(Array(30).fill(0.5))).toEqual([64 / 255 * 2 ** -30]);
  });

  it("restores the smooth soft-mask fade in PDF.js bug852992", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-bug852992-reduced.pdf", import.meta.url))));
    const bitmap = doc.getPage(0).renderToBitmap({ scale: 0.5 });
    const offset = (10 * bitmap.width + 168) * 4;
    // Independent PDF.js pixel at the midpoint of the fading green backdrop.
    const pixel = Array.from(bitmap.data.slice(offset, offset + 4));
    expect(pixel[0]).toBeGreaterThan(185);
    expect(pixel[0]).toBeLessThan(198);
    expect(pixel[1]).toBeGreaterThan(225);
    expect(pixel[1]).toBeLessThan(234);
    expect(pixel[2]).toBe(pixel[0]);
    expect(pixel[3]).toBe(255);
  });
});

it("interpolates a dense multidimensional grid without collecting cube vertices",()=>{
 const evaluate=sampled(Array(256).fill(255),8,{size:Array(8).fill(2),domain:Array.from({length:8},()=>[0,1]).flat()});
 const push=Array.prototype.push;
 Array.prototype.push=function<T>(this:T[],...items:T[]):number{
  if(this.length+items.length>64&&items.some(item=>item&&typeof item==="object"&&"weight" in item&&"index" in item))throw new Error("Collected sample vertices");
  return Reflect.apply(push,this,items) as number;
 };
 try{expect(evaluate(Array(8).fill(0.5))).toEqual([1]);}finally{Array.prototype.push=push;}
});

it("samples large external tables through only the requested byte ranges",async()=>{
 const {evalShadingFunctionSteps}=await import("./evaluator.js");
 const size=1_000_000_000,stream=cosStream(new Uint8Array(),{dict:cosDict({FunctionType:cosNumber(0),BitsPerSample:cosNumber(8),Size:numbers([size]),Domain:numbers([0,1]),Range:numbers([0,1])})});
 let bytesRead=0;
 const source={size,async read(position:number,length:number){bytesRead+=length;return Uint8Array.from({length},(_,i)=>(position+i)%256);}};
 const work=evalShadingFunctionSteps(PdfDocument.create().cos,stream,[12345.5/(size-1)],new WeakMap([[stream,source]]));
 let step=work.next();while(!step.done)step=work.next(await step.value.source.read(step.value.position,step.value.length));
 expect(step.value[0]).toBeCloseTo(57.5/255,12);expect(bytesRead).toBe(2);
});

it.each([1,2,4,8,12,16,24,32])("matches buffered %s-bit tuples with retained ranges and reversed multidimensional axes",async bits=>{
 const {evalShadingFunctionSteps}=await import("./evaluator.js");
 const bytes=Uint8Array.from({length:Math.ceil(12*bits/8)},(_,i)=>(i*73+19)%256);
 const stream=cosStream(bytes,{dict:cosDict({FunctionType:cosNumber(0),BitsPerSample:cosNumber(bits),Size:numbers([2,2]),Domain:numbers([10,20,0,1]),Range:numbers([0,1,0,1,0,1]),Encode:numbers([1,0,0,1])})});
 const doc=PdfDocument.create().cos;
 const source={size:bytes.length,async read(at:number,length:number){expect(length).toBeLessThanOrEqual(5);return bytes.slice(at,at+length);}};
 for(const input of [[10,0],[13.125,0.375],[20,1]]){
  const work=evalShadingFunctionSteps(doc,stream,input,new WeakMap([[stream,source]]));
  let step=work.next();while(!step.done)step=work.next(await step.value.source.read(step.value.position,step.value.length));
  expect(step.value).toEqual(evalShadingFunctionToComponents(doc,stream,input));
 }
});
