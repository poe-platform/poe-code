import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { convertRetainedContentColor } from "../extract/retained-color.js";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictGet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { convertContentColorSteps, evaluateContentStreamSteps, evalShadingFunctionToComponents } from "./evaluator.js";
import { createCalibratedColorSpace } from "./calibrated-color.js";
import { parseContentStream } from "./parser.js";

it.each(["indexed", "icc", "lab", "tint", "stream-resources"])("suspends %s vector color I/O without changing buffered paint colors", async family => {
  const doc = PdfDocument.create();
  const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));
  const fn = doc.cos.allocateObject(cosDict({ FunctionType: cosNumber(2), C0: numbers([0, 0, 0]), C1: numbers([1, .5, .25]), N: cosNumber(1) }));
  const node = family === "indexed" ? cosArray([cosName("Indexed"), cosName("DeviceRGB"), cosNumber(1), doc.cos.allocateObject(cosStream(new Uint8Array([255, 0, 0, 0, 127, 255])))])
    : family === "icc" ? cosArray([cosName("ICCBased"), doc.cos.allocateObject(cosStream(cosDict({ N: cosNumber(3), Alternate: cosArray([cosName("Separation"), cosName("Spot"), cosName("DeviceRGB"), fn]) }), new Uint8Array([1])))])
    : family === "lab" ? cosArray([cosName("Lab"), doc.cos.allocateObject(cosDict({ WhitePoint: numbers([.9505, 1, 1.089]) }))])
    : cosArray([cosName("Separation"), cosName("Spot"), cosName("DeviceRGB"), fn]);
  const colorDict = cosDict({ C: doc.cos.allocateObject(node) });
  const resources = cosDict({ ColorSpace: doc.cos.allocateObject(family === "stream-resources" ? cosStream(colorDict, new Uint8Array()) : colorDict) });
  const components = family === "indexed" ? [1] : family === "lab" ? [50, 10, -20] : [.3];
  const nodes = parseContentStream(new TextEncoder().encode(`/C cs ${components.join(" ")} scn 0 0 1 1 re f`));
  const paint = [...evaluateContentStreamSteps({ pageIndex: 0, width: 10, height: 10, cosDoc: doc.cos, resourcesDict: resources, nodes })][0]!;
  if (paint.operation.kind !== "path") throw new Error("Expected path");
  const work = convertContentColorSteps(true, undefined, "C", components, resources);
  let step = work.next(), reads = 0;
  while (!step.done) {
    await Promise.resolve(); reads++;
    const request = step.value;
    if (request.kind === "resolve") step = work.next(doc.cos.resolve(request.node));
    else if (request.kind === "resource") { const map = doc.cos.resolveDict(dictGet(request.resources, request.category)); step = work.next(map ? dictGet(map, request.name) : undefined); }
    else if (request.kind === "decode") step = work.next(doc.cos.decodeStream(request.stream).subarray(request.start, request.start + request.length));
    else if (request.kind === "calibrated") step = work.next(createCalibratedColorSpace(doc.cos, request.family, request.parameters));
    else step = work.next(evalShadingFunctionToComponents(doc.cos, request.node, request.components));
  }
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", doc.save());
  const wholeRead = vi.fn(async () => { throw new Error("whole read forbidden"); });
  const guarded = new Proxy(fs, { get(target, property) {
    if (property === "readFile") return wholeRead;
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const source = await PdfFileSource.open(guarded, "/input", { chunkBytes: 32, cacheBytes: 64 });
  const storage = { fs, directory: "/scratch" };
  const retained = await PdfRetainedDocument.open(source, storage);
  const decode = vi.spyOn(retained.objects, "decodeStream");
  try {
    expect(await convertRetainedContentColor(retained, undefined, "C", components, resources, storage)).toEqual(step.value);
    expect(decode).toHaveBeenCalledTimes(family === "indexed" ? 1 : 0);
    expect(wholeRead).not.toHaveBeenCalled();
  } finally { await retained.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
  if (family === "stream-resources") expect(step.value).toEqual([.3, .15, .075]);
  const [r, g, b] = step.value;
  expect({ r, g, b }).toEqual(paint.operation.value.fillColor); expect(reads).toBeGreaterThan(1);
});
