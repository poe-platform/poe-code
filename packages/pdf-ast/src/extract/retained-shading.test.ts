import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictDelete } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { renderRetainedShading } from "./retained-color.js";
import { evaluateContentStreamSteps } from "../content/evaluator.js";
import { parseContentEvents } from "../content/parser.js";

const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));
async function fixture(type = 2, color = "icc", functionType = 2) {
  const original = PdfDocument.create();
  const unused = original.cos.allocateObject(cosStream(cosDict({ Filter: cosName("Unsupported"), N: cosNumber(3) }), new Uint8Array([1, 2, 3])));
  const baseFunction = original.cos.allocateObject(cosDict({ FunctionType: cosNumber(2), N: cosNumber(1), C0: numbers([1, 0, 0]), C1: numbers([0, 1, 1]), Unused: unused }));
  const fn = functionType === 2 ? baseFunction : original.cos.allocateObject(functionType === 3
    ? cosDict({ FunctionType: cosNumber(3), Domain: numbers([0, 1]), Functions: cosArray([baseFunction, baseFunction]), Bounds: numbers([0.5]), Encode: numbers([0, 1, 1, 0]), Unused: unused })
    : cosStream(cosDict({ FunctionType: cosNumber(functionType), Domain: numbers([0, 1]), Range: numbers([0, 1, 0, 1, 0, 1]), Size: numbers([2]), BitsPerSample: cosNumber(8), Unused: unused }),
      functionType === 0 ? new Uint8Array([255, 0, 0, 0, 255, 255]) : new TextEncoder().encode("{ dup 1 exch sub 0 }")));
  const palette = original.cos.allocateObject(cosStream(new Uint8Array([255, 0, 0, 0, 127, 255])));
  const colors = {
    invalidindex: cosArray([cosName("Indexed"), unused, cosNumber(1), cosNumber(0)]),
    shorttint: cosArray([cosName("Separation"), cosName("Spot")]),
    icc: cosArray([cosName("ICCBased"), unused]),
    indexed: cosArray([cosName("Indexed"), cosName("DeviceRGB"), cosNumber(1), palette]),
    lab: cosArray([cosName("Lab"), cosDict({ Unused: unused })]),
    calgray: cosArray([cosName("CalGray"), cosDict({ Unused: unused })]),
    calrgb: cosArray([cosName("CalRGB"), cosDict({ Unused: unused })]),
    separation: cosArray([cosName("Separation"), cosName("Spot"), cosName("DeviceRGB"), fn]),
    devicen: cosArray([cosName("DeviceN"), cosArray([cosName("Spot")]), cosName("DeviceRGB"), fn]),
  };
  const dict = cosDict({ ShadingType: cosNumber(type), Coords: numbers(type === 3 ? [5, 5, 0, 5, 5, 5] : [0, 0, 10, 0]),
    Domain: numbers(type === 1 ? [0, 10, 0, 10] : [0, 1]),
    ColorSpace: colors[color as keyof typeof colors], Function: fn, Unused: unused });
  if (type >= 4) {
    dictDelete(dict, "Function");
    for (const [key, value] of Object.entries({ BitsPerCoordinate: 8, BitsPerComponent: 8, BitsPerFlag: 8, VerticesPerRow: 2 })) dict.entries.push({ key: cosName(key), value: cosNumber(value) });
    dict.entries.push({ key: cosName("Decode"), value: numbers([0, 10, 0, 10, 0, 1, 0, 1, 0, 1]) });
  }
  const points = [0, 0, 0, 85, 0, 170, 0, 255, 85, 255, 170, 255, 255, 255, 255, 170, 255, 85, 255, 0, 170, 0, 85, 0, 85, 85, 85, 170, 170, 170, 170, 85];
  const payload = type === 4 ? new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255])
    : type === 5 ? new Uint8Array([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
      : new Uint8Array([0, ...points.slice(0, type === 6 ? 24 : 32), 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const shading = original.cos.allocateObject(type >= 4 ? cosStream(dict, payload) : dict);
  const expected = Array.from(evaluateContentStreamSteps({ pageIndex: 0, width: 10, height: 10, cosDoc: original.cos,
    resourcesDict: cosDict({ Shading: cosDict({ S: shading }) }), nodes: parseContentEvents(new TextEncoder().encode("/S sh")) }))[0]!.operation;
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const whole = vi.fn(async () => { throw new Error("whole read forbidden"); });
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, property) {
    if (property === "readFile") return whole;
    const value = Reflect.get(fs, property); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const source = await PdfFileSource.open(guarded, "/input", { chunkBytes: 32, cacheBytes: 64 });
  const storage = { fs: guarded, directory: "/scratch" }; const document = await PdfRetainedDocument.open(source, storage);
  return { document, storage, shading, palette, expected, whole,
    async close() { await document.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); } };
}
const settings = { matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number], bounds: [0, 0, 10, 10] as [number, number, number, number], alpha: 1, name: "Shading_S", clipRect: undefined, blendMode: undefined };
it.each([1, 2, 3, 4, 5, 6, 7])("renders retained shading type %s without reading ICC or unrelated payloads", async type => {
  const f = await fixture(type); const decode = vi.spyOn(f.document.objects, "decodeStream");
  const image = await renderRetainedShading(f.document, f.shading, settings, f.storage);
  expect(f.expected.kind).toBe("image");
  if (f.expected.kind === "image") expect(image).toEqual(f.expected.value);
  expect(decode.mock.calls.map(call => call[0])).toEqual(type >= 4 ? [f.shading.objectNumber] : []); expect(f.whole).not.toHaveBeenCalled(); await f.close();
});
it("shares shading metadata and surface admission and preserves cancellation", async () => {
  const f = await fixture(); let admitted = 0;
  const image = await renderRetainedShading(f.document, f.shading, settings, f.storage, { onAllocation(bytes) { admitted += bytes; } });
  await expect(renderRetainedShading(f.document, f.shading, settings, f.storage, { maxWorkingBytes: admitted - 1 })).rejects.toThrow("limit");
  expect(await renderRetainedShading(f.document, f.shading, settings, f.storage, { maxWorkingBytes: admitted })).toEqual(image);
  const rejection = { cancelled: true }; const abort = new AbortController(); abort.abort(rejection);
  await expect(renderRetainedShading(f.document, f.shading, settings, f.storage, { signal: abort.signal })).rejects.toBe(rejection);
  await f.close();
});

it.each([false, true])("cleans retained mesh staging on late failure or cancellation: %s", async cancelled => {
  const f = await fixture(4); const rejection = { reason: "mesh tail" }; const abort = new AbortController(); let closed = false;
  vi.spyOn(f.document.objects, "decodeStream").mockImplementation(async function* () {
    try { yield new Uint8Array([0, 0, 0, 255, 0, 0]); if (cancelled) abort.abort(rejection); else throw rejection; yield new Uint8Array([0]); }
    finally { closed = true; }
  });
  await expect(renderRetainedShading(f.document, f.shading, settings, f.storage, { signal: abort.signal })).rejects.toBe(rejection);
  expect(closed).toBe(true); await f.close();
});

it.each(["indexed", "lab", "calgray", "calrgb", "separation", "devicen", "invalidindex", "shorttint"])("preserves %s shading colors with retained state", async color => {
  const f = await fixture(2, color);
  const image = await renderRetainedShading(f.document, f.shading, settings, f.storage);
  if (f.expected.kind !== "image") throw new Error("Expected image");
  expect(image).toEqual(f.expected.value); await f.close();
});
it("stages only addressable shading palette entries while validating the tail", async () => {
  const f = await fixture(2, "indexed"); let chunks = 0;
  vi.spyOn(f.document.objects, "decodeStream").mockImplementation(async function* () {
    yield new Uint8Array([255, 0, 0, 0, 127, 255]);
    const reused = new Uint8Array(1024);
    for (let i = 0; i < 128; i++) { chunks++; yield reused; }
  });
  const image = await renderRetainedShading(f.document, f.shading, settings, f.storage, { maxWorkingBytes: 16384, maxStagingBytes: 6 });
  if (f.expected.kind !== "image") throw new Error("Expected image");
  expect(image).toEqual(f.expected.value); expect(chunks).toBe(128); await f.close();
});

it.each([0, 3, 4])("preserves retained function type %s gradients", async functionType => {
  const f = await fixture(2, "icc", functionType);
  const image = await renderRetainedShading(f.document, f.shading, settings, f.storage);
  if (f.expected.kind !== "image") throw new Error("Expected image");
  expect(image).toEqual(f.expected.value); await f.close();
});
