import { annotationPageNumberSteps, extractPageAnnotationSteps } from "./annotations.js";
import { resolvePageFonts, type ResolvedPageFont } from "../fonts/resolve.js";
import { buildPostScriptJsFunction, DeviceCmykCS, MeshShading, Stream } from "../vendor/pdfjs-fonts.mjs";
import { decodeInlineImageNodeToRgba, decodeXObjectImageToRgba } from "../extract/images.js";
import {
  decodePdfString,
  dictGet,
  type PdfClipPath,
  type PdfContentNode,
  type PdfCosDict,
  type PdfCosNode,
  type PdfCosStream,
  type PdfDisplayList,
  type PdfEvaluatedImage,
  type PdfEvaluatedPath,
  type PdfLinkAnnotation,
  type PdfPathSegment,
  type PdfStoredPath,
  type PdfPlacedGlyph,
  type PdfPaintOperation,
  type PdfRgbColor,
  type PdfSoftMask,
} from "../ast.js";
import type { ParsedCosDocument } from "../cos/parser.js";
import { PdfError } from "../errors.js";
import { bytesToString } from "../bytes.js";
import { iterateCMapCharacters } from "../fonts/cmap.js";
import { parseContentEvents, type PdfContentEvent, type PdfContentRange } from "./parser.js";
import { createCalibratedColorSpace } from "./calibrated-color.js";
import {
  decodeWinAnsiByte,
  normalizeStandard14FontName,
  STANDARD_14_FONTS,
} from "../fonts/standard14.js";

type Matrix6 = [number, number, number, number, number, number];
const cmykColorSpace = new DeviceCmykCS();

export function multiplyMatrices(m1: Matrix6, m2: Matrix6): Matrix6 {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function transformPoint(m: Matrix6, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

interface GraphicsState {
  ctm: Matrix6;
  initialCtm: Matrix6;
  strokeColor: PdfRgbColor;
  fillColor: PdfRgbColor;
  strokeAlpha: number;
  fillAlpha: number;
  strokeWidth: number;
  lineCap: 0 | 1 | 2;
  lineJoin: 0 | 1 | 2;
  miterLimit: number;
  fontName: string;
  fontOverride?: ResolvedPageFont | undefined;
  fontSize: number;
  charSpace: number;
  wordSpace: number;
  horizScale: number;
  leading: number;
  rise: number;
  textRenderMode: number;
  fillColorSpaceName: string;
  strokeColorSpaceName: string;
  clipPaths?: readonly PdfClipPath[];
  clipImages?: readonly PdfEvaluatedImage[];
  softMask?: PdfSoftMask | undefined;
  clipRect?: [number, number, number, number] | undefined;
  dashArray?: readonly number[] | undefined;
  dashPhase?: number | undefined;
  fillPatternName?: string | undefined;
  blendMode?: string | undefined;
}

const postScriptFunctions = new WeakMap<PdfCosStream, {
  source: string;
  domain: number[];
  range: number[];
  evaluate: ReturnType<typeof buildPostScriptJsFunction>;
}>();

export function evalShadingFunctionToComponents(
  doc: ParsedCosDocument,
  fnNode: import("../ast.js").PdfCosNode | undefined,
  inputs: number | readonly number[]
): number[] {
  const inArr = typeof inputs === "number" ? [inputs] : inputs;
  const t = inArr[0] ?? 0;
  if (!fnNode) return [t, t, t];
  const resolved = doc.resolve(fnNode);
  if (!resolved) return [t, t, t];
  if (resolved.kind === "array") {
    const out: number[] = [];
    for (const item of resolved.items) {
      out.push(...evalShadingFunctionToComponents(doc, item, inArr));
    }
    return out;
  }
  const fnDict = resolved.kind === "stream" ? resolved.dict : resolved.kind === "dict" ? resolved : undefined;
  if (!fnDict) return [t, t, t];
  const ftNode = doc.resolve(dictGet(fnDict, "FunctionType"));
  const ft = ftNode?.kind === "number" ? ftNode.value : 2;
  const getNums = (key: string, fallback: number[]) => {
    const arr = doc.resolveArray(dictGet(fnDict, key));
    if (!arr) return fallback;
    return arr.items.map((it) => {
      const r = doc.resolve(it);
      return r?.kind === "number" ? r.value : 0;
    });
  };
  const dom = getNums("Domain", [0, 1]);
  const range = getNums("Range", []);
  const clampRange = (vals: number[]): number[] => {
    if (range.length < 2) return vals;
    return vals.map((v, idx) => {
      const rMin = range[idx * 2];
      const rMax = range[idx * 2 + 1];
      if (rMin !== undefined && rMax !== undefined) {
        return Math.max(rMin, Math.min(rMax, v));
      }
      return v;
    });
  };

  if (ft === 0 && resolved.kind === "stream") {
    const size = getNums("Size", [2]);
    const bpsNode = doc.resolve(dictGet(fnDict, "BitsPerSample"));
    const bps = bpsNode?.kind === "number" ? bpsNode.value : 8;
    const encode = getNums("Encode", []);
    const decode = getNums("Decode", range);
    const nOut = Math.max(1, Math.floor((decode.length || range.length || 6) / 2));
    const mIn = Math.max(1, size.length);
    const streamBytes = doc.decodeStream(resolved);
    // Adapted from PDF.js PDFFunction.constructSampled: interpolate the cube
    // vertices, with the first input varying fastest. Only keep nonzero
    // weights, so singleton axes and exact sample positions stay inexpensive.
    let vertices: Array<{ index: number; weight: number }> = [{ index: 0, weight: 1 }];
    let stride = 1;
    for (let i = 0; i < mIn; i++) {
      const d0 = dom[i * 2] ?? 0;
      const d1 = dom[i * 2 + 1] ?? 1;
      const sMax = Math.max(0, (size[i] ?? 2) - 1);
      const e0 = encode[i * 2] ?? 0;
      const e1 = encode[i * 2 + 1] ?? sMax;
      const x = Math.max(d0, Math.min(d1, inArr[i] ?? 0));
      const u = d1 === d0 ? 0 : (x - d0) / (d1 - d0);
      const e = Math.max(0, Math.min(sMax, e0 + u * (e1 - e0)));
      const low = Math.floor(e), fraction = e - low;
      const next: typeof vertices = [];
      for (const vertex of vertices) {
        const index = vertex.index + low * stride;
        // Missing samples contribute zero, as in the byte decoder below.
        // Discard them early rather than expanding a malformed sparse grid.
        if (index * nOut * bps < streamBytes.length * 8) next.push({ index, weight: vertex.weight * (1 - fraction) });
        if (fraction && (index + stride) * nOut * bps < streamBytes.length * 8) {
          next.push({ index: index + stride, weight: vertex.weight * fraction });
        }
      }
      vertices = next;
      stride *= size[i] ?? 2;
    }
    const maxSample = 2 ** bps - 1;
    const readSample = (index: number): number => {
      let bitOffset = index * bps, remaining = bps, value = 0;
      while (remaining > 0) {
        const bitInByte = bitOffset % 8;
        const take = Math.min(remaining, 8 - bitInByte);
        const byte = streamBytes[Math.floor(bitOffset / 8)] ?? 0;
        // Accumulate arithmetically: PDF permits unsigned 32-bit samples.
        value = value * 2 ** take + ((byte >> (8 - bitInByte - take)) & ((1 << take) - 1));
        bitOffset += take;
        remaining -= take;
      }
      return value / maxSample;
    };
    const out: number[] = [];
    for (let j = 0; j < nOut; j++) {
      let value = 0;
      for (const vertex of vertices) value += readSample(vertex.index * nOut + j) * vertex.weight;
      const dec0 = decode[j * 2] ?? 0;
      const dec1 = decode[j * 2 + 1] ?? 1;
      out.push(dec0 + value * (dec1 - dec0));
    }
    return clampRange(out);
  }

  if (ft === 4 && resolved.kind === "stream") {
    const clampedInputs = inArr.map((v, i) => {
      const d0 = dom[i * 2] ?? 0;
      const d1 = dom[i * 2 + 1] ?? 1;
      return Math.max(d0, Math.min(d1, v));
    });
    const source = bytesToString(doc.decodeStream(resolved));
    let cached = postScriptFunctions.get(resolved);
    if (!cached || cached.source !== source ||
      cached.domain.length !== dom.length || cached.domain.some((value, index) => value !== dom[index]) ||
      cached.range.length !== range.length || cached.range.some((value, index) => value !== range[index])) {
      cached = { source, domain: dom, range, evaluate: buildPostScriptJsFunction(source, dom, range) };
      postScriptFunctions.set(resolved, cached);
    }
    const output: number[] = [];
    cached.evaluate(clampedInputs, 0, output, 0);
    return output;
  }

  if (ft === 3) {
    const fnsArr = doc.resolveArray(dictGet(fnDict, "Functions"));
    const bounds = getNums("Bounds", []);
    const encode = getNums("Encode", []);
    if (fnsArr && fnsArr.items.length > 0) {
      const input = Math.max(dom[0] ?? 0, Math.min(dom[1] ?? 1, t));
      let segIdx = 0;
      while (segIdx < bounds.length && input >= bounds[segIdx]!) segIdx++;
      segIdx = Math.min(fnsArr.items.length - 1, segIdx);
      const b0 = segIdx === 0 ? (dom[0] ?? 0) : bounds[segIdx - 1]!;
      const b1 = segIdx < bounds.length ? bounds[segIdx]! : (dom[1] ?? 1);
      const e0 = encode[segIdx * 2] ?? 0;
      const e1 = encode[segIdx * 2 + 1] ?? 1;
      const localT = b1 !== b0 ? e0 + ((input - b0) / (b1 - b0)) * (e1 - e0) : e0;
      return clampRange(evalShadingFunctionToComponents(doc, fnsArr.items[segIdx], localT));
    }
  }
  const c0 = getNums("C0", [0]);
  const c1 = getNums("C1", [1]);
  const nNode = doc.resolve(dictGet(fnDict, "N"));
  const expN = nNode?.kind === "number" ? nNode.value : 1;
  const d0 = dom[0] ?? 0;
  const d1 = dom[1] ?? 1;
  // PDF.js constructInterpolated uses x ** N, not a normalized domain ratio.
  const w = Math.pow(Math.max(d0, Math.min(d1, t)), expN);
  const len = Math.max(c0.length, c1.length);
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const v0 = c0[i] ?? 0;
    const v1 = c1[i] ?? 1;
    out.push(v0 + w * (v1 - v0));
  }
  return clampRange(out);
}

function shadingComponentsToRgb(csName: string, comps: readonly number[]): [number, number, number] {
  if (csName === "DeviceGray" || csName === "G" || comps.length === 1) {
    const v = comps[0] ?? 0;
    return [v, v, v];
  }
  if (csName === "DeviceCMYK" || csName === "CMYK" || comps.length >= 4) {
    const rgb = cmykColorSpace.getRgb([comps[0] ?? 0, comps[1] ?? 0, comps[2] ?? 0, comps[3] ?? 0], 0);
    return [rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255];
  }
  return [comps[0] ?? 0, comps[1] ?? 0, comps[2] ?? 0];
}

function kClamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export type PdfColorRequest = { readonly kind: "resolve"; readonly node: PdfCosNode | undefined }
  | { readonly kind: "decode"; readonly stream: PdfCosStream; readonly start: number; readonly length: number }
  | { readonly kind: "calibrated"; readonly family: "CalGray" | "CalRGB" | "Lab"; readonly parameters: PdfCosNode | undefined }
  | { readonly kind: "function"; readonly node: PdfCosNode | undefined; readonly components: readonly number[] };
type ColorWork<T> = Generator<PdfColorRequest, T, unknown>;

function resolveColorNode(node: PdfCosNode | undefined): ColorWork<PdfCosNode | undefined>;
function resolveColorNode<K extends PdfCosNode["kind"]>(node: PdfCosNode | undefined, kind: K): ColorWork<Extract<PdfCosNode, { kind: K }> | undefined>;
function* resolveColorNode(node: PdfCosNode | undefined, kind?: PdfCosNode["kind"]): ColorWork<PdfCosNode | undefined> {
  const value = (yield { kind: "resolve", node }) as PdfCosNode | undefined;
  if (kind === "dict" && value?.kind === "stream") return value.dict;
  return kind && value?.kind !== kind ? undefined : value;
}

export type PdfMaskParameterRequest = PdfColorRequest | { readonly kind: "transfer"; readonly node: PdfCosNode };

function runColorProgram<T>(doc: ParsedCosDocument | undefined, work: Generator<PdfMaskParameterRequest, T, unknown>): T {
  try {
    let step = work.next();
    while (!step.done) {
      const request = step.value;
      if (request.kind === "resolve") step = work.next(doc?.resolve(request.node));
      else {
        if (!doc) throw new PdfError("E_CAPABILITY", "PDF resource color requires a source driver");
        if (request.kind === "decode") {
          const bytes = doc.decodeStream(request.stream);
          step = work.next(Number.isSafeInteger(request.start) && request.start >= 0 ? bytes.subarray(request.start, request.start + request.length) : new Uint8Array());
        }
        else if (request.kind === "calibrated") step = work.next(createCalibratedColorSpace(doc, request.family, request.parameters));
        else if (request.kind === "transfer") step = work.next(evaluateMaskTransfer(doc, request.node));
        else step = work.next(evalShadingFunctionToComponents(doc, request.node, request.components));
      }
    }
    return step.value;
  } finally { work.return(undefined as never); }
}

export function* colorComponentCountSteps(
  hasDocument: boolean,
  csNode: import("../ast.js").PdfCosNode | undefined,
  activeResources?: PdfCosDict,
  depth = 0
): ColorWork<number> {
  if (!csNode || depth > 4) return 3;
  const resolved = hasDocument ? (yield* resolveColorNode(csNode)) : csNode;
  if (!resolved) return 3;
  if (resolved.kind === "name") {
    const name = resolved.decoded;
    if (name === "DeviceGray" || name === "G" || name === "CalGray") return 1;
    if (name === "DeviceCMYK" || name === "CMYK") return 4;
    if (name === "DeviceRGB" || name === "RGB" || name === "CalRGB" || name === "Lab") return 3;
    if (hasDocument && activeResources) {
      const csDict = (yield* resolveColorNode(dictGet(activeResources, "ColorSpace"), "dict"));
      const mapped = csDict ? dictGet(csDict, name) : undefined;
      if (mapped) return yield* colorComponentCountSteps(hasDocument, mapped, activeResources, depth + 1);
    }
    return 3;
  }
  if (resolved.kind === "array" && resolved.items.length > 0) {
    const familyNode = hasDocument ? (yield* resolveColorNode(resolved.items[0])) : resolved.items[0];
    const family = familyNode?.kind === "name" ? familyNode.decoded : "";
    if (family === "CalGray" || family === "Indexed" || family === "Separation") return 1;
    if (family === "CalRGB" || family === "Lab") return 3;
    if (family === "DeviceN") {
      const namesArr = hasDocument && resolved.items[1] ? (yield* resolveColorNode(resolved.items[1], "array")) : undefined;
      return namesArr ? Math.max(1, namesArr.items.length) : 1;
    }
    if (family === "ICCBased" && hasDocument && resolved.items[1]) {
      const iccStream = (yield* resolveColorNode(resolved.items[1]));
      const iccDict = iccStream?.kind === "stream" ? iccStream.dict : iccStream?.kind === "dict" ? iccStream : undefined;
      const nNode = iccDict ? (yield* resolveColorNode(dictGet(iccDict, "N"))) : undefined;
      if (nNode?.kind === "number" && (nNode.value === 1 || nNode.value === 3 || nNode.value === 4)) {
        return nNode.value;
      }
    }
  }
  return 3;
}

export function* convertContentColorSteps(
  hasDocument: boolean,
  csNode: import("../ast.js").PdfCosNode | undefined,
  csNameFallback: string,
  comps: readonly number[],
  activeResources?: PdfCosDict,
  depth = 0
): ColorWork<[number, number, number]> {
  if (depth > 5) return shadingComponentsToRgb(csNameFallback, comps);
  let resolved = csNode && hasDocument ? (yield* resolveColorNode(csNode)) : csNode;
  if ((!resolved || resolved.kind === "name") && hasDocument && activeResources) {
    const lookupName = resolved?.kind === "name" ? resolved.decoded : csNameFallback;
    if (
      lookupName &&
      lookupName !== "DeviceRGB" &&
      lookupName !== "RGB" &&
      lookupName !== "DeviceGray" &&
      lookupName !== "G" &&
      lookupName !== "DeviceCMYK" &&
      lookupName !== "CMYK"
    ) {
      const csDict = (yield* resolveColorNode(dictGet(activeResources, "ColorSpace"), "dict"));
      const mapped = csDict ? dictGet(csDict, lookupName) : undefined;
      if (mapped) {
        resolved = (yield* resolveColorNode(mapped));
      }
    }
  }
  if (!resolved || resolved.kind === "name") {
    const name = resolved?.kind === "name" ? resolved.decoded : csNameFallback;
    return shadingComponentsToRgb(name, comps);
  }
  if (resolved.kind === "array" && resolved.items.length > 0 && hasDocument) {
    const familyNode = (yield* resolveColorNode(resolved.items[0]));
    const family = familyNode?.kind === "name" ? familyNode.decoded : "";
    if (family === "CalGray" || family === "CalRGB" || family === "Lab") {
      const colorSpace = ((yield { kind: "calibrated", family, parameters: resolved.items[1] }) as ReturnType<typeof createCalibratedColorSpace>);
      const rgb = colorSpace.getRgb(comps, 0);
      return [rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255];
    }
    if (family === "ICCBased" && resolved.items[1]) {
      const iccNode = (yield* resolveColorNode(resolved.items[1]));
      const iccDict = iccNode?.kind === "stream" ? iccNode.dict : iccNode?.kind === "dict" ? iccNode : undefined;
      const altNode = iccDict ? dictGet(iccDict, "Alternate") : undefined;
      if (altNode) {
        return yield* convertContentColorSteps(hasDocument, altNode, "DeviceRGB", comps, activeResources, depth + 1);
      }
      const nNode = iccDict ? (yield* resolveColorNode(dictGet(iccDict, "N"))) : undefined;
      const n = nNode?.kind === "number" ? nNode.value : comps.length;
      if (n === 1) return shadingComponentsToRgb("DeviceGray", comps);
      if (n === 4) return shadingComponentsToRgb("DeviceCMYK", comps);
      return shadingComponentsToRgb("DeviceRGB", comps);
    }
    if ((family === "Separation" || family === "DeviceN") && resolved.items.length >= 4) {
      const altSpaceNode = resolved.items[2];
      const tintFnNode = resolved.items[3];
      const altComps = ((yield { kind: "function", node: tintFnNode, components: comps }) as number[]);
      return yield* convertContentColorSteps(hasDocument, altSpaceNode, "DeviceRGB", altComps, activeResources, depth + 1);
    }
    if (family === "Indexed" && resolved.items.length >= 4) {
      const baseSpaceNode = resolved.items[1];
      const hivalNode = (yield* resolveColorNode(resolved.items[2]));
      const hival = hivalNode?.kind === "number" ? Math.max(0, Math.floor(hivalNode.value)) : 255;
      const lookupNode = (yield* resolveColorNode(resolved.items[3]));
      if (lookupNode?.kind !== "stream" && lookupNode?.kind !== "string") return shadingComponentsToRgb(csNameFallback, comps);
      const nBase = yield* colorComponentCountSteps(hasDocument, baseSpaceNode, activeResources, depth + 1);
      const idx = Math.max(0, Math.min(hival, Math.round(comps[0] ?? 0)));
      const offset = idx * nBase;
      let lookupBytes: Uint8Array | undefined;
      if (lookupNode?.kind === "stream") {
        lookupBytes = ((yield { kind: "decode", stream: lookupNode, start: offset, length: nBase }) as Uint8Array);
      } else if (lookupNode?.kind === "string") {
        lookupBytes = Number.isSafeInteger(offset) && offset >= 0 ? lookupNode.bytes.subarray(offset, offset + nBase) : new Uint8Array();
      }
      if (lookupBytes) {
        const baseResolved = baseSpaceNode ? (yield* resolveColorNode(baseSpaceNode)) : undefined;
        const baseFamilyNode =
          baseResolved?.kind === "array" && baseResolved.items[0] ? (yield* resolveColorNode(baseResolved.items[0])) : baseResolved;
        const baseFamily = baseFamilyNode?.kind === "name" ? baseFamilyNode.decoded : "";
        const baseComps: number[] = [];
        for (let c = 0; c < nBase; c++) {
          const byteVal = lookupBytes[c] ?? 0;
          if (baseFamily === "Lab") {
            if (c === 0) {
              baseComps.push((byteVal / 255) * 100);
            } else {
              const labDict =
                baseResolved?.kind === "array" && baseResolved.items[1]
                  ? (yield* resolveColorNode(baseResolved.items[1], "dict"))
                  : undefined;
              const rArr = labDict ? (yield* resolveColorNode(dictGet(labDict, "Range"), "array")) : undefined;
              const rMinNode = rArr && rArr.items[(c - 1) * 2] ? (yield* resolveColorNode(rArr.items[(c - 1) * 2])) : undefined;
              const rMaxNode =
                rArr && rArr.items[(c - 1) * 2 + 1] ? (yield* resolveColorNode(rArr.items[(c - 1) * 2 + 1])) : undefined;
              const rMin = rMinNode?.kind === "number" ? rMinNode.value : -100;
              const rMax = rMaxNode?.kind === "number" ? rMaxNode.value : 100;
              baseComps.push(rMin + (byteVal / 255) * (rMax - rMin));
            }
          } else {
            baseComps.push(byteVal / 255);
          }
        }
        return yield* convertContentColorSteps(hasDocument, baseSpaceNode, "DeviceRGB", baseComps, activeResources, depth + 1);
      }
    }
  }
  return shadingComponentsToRgb(csNameFallback, comps);
}

function renderMeshShadingToImage(
  doc: ParsedCosDocument,
  shDict: PdfCosDict,
  shStream: import("../ast.js").PdfCosStream,
  shType: number,
  effectiveCtm: Matrix6,
  targetBox: [number, number, number, number],
  fillAlpha: number,
  name: string,
  clipRect?: [number, number, number, number],
  blendMode?: string,
  onAllocation?: (bytes: number) => void
): PdfEvaluatedImage | undefined {
  const bytes = doc.decodeStream(shStream);
  if (bytes.length === 0) return undefined;
  const parameters = meshShadingParameters(doc, shDict);
  if (!parameters) return undefined;
  const mesh = new MeshShading(shType, new Stream(bytes), {...parameters.context, onAllocation}, parameters.verticesPerRow);
  const [, , positions, colors, vertexCount] = mesh.getIR();
  if (vertexCount === 0) return undefined;
  const raster = createMeshRaster(effectiveCtm, targetBox, fillAlpha, name, clipRect, blendMode, onAllocation);
  for (let vertex = 0; vertex < vertexCount; vertex += 3) raster.paint(positions, colors, vertex);
  return raster.image;
}

export function meshShadingParameters(doc: ParsedCosDocument, shDict: PdfCosDict) {
  const bpcCoordNode = doc.resolve(dictGet(shDict, "BitsPerCoordinate"));
  const bpcCompNode = doc.resolve(dictGet(shDict, "BitsPerComponent"));
  const bpcFlagNode = doc.resolve(dictGet(shDict, "BitsPerFlag"));
  const vPerRowNode = doc.resolve(dictGet(shDict, "VerticesPerRow"));
  const bpcCoord = bpcCoordNode?.kind === "number" ? bpcCoordNode.value : 16;
  const bpcComp = bpcCompNode?.kind === "number" ? bpcCompNode.value : 8;
  const bpcFlag = bpcFlagNode?.kind === "number" ? bpcFlagNode.value : 8;
  const vPerRow = vPerRowNode?.kind === "number" ? Math.max(2, Math.floor(vPerRowNode.value)) : 2;
  const decodeArrNode = doc.resolveArray(dictGet(shDict, "Decode"));
  if (!decodeArrNode || decodeArrNode.items.length < 6) return undefined;
  const decodeNums = decodeArrNode.items.map(it => {
    const r = doc.resolve(it);
    return r?.kind === "number" ? r.value : 0;
  });
  const fnNode = dictGet(shDict, "Function");
  const csNode = doc.resolve(dictGet(shDict, "ColorSpace"));
  const csName = csNode?.kind === "name" ? csNode.decoded : "DeviceRGB";
  const numComps = fnNode ? 1 : runColorProgram(doc, colorComponentCountSteps(Boolean(doc), csNode));
  return { verticesPerRow: vPerRow, context: {
    bitsPerCoordinate: bpcCoord, bitsPerComponent: bpcComp, bitsPerFlag: bpcFlag,
    decode: decodeNums, numComps, colorFn: null,
    colorSpace: {
      numComps,
      getRgb(components: Float32Array) {
        const params = Array.from(components);
        const values = fnNode ? evalShadingFunctionToComponents(doc, fnNode, params) : params;
        return new Uint8Array(runColorProgram(doc, convertContentColorSteps(Boolean(doc), csNode, csName, values))
          .map(value => Math.round(Math.max(0, Math.min(1, value)) * 255)));
      },
    },
  } };

}

/** Fixed shading surface; both retained and buffered meshes share triangle rasterization. */
export function createMeshRaster(effectiveCtm: Matrix6, targetBox: [number, number, number, number], fillAlpha: number,
  name: string, clipRect?: [number, number, number, number], blendMode?: string, onAllocation?: (bytes: number) => void) {
  const [bx0, by0, bx1, by1] = targetBox;
  const boxW = Math.max(1, bx1 - bx0);
  const boxH = Math.max(1, by1 - by0);
  const imgW = Math.max(1, Math.min(256, Math.ceil(boxW)));
  const imgH = Math.max(1, Math.min(256, Math.ceil(boxH)));
  onAllocation?.(imgW * imgH * 4);
  const rgba = new Uint8Array(imgW * imgH * 4);
  const a8 = Math.round(fillAlpha * 255);

  const toImgCoords = (vx: number, vy: number): [number, number] => {
    const [px, py] = transformPoint(effectiveCtm, vx, vy);
    return [((px - bx0) / boxW) * imgW, ((by1 - py) / boxH) * imgH];
  };

  function paint(positions: Float32Array, colors: Uint8Array, vertex = 0) {
    const [x0, y0] = toImgCoords(positions[vertex * 2]!, positions[vertex * 2 + 1]!);
    const [x1, y1] = toImgCoords(positions[vertex * 2 + 2]!, positions[vertex * 2 + 3]!);
    const [x2, y2] = toImgCoords(positions[vertex * 2 + 4]!, positions[vertex * 2 + 5]!);
    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(denom) < 1e-6) return;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(imgW - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(imgH - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let iy = minY; iy <= maxY; iy++) {
      const py = iy + 0.5;
      for (let ix = minX; ix <= maxX; ix++) {
        const px = ix + 0.5;
        const w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / denom;
        const w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / denom;
        const w2 = 1 - w0 - w1;
        if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
          const pIdx = (iy * imgW + ix) * 4;
          for (let channel = 0; channel < 3; channel++) {
            rgba[pIdx + channel] = Math.round(
              w0 * colors[vertex * 4 + channel]! +
              w1 * colors[vertex * 4 + 4 + channel]! +
              w2 * colors[vertex * 4 + 8 + channel]!
            );
          }
          rgba[pIdx + 3] = a8;
        }
      }
    }
  }

  const image: PdfEvaluatedImage = {
    name,
    matrix: [boxW, 0, 0, boxH, bx0, by0],
    width: imgW,
    height: imgH,
    colorSpace: "rgb",
    bitsPerComponent: 8,
    decodedRgba: rgba,
    ...(blendMode && blendMode !== "Normal" ? { blendMode } : {}),
    ...(clipRect ? { clipRect: [...clipRect] as [number, number, number, number] } : {}),
  };
  return {image, paint};
}

export function renderShadingDictToImage(
  doc: ParsedCosDocument,
  shDict: PdfCosDict,
  shadingCtm: Matrix6,
  targetBox: [number, number, number, number],
  fillAlpha: number,
  name: string,
  clipRect?: [number, number, number, number],
  shStream?: import("../ast.js").PdfCosStream,
  blendMode?: string,
  onAllocation?: (bytes: number) => void
): PdfEvaluatedImage | undefined {
  const stTypeNode = doc.resolve(dictGet(shDict, "ShadingType"));
  const shType = stTypeNode?.kind === "number" ? stTypeNode.value : 0;
  if ((shType === 4 || shType === 5 || shType === 6 || shType === 7) && shStream) {
    return renderMeshShadingToImage(doc, shDict, shStream, shType, shadingCtm, targetBox, fillAlpha, name, clipRect, blendMode, onAllocation);
  }
  const fnNode = dictGet(shDict, "Function");
  if ((shType !== 1 && shType !== 2 && shType !== 3) || !fnNode) return undefined;

  const coordsArr = doc.resolveArray(dictGet(shDict, "Coords"));
  const coords = coordsArr
    ? coordsArr.items.map((it) => {
        const r = doc.resolve(it);
        return r?.kind === "number" ? r.value : 0;
      })
    : [];
  const domArr = doc.resolveArray(dictGet(shDict, "Domain"));
  const shDomain = domArr
    ? domArr.items.map((it) => {
        const r = doc.resolve(it);
        return r?.kind === "number" ? r.value : 0;
      })
    : shType === 1
      ? [0, 1, 0, 1]
      : [0, 1];
  const bboxArr = doc.resolveArray(dictGet(shDict, "BBox"));
  const shBBox =
    bboxArr && bboxArr.items.length >= 4
      ? bboxArr.items.slice(0, 4).map((it) => {
          const r = doc.resolve(it);
          return r?.kind === "number" ? r.value : 0;
        })
      : undefined;
  const bgArr = doc.resolveArray(dictGet(shDict, "Background"));
  const bgComps = bgArr
    ? bgArr.items.map((it) => {
        const r = doc.resolve(it);
        return r?.kind === "number" ? r.value : 0;
      })
    : undefined;

  let effectiveCtm: Matrix6 = [...shadingCtm] as Matrix6;
  if (shType === 1) {
    const shMatArr = doc.resolveArray(dictGet(shDict, "Matrix"));
    if (shMatArr && shMatArr.items.length >= 6) {
      const mn = (idx: number, fb = 0) => {
        const r = doc.resolve(shMatArr.items[idx]);
        return r?.kind === "number" ? r.value : fb;
      };
      const shMat: Matrix6 = [mn(0, 1), mn(1, 0), mn(2, 0), mn(3, 1), mn(4, 0), mn(5, 0)];
      effectiveCtm = multiplyMatrices(shMat, effectiveCtm);
    }
  }

  const extArr = doc.resolveArray(dictGet(shDict, "Extend"));
  const ext0Node = extArr && extArr.items[0] ? doc.resolve(extArr.items[0]) : undefined;
  const ext1Node = extArr && extArr.items[1] ? doc.resolve(extArr.items[1]) : undefined;
  const extendStart = ext0Node?.kind === "boolean" ? ext0Node.value : false;
  const extendEnd = ext1Node?.kind === "boolean" ? ext1Node.value : false;
  const csNode = doc.resolve(dictGet(shDict, "ColorSpace"));
  const csName = csNode?.kind === "name" ? csNode.decoded : "DeviceRGB";

  const [bx0, by0, bx1, by1] = targetBox;
  const boxW = Math.max(1, bx1 - bx0);
  const boxH = Math.max(1, by1 - by0);
  const imgW = Math.max(1, Math.min(256, Math.ceil(boxW)));
  const imgH = Math.max(1, Math.min(256, Math.ceil(boxH)));
  onAllocation?.(imgW * imgH * 4);
  const rgba = new Uint8Array(imgW * imgH * 4);
  if (bgComps && bgComps.length > 0) {
    const [bgr, bgg, bgb] = runColorProgram(doc, convertContentColorSteps(Boolean(doc), csNode, csName, bgComps));
    const br8 = Math.round(Math.max(0, Math.min(1, bgr)) * 255);
    const bg8 = Math.round(Math.max(0, Math.min(1, bgg)) * 255);
    const bb8 = Math.round(Math.max(0, Math.min(1, bgb)) * 255);
    const ba8 = Math.round(fillAlpha * 255);
    for (let p = 0; p < imgW * imgH * 4; p += 4) {
      rgba[p] = br8;
      rgba[p + 1] = bg8;
      rgba[p + 2] = bb8;
      rgba[p + 3] = ba8;
    }
  }

  const [a, b, c, d, e, f] = effectiveCtm;
  const det = a * d - b * c;
  if (Math.abs(det) <= 1e-8) return undefined;
  const [sa, sb, sc, sd, se, sf] = shadingCtm;
  const shadingDet = sa * sd - sb * sc;

  const t0Dom = shDomain[0] ?? 0;
  const t1Dom = shDomain[1] ?? 1;

  for (let iy = 0; iy < imgH; iy++) {
    const yPdf = by1 - ((iy + 0.5) / imgH) * boxH;
    const dyPdf = yPdf - f;
    for (let ix = 0; ix < imgW; ix++) {
      const xPdf = bx0 + ((ix + 0.5) / imgW) * boxW;
      const dxPdf = xPdf - e;
      const xs = (d * dxPdf - c * dyPdf) / det;
      const ys = (-b * dxPdf + a * dyPdf) / det;

      if (shBBox) {
        // PDF.js keeps BBox in shading space, before a Type 1 function's
        // Matrix maps its domain into that space.
        const bboxX = (sd * (xPdf - se) - sc * (yPdf - sf)) / shadingDet;
        const bboxY = (-sb * (xPdf - se) + sa * (yPdf - sf)) / shadingDet;
        if (bboxX < shBBox[0]! || bboxX > shBBox[2]! || bboxY < shBBox[1]! || bboxY > shBBox[3]!) continue;
      }

      let comps: number[] | undefined;
      if (shType === 1) {
        const xmin = shDomain[0] ?? 0;
        const xmax = shDomain[1] ?? 1;
        const ymin = shDomain[2] ?? 0;
        const ymax = shDomain[3] ?? 1;
        if (xs >= xmin && xs <= xmax && ys >= ymin && ys <= ymax) {
          comps = evalShadingFunctionToComponents(doc, fnNode, [xs, ys]);
        }
      } else {
        let rawT: number | undefined;
        if (shType === 2 && coords.length >= 4) {
          const [x0, y0, x1, y1] = coords as [number, number, number, number];
          const dx = x1 - x0;
          const dy = y1 - y0;
          const lenSq = dx * dx + dy * dy;
          if (lenSq > 1e-8) {
            const u = ((xs - x0) * dx + (ys - y0) * dy) / lenSq;
            if (u >= 0 && u <= 1) rawT = u;
            else if (u < 0 && extendStart) rawT = 0;
            else if (u > 1 && extendEnd) rawT = 1;
          }
        } else if (shType === 3 && coords.length >= 6) {
          const [x0, y0, r0, x1, y1, r1] = coords as [number, number, number, number, number, number];
          if (Math.abs(x1 - x0) < 1e-6 && Math.abs(y1 - y0) < 1e-6) {
            const dist = Math.hypot(xs - x0, ys - y0);
            const dr = r1 - r0;
            if (Math.abs(dr) > 1e-8) {
              const u = (dist - r0) / dr;
              if (u >= 0 && u <= 1) rawT = u;
              else if (u < 0 && extendStart) rawT = 0;
              else if (u > 1 && extendEnd) rawT = 1;
            }
          } else {
            const dx = x1 - x0, dy = y1 - y0, dr = r1 - r0;
            const qa = dx * dx + dy * dy - dr * dr;
            const qb = -2 * ((xs - x0) * dx + (ys - y0) * dy + r0 * dr);
            const qc = (xs - x0) * (xs - x0) + (ys - y0) * (ys - y0) - r0 * r0;
            let bestS: number | undefined;
            if (Math.abs(qa) < 1e-8) {
              if (Math.abs(qb) > 1e-8) bestS = -qc / qb;
            } else {
              const disc = qb * qb - 4 * qa * qc;
              if (disc >= 0) {
                const sqrtD = Math.sqrt(disc);
                const s1 = (-qb + sqrtD) / (2 * qa);
                const s2 = (-qb - sqrtD) / (2 * qa);
                const cand = [s1, s2].filter((s) => r0 + s * dr >= 0);
                bestS = cand.find((s) => s >= 0 && s <= 1) ?? cand[0];
              }
            }
            if (bestS !== undefined) {
              if (bestS >= 0 && bestS <= 1) rawT = bestS;
              else if (bestS < 0 && extendStart) rawT = 0;
              else if (bestS > 1 && extendEnd) rawT = 1;
            }
          }
        }
        if (rawT !== undefined) {
          const tParam = t0Dom + rawT * (t1Dom - t0Dom);
          comps = evalShadingFunctionToComponents(doc, fnNode, [tParam]);
        }
      }

      if (comps !== undefined) {
        const [r, g, bl] = runColorProgram(doc, convertContentColorSteps(Boolean(doc), csNode, csName, comps));
        const pIdx = (iy * imgW + ix) * 4;
        rgba[pIdx] = Math.round(Math.max(0, Math.min(1, r)) * 255);
        rgba[pIdx + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
        rgba[pIdx + 2] = Math.round(Math.max(0, Math.min(1, bl)) * 255);
        rgba[pIdx + 3] = Math.round(fillAlpha * 255);
      }
    }
  }

  return {
    name,
    matrix: [boxW, 0, 0, boxH, bx0, by0],
    width: imgW,
    height: imgH,
    colorSpace: "rgb",
    bitsPerComponent: 8,
    decodedRgba: rgba,
    ...(blendMode && blendMode !== "Normal" ? { blendMode } : {}),
    ...(clipRect ? { clipRect: [...clipRect] as [number, number, number, number] } : {}),
  };
}

export function isOptionalContentVisible(doc: ParsedCosDocument | undefined, ocNode: PdfCosNode | undefined): boolean {
  if (!doc || !ocNode) return true;
  const work = optionalContentVisibilitySteps(ocNode);
  let step = work.next();
  while (!step.done) {
    if (step.value.kind !== "resolve" && step.value.kind !== "catalog") throw new TypeError("Expected a PDF object request");
    step = work.next({ kind: "resolved", node: doc.resolve(step.value.kind === "catalog" ? doc.rootRef : step.value.node) });
  }
  return step.value;
}

function* resolveEvaluationNode(node: PdfCosNode | undefined): EvaluationWork<PdfCosNode | undefined> {
  if (!node) return undefined;
  const result = yield { kind: "resolve", node };
  if (!result || !("kind" in result) || result.kind !== "resolved") throw new TypeError("Expected a resolved PDF object");
  return result.node;
}
function* resolveEvaluationDict(node: PdfCosNode | undefined): EvaluationWork<PdfCosDict | undefined> {
  const resolved = yield* resolveEvaluationNode(node);
  return resolved?.kind === "dict" ? resolved : resolved?.kind === "stream" ? resolved.dict : undefined;
}
function* resolveEvaluationArray(node: PdfCosNode | undefined): EvaluationWork<import("../ast.js").PdfCosArray | undefined> {
  const resolved = yield* resolveEvaluationNode(node);
  return resolved?.kind === "array" ? resolved : undefined;
}

export function* optionalContentVisibilitySteps(ocNode: PdfCosNode | undefined): EvaluationWork<boolean> {
  if (!ocNode) return true;
  const resolved = yield* resolveEvaluationNode(ocNode);
  const ocDict = resolved?.kind === "dict" ? resolved : resolved?.kind === "stream" ? resolved.dict : undefined;
  if (!ocDict) return true;

  const root = yield { kind: "catalog" };
  const catalog = root && "kind" in root && root.kind === "resolved" && root.node?.kind === "dict" ? root.node : undefined;
  const ocProps = catalog ? yield* resolveEvaluationDict(dictGet(catalog, "OCProperties")) : undefined;
  const dDict = ocProps ? yield* resolveEvaluationDict(dictGet(ocProps, "D")) : undefined;
  const baseStateNode = dDict ? yield* resolveEvaluationNode(dictGet(dDict, "BaseState")) : undefined;
  const baseStateOff = baseStateNode?.kind === "name" && baseStateNode.decoded === "OFF";

  function* collectRefSet(arrNode: PdfCosNode | undefined): EvaluationWork<Set<number>> {
    const set = new Set<number>();
    const arr = yield* resolveEvaluationArray(arrNode);
    if (!arr) return set;
    for (const item of arr.items) {
      if (item.kind === "ref") set.add(item.objectNumber);
    }
    return set;
  };
  const onSet = dDict ? yield* collectRefSet(dictGet(dDict, "ON")) : new Set<number>();
  const offSet = dDict ? yield* collectRefSet(dictGet(dDict, "OFF")) : new Set<number>();

  function* isSingleOcgOn(node: PdfCosNode | undefined): EvaluationWork<boolean> {
    if (!node) return true;
    const refObjNum = node.kind === "ref" ? node.objectNumber : undefined;
    const dict = yield* resolveEvaluationDict(node);
    if (dict) {
      const usageDict = yield* resolveEvaluationDict(dictGet(dict, "Usage"));
      const viewDict = usageDict ? yield* resolveEvaluationDict(dictGet(usageDict, "View")) : undefined;
      const viewState = viewDict ? yield* resolveEvaluationNode(dictGet(viewDict, "ViewState")) : undefined;
      if (viewState?.kind === "name") {
        if (viewState.decoded === "OFF") return false;
        if (viewState.decoded === "ON") return true;
      }
    }
    if (refObjNum !== undefined) {
      if (offSet.has(refObjNum)) return false;
      if (onSet.has(refObjNum)) return true;
    }
    return !baseStateOff;
  };

  const typeNode = yield* resolveEvaluationNode(dictGet(ocDict, "Type"));
  const typeName = typeNode?.kind === "name" ? typeNode.decoded : "";
  if (typeName === "OCMD") {
    const pNode = yield* resolveEvaluationNode(dictGet(ocDict, "P"));
    const policy = pNode?.kind === "name" ? pNode.decoded : "AnyOn";
    const ocgsEntry = dictGet(ocDict, "OCGs");
    const ocgsArr = yield* resolveEvaluationArray(ocgsEntry);
    const memberNodes = ocgsArr ? ocgsArr.items : ocgsEntry ? [ocgsEntry] : [];
    if (memberNodes.length === 0) return true;
    let anyOn = false, anyOff = false;
    for (const member of memberNodes) {
      const on = yield* isSingleOcgOn(member);
      anyOn ||= on; anyOff ||= !on;
    }
    if (policy === "AllOn") return !anyOff;
    if (policy === "AnyOff") return anyOff;
    if (policy === "AllOff") return !anyOn;
    return anyOn;
  }
  return yield* isSingleOcgOn(ocNode);
}

export function evaluateMaskTransfer(doc: ParsedCosDocument, transfer: PdfCosNode): Uint8Array {
  return Uint8Array.from({ length: 256 }, (_, i) => Math.floor(kClamp(Math.fround(evalShadingFunctionToComponents(doc, transfer, Math.fround(i / 255))[0] ?? 0)) * 255));
}

export function* resolveMaskParameterSteps(mask: PdfCosDict, form: PdfCosStream, activeResources: PdfCosDict | undefined): Generator<PdfMaskParameterRequest, Pick<PdfSoftMask, "backdrop" | "transferMap">, unknown> {
  const group = yield* resolveColorNode(dictGet(form.dict, "Group"), "dict");
  const colorSpace = group ? dictGet(group, "CS") : undefined;
  const bc = yield* resolveColorNode(dictGet(mask, "BC"), "array");
  let components: number[] | undefined;
  if (bc) {
    components = [];
    for (const item of bc.items) {
      const value = yield* resolveColorNode(item);
      components.push(value?.kind === "number" ? value.value : 0);
    }
  }
  const [r, g, b] = components ? yield* convertContentColorSteps(true, colorSpace, "DeviceRGB", components, activeResources) : [0, 0, 0];
  const transfer = yield* resolveColorNode(dictGet(mask, "TR"));
  const transferMap = transfer?.kind === "dict" || transfer?.kind === "stream"
    ? (yield { kind: "transfer", node: transfer }) as Uint8Array
    : undefined;
  return { backdrop: { r, g, b }, transferMap };
}

export interface PdfContentEvaluationOptions {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly origin?: readonly [number, number] | undefined;
  readonly rotation?: 0 | 90 | 180 | 270 | undefined;
  readonly nodes: Iterable<PdfContentEvent>;
  readonly cosDoc?: ParsedCosDocument | undefined;
  readonly resourcesDict?: PdfCosDict | undefined;
  readonly annotations?: readonly PdfLinkAnnotation[] | undefined;
  /** Intrinsic mesh geometry and shading surfaces, admitted before allocation.
   * Resource decoding and color/function state have separate owners. */
  readonly onShadingAllocation?: ((bytes: number) => void) | undefined;
}
export interface PdfEvaluationOperation {
  readonly kind: "paint";
  readonly operation: PdfPaintOperation;
  /** The operation belongs to a captured group rather than the page paint list. */
  readonly captured: boolean;
  /** Mask paint is excluded from the page's text/image extraction views. */
  readonly insideSoftMask: boolean;
}

/** Identity of one nested content traversal. Drivers own and close its cursor. */
export interface PdfEvaluationContentSource { readonly stream: PdfCosStream }

export interface PdfEvaluationShadingRequest {
  readonly kind: "shading";
  readonly dict: PdfCosDict;
  readonly matrix: Matrix6;
  readonly bounds: [number, number, number, number];
  readonly alpha: number;
  readonly name: string;
  readonly clipRect: [number, number, number, number] | undefined;
  readonly stream: PdfCosStream | undefined;
  readonly blendMode: string | undefined;
}

/** Shared affine path transformation, including reflected rectangle winding. */
export function transformPathSegment(seg: PdfPathSegment, matrix: Matrix6): PdfPathSegment[] {
  const hasRotOrShear = Math.abs(matrix[1]) > 1e-6 || Math.abs(matrix[2]) > 1e-6;
  const transformedSegments: PdfPathSegment[] = [];

  if (seg.kind === "move") {
    const [x, y] = transformPoint(matrix, seg.x, seg.y);
    transformedSegments.push({ kind: "move", x, y });
  } else if (seg.kind === "line") {
    const [x, y] = transformPoint(matrix, seg.x, seg.y);
    transformedSegments.push({ kind: "line", x, y });
  } else if (seg.kind === "cubic") {
    const [x1, y1] = transformPoint(matrix, seg.x1, seg.y1);
    const [x2, y2] = transformPoint(matrix, seg.x2, seg.y2);
    const [x, y] = transformPoint(matrix, seg.x, seg.y);
    transformedSegments.push({ kind: "cubic", x1, y1, x2, y2, x, y });
  } else if (seg.kind === "rect") {
    if (hasRotOrShear || seg.width * matrix[0] < 0 || seg.height * matrix[3] < 0) {
      const [p0x, p0y] = transformPoint(matrix, seg.x, seg.y);
      const [p1x, p1y] = transformPoint(matrix, seg.x + seg.width, seg.y);
      const [p2x, p2y] = transformPoint(matrix, seg.x + seg.width, seg.y + seg.height);
      const [p3x, p3y] = transformPoint(matrix, seg.x, seg.y + seg.height);
      transformedSegments.push(
        { kind: "move", x: p0x, y: p0y },
        { kind: "line", x: p1x, y: p1y },
        { kind: "line", x: p2x, y: p2y },
        { kind: "line", x: p3x, y: p3y },
        { kind: "close" }
      );
    } else {
      const [x0, y0] = transformPoint(matrix, seg.x, seg.y);
      const [x1, y1] = transformPoint(matrix, seg.x + seg.width, seg.y + seg.height);
      transformedSegments.push({
        kind: "rect",
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
      });
    }
  } else {
    transformedSegments.push(seg);
  }

  return transformedSegments;
}

export type PdfEvaluationRequest = PdfEvaluationShadingRequest | PdfEvaluationOperation | { readonly kind: "node"; readonly source?: PdfEvaluationContentSource }
  | { readonly kind: "transform-path"; readonly path: PdfStoredPath; readonly matrix: Matrix6; readonly close: boolean }
  | { readonly kind: "font"; readonly name: string; readonly resources: PdfCosDict | undefined }
  | { readonly kind: "resolve"; readonly node: PdfCosNode }
  | { readonly kind: "catalog" }
  | { readonly kind: "close-content"; readonly source: PdfEvaluationContentSource }
  | { readonly kind: "mask-parameters"; readonly mask: PdfCosDict; readonly form: PdfCosStream; readonly resources: PdfCosDict | undefined }
  | { readonly kind: "color"; readonly name: string; readonly components: readonly number[]; readonly resources: PdfCosDict | undefined }
  | { readonly kind: "inline-image"; readonly dict: PdfCosDict; readonly data: Uint8Array | PdfContentRange; readonly resources: PdfCosDict | undefined; readonly fillColor: Parameters<typeof decodeInlineImageNodeToRgba>[4] }
  | { readonly kind: "image"; readonly stream: PdfCosStream; readonly resources: PdfCosDict | undefined; readonly fillColor: Parameters<typeof decodeXObjectImageToRgba>[3] };
export type PdfEvaluationResult = PdfStoredPath | PdfContentEvent | ResolvedPageFont
  | { readonly kind: "shading"; readonly image: PdfEvaluatedImage | undefined }
  | { readonly kind: "color"; readonly value: readonly [number, number, number] }
  | { readonly kind: "resolved"; readonly node: PdfCosNode | undefined }
  | { readonly kind: "mask-parameters"; readonly value: Pick<PdfSoftMask, "backdrop" | "transferMap"> }
  | { readonly kind: "decoded-image"; readonly image: ReturnType<typeof decodeXObjectImageToRgba> | (Omit<ReturnType<typeof decodeXObjectImageToRgba>, "rgba"> & {readonly storedRgba: import("../ast.js").PdfStoredPixels}) } | undefined;
type EvaluationWork<T = void> = Generator<PdfEvaluationRequest, T, PdfEvaluationResult>;
type FontScope = ReadonlyArray<PdfCosDict | undefined>;

function closeEvaluationIterators(iterators: ReadonlyArray<Pick<Iterator<unknown>, "return"> | undefined>, failed: boolean): void {
  let cleanupFailure: { error: unknown } | undefined;
  for (const iterator of iterators) {
    try { iterator?.return?.(); } catch (error) { cleanupFailure ??= { error }; }
  }
  if (!failed && cleanupFailure) throw cleanupFailure.error;
}

/** Pull evaluated operations while the driver supplies content and resources.
 * Composite captures and path geometry remain in memory; the driver owns
 * resource admission and cursor cleanup, including on early return or failure. */
export function* evaluateContentSteps(params: Omit<PdfContentEvaluationOptions, "nodes">): EvaluationWork {
  const fonts: FontScope = [params.resourcesDict];
  function* selectedFont(scopes: FontScope, name: string): EvaluationWork<ResolvedPageFont | undefined> {
    for (const resources of scopes) {
      const font = yield { kind: "font", resources, name };
      if (font && "kind" in font) throw new TypeError("Expected a resolved PDF font");
      if (font) return font;
    }
    return undefined;
  }
  let capturedOperations: PdfPaintOperation[] | undefined;
  let insideSoftMask = false;
  function* emit(operation: PdfPaintOperation): EvaluationWork {
    const { clipPaths, clipImages, softMask } = curState();
    if (clipPaths || clipImages || softMask) operation = { ...operation, value: { ...operation.value,
      ...(clipPaths ? { clipPaths } : {}), ...(clipImages ? { clipImages } : {}), ...(softMask ? { softMask } : {}),
    } } as PdfPaintOperation;
    capturedOperations?.push(operation);
    yield { kind: "paint", operation, captured: capturedOperations !== undefined, insideSoftMask };
  };

  const initialState: GraphicsState = {
    ctm: [1, 0, 0, 1, 0, 0],
    initialCtm: [1, 0, 0, 1, 0, 0],
    strokeColor: { r: 0, g: 0, b: 0 },
    fillColor: { r: 0, g: 0, b: 0 },
      strokeAlpha: 1,
      fillAlpha: 1,
      strokeWidth: 1,
      lineCap: 0,
      lineJoin: 0,
      miterLimit: 10,
      fontName: "Helvetica",
    fontSize: 12,
    charSpace: 0,
    wordSpace: 0,
    horizScale: 100,
    leading: 14,
    rise: 0,
    textRenderMode: 0,
    fillColorSpaceName: "DeviceGray",
    strokeColorSpaceName: "DeviceGray",
  };

  const stateStack: GraphicsState[] = [initialState];
  const curState = (): GraphicsState => stateStack[stateStack.length - 1]!;

  function* decodeTokenGlyphs(
    bytes: Uint8Array,
    font: ResolvedPageFont | undefined
  ): Generator<{ charCode: number; cid?: number; isSpace: boolean; unicode: string; advance1000: number }, void, void> {
    if (font?.encodingCMap) {
      const encoding = font.encodingCMap;
      for (const { charCode, isSpace } of iterateCMapCharacters(encoding, bytes)) {
        const value = encoding.lookup(charCode);
        const cid = typeof value === "number" ? value : 0;
        const unicode = font.cmap?.map.get(charCode) ?? font.differences.get(cid) ?? (cid >= 0x20 && cid <= 0x10ffff ? String.fromCodePoint(cid) : "");
        yield { charCode, cid, isSpace, unicode, advance1000: font.widths.get(cid) ?? font.defaultWidth };
      }
      return;
    }
    if (font?.cmap) {
      if (!font.isTwoByteCid) {
        for (let i = 0; i < bytes.length; i++) {
          const code = bytes[i]!;
          const unicode = font.cmap.map.get(code) ?? (font.differences.has(code) ? font.differences.get(code)! : decodeWinAnsiByte(code));
          yield { charCode: code, isSpace: code === 0x20, unicode, advance1000: font.widths.get(code) ?? font.defaultWidth };
        }
        return;
      }
      for (const item of font.cmap.iterateBytes(bytes)) yield {
        charCode: item.charCode, isSpace: false, unicode: item.unicode,
        advance1000: font.widths.get(item.charCode) ?? font.defaultWidth,
      };
      return;
    }
    if (font?.isTwoByteCid && bytes.length >= 2 && bytes.length % 2 === 0) {
      for (let i = 0; i < bytes.length; i += 2) {
        const cid = (bytes[i]! << 8) | bytes[i + 1]!;
        yield { charCode: cid, isSpace: false, unicode: cid >= 0x20 ? String.fromCodePoint(cid) : "",
          advance1000: font.widths.get(cid) ?? font.defaultWidth };
      }
      return;
    }
    const stdMetrics = STANDARD_14_FONTS[normalizeStandard14FontName(font?.baseFont ?? curState().fontName)];
    for (let i = 0; i < bytes.length; i++) {
      const code = bytes[i]!;
      yield { charCode: code, isSpace: code === 0x20, unicode: font?.differences.get(code) ?? decodeWinAnsiByte(code),
        advance1000: font ? font.widths.get(code) ?? font.defaultWidth : stdMetrics.widthsByCode[code] ?? stdMetrics.defaultWidth };
    }
  }

  function* resolveScColorOperands(
    csName: string,
    ops: readonly import("../ast.js").PdfCosNode[],
    activeResources: PdfCosDict | undefined
  ): EvaluationWork<PdfRgbColor> {
    const comps: number[] = [];
    for (const op of ops) {
      if (op.kind === "number") comps.push(op.value);
    }
    if (comps.length === 0) return { r: 0, g: 0, b: 0 };
    let rgb: readonly [number, number, number];
    if (["DeviceRGB", "RGB", "DeviceGray", "G", "DeviceCMYK", "CMYK"].includes(csName)) rgb = shadingComponentsToRgb(csName, comps);
    else {
      const color = yield { kind: "color", name: csName, components: comps, resources: activeResources };
      if (!color || !("kind" in color) || color.kind !== "color") throw new TypeError("Expected a resolved PDF color");
      rgb = color.value;
    }
    const [r, g, b] = rgb;
    return { r: kClamp(r), g: kClamp(g), b: kClamp(b) };
  };

  function* applyStateOperator(
    st: GraphicsState,
    operator: string,
    ops: readonly import("../ast.js").PdfCosNode[],
    activeResources: PdfCosDict | undefined,
    activeFonts: FontScope,
    depth: number
  ): EvaluationWork {
    const num = (i: number, fb = 0) => (ops[i]?.kind === "number" ? ops[i]!.value : fb);
    if (operator === "cm") {
      const m: Matrix6 = [num(0, 1), num(1, 0), num(2, 0), num(3, 1), num(4, 0), num(5, 0)];
      st.ctm = multiplyMatrices(m, st.ctm);
    } else if (operator === "w") {
      st.strokeWidth = Math.max(0, num(0, 1));
    } else if (operator === "J") {
      const lc = Math.round(num(0, 0));
      if (lc === 0 || lc === 1 || lc === 2) st.lineCap = lc;
    } else if (operator === "j") {
      const lj = Math.round(num(0, 0));
      if (lj === 0 || lj === 1 || lj === 2) st.lineJoin = lj;
    } else if (operator === "M") {
      const ml = num(0, 10);
      if (ml > 0) st.miterLimit = ml;
    } else if (operator === "d") {
      const arrNode = ops[0]?.kind === "array" ? ops[0] : undefined;
      if (arrNode) {
        const nums = arrNode.items
          .map((it) => (it.kind === "number" ? it.value : 0))
          .filter((v) => v >= 0);
        const sum = nums.reduce((a, b) => a + b, 0);
        st.dashArray = sum > 0 ? nums : undefined;
        st.dashPhase = num(1, 0);
      } else {
        st.dashArray = undefined;
        st.dashPhase = undefined;
      }
    } else if (operator === "sh" && activeResources && ops[0]?.kind === "name") {
      const shMap = yield* resolveEvaluationDict(dictGet(activeResources, "Shading"));
      const shNode = shMap ? yield* resolveEvaluationNode(dictGet(shMap, ops[0].decoded)) : undefined;
      const shDict = shNode?.kind === "dict" ? shNode : shNode?.kind === "stream" ? shNode.dict : undefined;
      const shStream = shNode?.kind === "stream" ? shNode : undefined;
      if (shDict) {
        const [originX, originY] = params.origin ?? [0, 0];
        const targetBox: [number, number, number, number] = st.clipRect ?? [originX, originY, originX + params.width, originY + params.height];
        const rendered = yield { kind: "shading", dict: shDict, matrix: st.ctm, bounds: targetBox, alpha: st.fillAlpha,
          name: "Shading_" + ops[0].decoded, clipRect: st.clipRect ? [...st.clipRect] : undefined, stream: shStream, blendMode: st.blendMode };
        if (!rendered || !("kind" in rendered) || rendered.kind !== "shading") throw new TypeError("Expected a rendered PDF shading");
        const img = rendered.image;
        if (img) yield* emit({ kind: "image", value: img });
      }
    } else if (operator === "g") {
      const v = num(0, 0);
      st.fillColor = { r: v, g: v, b: v };
      st.fillPatternName = undefined;
    } else if (operator === "G") {
      const v = num(0, 0);
      st.strokeColor = { r: v, g: v, b: v };
    } else if (operator === "cs") {
      if (ops[0]?.kind === "name") st.fillColorSpaceName = ops[0].decoded;
    } else if (operator === "CS") {
      if (ops[0]?.kind === "name") st.strokeColorSpaceName = ops[0].decoded;
    } else if (operator === "rg" || operator === "sc" || operator === "scn") {
      const lastOp = ops[ops.length - 1];
      if (operator === "scn" && lastOp?.kind === "name") {
        st.fillPatternName = lastOp.decoded;
        if (ops.length > 1) {
          st.fillColor = yield* resolveScColorOperands(st.fillColorSpaceName, ops.slice(0, -1), activeResources);
        }
      } else {
        st.fillPatternName = undefined;
        st.fillColor = yield* resolveScColorOperands(operator === "rg" ? "DeviceRGB" : st.fillColorSpaceName, ops, activeResources);
      }
    } else if (operator === "RG" || operator === "SC" || operator === "SCN") {
      st.strokeColor = yield* resolveScColorOperands(operator === "RG" ? "DeviceRGB" : st.strokeColorSpaceName, ops, activeResources);
    } else if (operator === "k") {
      st.fillColor = yield* resolveScColorOperands("DeviceCMYK", ops, activeResources);
      st.fillPatternName = undefined;
    } else if (operator === "K") {
      st.strokeColor = yield* resolveScColorOperands("DeviceCMYK", ops, activeResources);
    } else if (operator === "gs" && activeResources && ops[0]?.kind === "name") {
      const extDict = yield* resolveEvaluationDict(dictGet(activeResources, "ExtGState"));
      const gsDict = extDict ? yield* resolveEvaluationDict(dictGet(extDict, ops[0].decoded)) : undefined;
      if (gsDict) {
        const mask = yield* resolveEvaluationNode(dictGet(gsDict, "SMask"));
        if (mask?.kind === "name" && mask.decoded === "None") {
          st.softMask = undefined;
        } else if (mask?.kind === "dict") {
          const subtype = yield* resolveEvaluationNode(dictGet(mask, "S"));
          const form = yield* resolveEvaluationNode(dictGet(mask, "G"));
          if (form?.kind === "stream" && subtype?.kind === "name" && (subtype.decoded === "Alpha" || subtype.decoded === "Luminosity")) {
            if (depth >= 8) throw new PdfError("E_LIMIT", "Soft-mask nesting exceeds the form depth limit");
            const parentOperations = capturedOperations;
            const parentInsideSoftMask = insideSoftMask;
            const savedTextState = { pendingTextClip, hasTextClip, activeTm, activeTlm };
            const captured: PdfPaintOperation[] = [];
            capturedOperations = captured;
            insideSoftMask = true;
            // PDF.js beginGroup resets these three transparency parameters.
            // Outer clipping is applied to the eventual paint, not twice to
            // both its mask and its coverage at antialiased boundaries.
            const maskState = { ...st, softMask: undefined, fillAlpha: 1, strokeAlpha: 1, blendMode: "Normal" };
            delete maskState.clipPaths;
            delete maskState.clipImages;
            delete maskState.clipRect;
            stateStack.push(maskState);
            try {
              yield* paintForm(form, activeResources, activeFonts, depth, undefined, undefined, true);
            } finally {
              stateStack.pop();
              capturedOperations = parentOperations;
              insideSoftMask = parentInsideSoftMask;
              ({ pendingTextClip, hasTextClip, activeTm, activeTlm } = savedTextState);
            }
            const parameters = yield { kind: "mask-parameters", mask, form, resources: activeResources };
            if (!parameters || !("kind" in parameters) || parameters.kind !== "mask-parameters") throw new TypeError("Expected PDF soft-mask parameters");
            st.softMask = { subtype: subtype.decoded, operations: captured, ...parameters.value };
          }
        }
        const bmNode = yield* resolveEvaluationNode(dictGet(gsDict, "BM"));
        if (bmNode?.kind === "name") {
          st.blendMode = bmNode.decoded === "Compatible" ? "Normal" : bmNode.decoded;
        } else if (bmNode?.kind === "array" && bmNode.items.length > 0) {
          const firstBm = yield* resolveEvaluationNode(bmNode.items[0]);
          if (firstBm?.kind === "name") {
            st.blendMode = firstBm.decoded === "Compatible" ? "Normal" : firstBm.decoded;
          }
        }
        const caNode = yield* resolveEvaluationNode(dictGet(gsDict, "ca"));
        if (caNode?.kind === "number") st.fillAlpha = Math.max(0, Math.min(1, caNode.value));
        const CANode = yield* resolveEvaluationNode(dictGet(gsDict, "CA"));
        if (CANode?.kind === "number") st.strokeAlpha = Math.max(0, Math.min(1, CANode.value));
        const lwNode = yield* resolveEvaluationNode(dictGet(gsDict, "LW"));
        if (lwNode?.kind === "number") st.strokeWidth = Math.max(0, lwNode.value);
        const lcNode = yield* resolveEvaluationNode(dictGet(gsDict, "LC"));
        if (lcNode?.kind === "number" && (lcNode.value === 0 || lcNode.value === 1 || lcNode.value === 2)) {
          st.lineCap = lcNode.value;
        }
        const ljNode = yield* resolveEvaluationNode(dictGet(gsDict, "LJ"));
        if (ljNode?.kind === "number" && (ljNode.value === 0 || ljNode.value === 1 || ljNode.value === 2)) {
          st.lineJoin = ljNode.value;
        }
        const mlNode = yield* resolveEvaluationNode(dictGet(gsDict, "ML"));
        if (mlNode?.kind === "number" && mlNode.value > 0) {
          st.miterLimit = mlNode.value;
        }
        const dArr = yield* resolveEvaluationArray(dictGet(gsDict, "D"));
        if (dArr && dArr.items.length >= 2) {
          const patArr = yield* resolveEvaluationArray(dArr.items[0]);
          const phaseNode = yield* resolveEvaluationNode(dArr.items[1]);
          if (patArr) {
            const dashArray: number[] = [];
            for (const item of patArr.items) {
              const resolved = yield* resolveEvaluationNode(item);
              const value = resolved?.kind === "number" ? resolved.value : 0;
              if (value >= 0) dashArray.push(value);
            }
            st.dashArray = dashArray.some(value => value > 0) ? dashArray : undefined;
            st.dashPhase = phaseNode?.kind === "number" ? phaseNode.value : 0;
          }
        }
        const fontArr = yield* resolveEvaluationArray(dictGet(gsDict, "Font"));
        if (fontArr && fontArr.items.length >= 2) {
          const fSizeNode = yield* resolveEvaluationNode(fontArr.items[1]);
          if (fSizeNode?.kind === "number") st.fontSize = fSizeNode.value;
          const gsFontKey = `__ExtGS_Font_${ops[0].decoded}`;
          const resolvedGsFont = yield* selectedFont([{
            kind: "dict",
            entries: [
              {
                key: { kind: "name", decoded: "Font", rawBytes: new Uint8Array(0) },
                value: {
                  kind: "dict",
                  entries: [
                    {
                      key: { kind: "name", decoded: gsFontKey, rawBytes: new Uint8Array(0) },
                      value: fontArr.items[0]!,
                    },
                  ],
                },
              },
            ],
          }], gsFontKey);
          if (resolvedGsFont) {
            st.fontOverride = resolvedGsFont;
            st.fontName = gsFontKey;
          }
        }
      }
    }
  };

  let pendingTextClip: PdfPathSegment[] = [];
  let hasTextClip = false;
  let activeTm: Matrix6 = [1, 0, 0, 1, 0, 0];
  let activeTlm: Matrix6 = [1, 0, 0, 1, 0, 0];

  function* paintImage(
    image: PdfEvaluatedImage,
    patternMask: boolean,
    resources: PdfCosDict | undefined,
    activeFonts: FontScope,
    depth: number
  ): EvaluationWork {
    if (!patternMask) {
      yield* emit({ kind: "image", value: image });
      return;
    }
    const st = curState();
    // Like PDF.js _createMaskCanvas: paint at page resolution, then apply the
    // transformed stencil alpha. A one-pixel mask must not flatten a gradient.
    stateStack.push({ ...st, clipImages: [...(st.clipImages ?? []), image] });
    yield* walkNodes([{ kind: "path-op", paint: "f", segments: [
      { kind: "rect", x: 0, y: 0, width: 1, height: 1 },
    ] }], undefined, undefined, resources, activeFonts, depth);
    stateStack.pop();
  };

  function* paintPattern(
    segments: PdfPathSegment[],
    fillRule: "nonzero" | "evenodd",
    resources: PdfCosDict | undefined,
    activeFonts: FontScope,
    depth: number,
    mcid?: number,
    actualText?: string,
    storedSegments?: PdfStoredPath
  ): EvaluationWork<boolean> {
    const st = curState();
    if (!st.fillPatternName || !resources) return false;
    if (depth >= 8) throw new PdfError("E_LIMIT", "Pattern nesting exceeds the form depth limit");
    const patterns = yield* resolveEvaluationDict(dictGet(resources, "Pattern"));
    const pattern = patterns && (yield* resolveEvaluationNode(dictGet(patterns, st.fillPatternName)));
    const dict = pattern?.kind === "stream" ? pattern.dict : pattern?.kind === "dict" ? pattern : undefined;
    if (!dict) return false;
    const nums = function* (key: string, fallback: number[]): EvaluationWork<number[]> {
      const array = yield* resolveEvaluationArray(dictGet(dict, key));
      if (!array) return fallback;
      const values: number[] = [];
      for (const [i, item] of array.items.entries()) {
        const value = yield* resolveEvaluationNode(item);
        values.push(value?.kind === "number" ? value.value : fallback[i] ?? 0);
      }
      return values;
    };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const include = (x: number, y: number) => {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    };
    for (const segment of segments) {
      if (segment.kind === "close") continue;
      include(segment.x, segment.y);
      if (segment.kind === "cubic") { include(segment.x1, segment.y1); include(segment.x2, segment.y2); }
      if (segment.kind === "rect") include(segment.x + segment.width, segment.y + segment.height);
    }
    if (storedSegments) [x0, y0, x1, y1] = storedSegments.bounds;
    const [originX, originY] = params.origin ?? [0, 0];
    const clip = st.clipRect ?? [originX, originY, originX + params.width, originY + params.height];
    const bounds: [number, number, number, number] = [Math.max(x0, clip[0]!), Math.max(y0, clip[1]!), Math.min(x1, clip[2]!), Math.min(y1, clip[3]!)];
    if (!(bounds[2] > bounds[0] && bounds[3] > bounds[1])) return true;
    // PDFBox TilingPaint / PageDrawer: pattern coordinates start at the
    // containing stream's initial matrix, independently of the text matrix.
    const matrix = multiplyMatrices((yield* nums("Matrix", [1, 0, 0, 1, 0, 0])) as Matrix6, st.initialCtm);
    const type = yield* resolveEvaluationNode(dictGet(dict, "PatternType"));
    stateStack.push({ ...st, clipRect: bounds, clipPaths: [...(st.clipPaths ?? []), { segments, fillRule, ...(storedSegments ? {storedSegments} : {}) }] });
    try {
      if (type?.kind === "number" && type.value === 2) {
        const shading = yield* resolveEvaluationNode(dictGet(dict, "Shading"));
        const shadingDict = shading?.kind === "stream" ? shading.dict : shading?.kind === "dict" ? shading : undefined;
        if (!shadingDict) return false;
        const rendered = yield { kind: "shading", dict: shadingDict, matrix, bounds, alpha: st.fillAlpha,
          name: "PatternShading_" + st.fillPatternName, clipRect: bounds, stream: shading?.kind === "stream" ? shading : undefined, blendMode: st.blendMode };
        if (!rendered || !("kind" in rendered) || rendered.kind !== "shading") throw new TypeError("Expected a rendered PDF pattern shading");
        const image = rendered.image;
        if (image) yield* emit({ kind: "image", value: image });
        return !!image;
      }
      if (pattern?.kind !== "stream") return false;
      const xStepNode = yield* resolveEvaluationNode(dictGet(dict, "XStep"));
      const yStepNode = yield* resolveEvaluationNode(dictGet(dict, "YStep"));
      const xStep = xStepNode?.kind === "number" ? Math.abs(xStepNode.value) : 0;
      const yStep = yStepNode?.kind === "number" ? Math.abs(yStepNode.value) : 0;
      const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
      if (!xStep || !yStep || !determinant) return true;
      const inverse: Matrix6 = [matrix[3] / determinant, -matrix[1] / determinant, -matrix[2] / determinant,
        matrix[0] / determinant, (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
        (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant];
      const corners = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]]
        .map(([x, y]) => transformPoint(inverse, x!, y!));
      const box = yield* nums("BBox", [0, 0, xStep, yStep]);
      const ix0 = Math.floor((Math.min(...corners.map(p => p[0])) - box[2]!) / xStep) + 1;
      const ix1 = Math.ceil((Math.max(...corners.map(p => p[0])) - box[0]!) / xStep) - 1;
      const iy0 = Math.floor((Math.min(...corners.map(p => p[1])) - box[3]!) / yStep) + 1;
      const iy1 = Math.ceil((Math.max(...corners.map(p => p[1])) - box[1]!) / yStep) - 1;
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > 20000) throw new PdfError("E_LIMIT", "Pattern tile count exceeds 20000");
      const nodes = { stream: pattern };
      const patternResources = (yield* resolveEvaluationDict(dictGet(dict, "Resources"))) ?? resources;
      const patternFonts: FontScope = [patternResources, ...activeFonts];
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const tileCtm = multiplyMatrices([1, 0, 0, 1, ix * xStep, iy * yStep], matrix);
          const points = [[box[0]!, box[1]!], [box[2]!, box[1]!], [box[2]!, box[3]!], [box[0]!, box[3]!]]
            .map(([x, y]) => transformPoint(tileCtm, x!, y!));
          const tileClip: PdfPathSegment[] = [
            ...points.map(([x, y], i) => ({ kind: i === 0 ? "move" as const : "line" as const, x, y })), { kind: "close" },
          ];
          stateStack.push({ ...curState(), fillPatternName: undefined, ctm: tileCtm, initialCtm: tileCtm,
            clipPaths: [...(curState().clipPaths ?? []), tileClip] });
          try { yield* walkNodes({ ...nodes }, mcid, actualText, patternResources, patternFonts, depth + 1); }
          finally { stateStack.pop(); }
        }
      }
      return true;
    } finally { stateStack.pop(); }
  };

  function* paintForm(
    form: PdfCosStream,
    activeResources: PdfCosDict | undefined,
    activeFonts: FontScope,
    depth: number,
    mcid?: number,
    actualText?: string,
    maskGroup = false
  ): EvaluationWork {
    const st = curState();
    const group = yield* resolveEvaluationDict(dictGet(form.dict, "Group"));
    const groupType = group ? yield* resolveEvaluationNode(dictGet(group, "S")) : undefined;
    const isolation = group ? yield* resolveEvaluationNode(dictGet(group, "I")) : undefined;
    const isolated = isolation?.kind === "boolean" && isolation.value;
    // PDF.js beginGroup: ordinary non-isolated
    // Forms paint directly, retaining inherited state. Group effects instead
    // apply once to the finished Form, after resetting its inner paint state.
    const compositeGroup = !maskGroup && groupType?.kind === "name" && groupType.decoded === "Transparency" &&
      (isolated || st.fillAlpha !== 1 || !!st.softMask || (!!st.blendMode && st.blendMode !== "Normal" && st.blendMode !== "Compatible"));
    const formNodes = { stream: form };
    const formResDict = (yield* resolveEvaluationDict(dictGet(form.dict, "Resources"))) ?? activeResources;
    const formFonts: FontScope = [formResDict, ...activeFonts];
    let nextCtm: Matrix6 = [...st.ctm] as Matrix6;
    const matArr = yield* resolveEvaluationArray(dictGet(form.dict, "Matrix"));
    if (matArr && matArr.items.length >= 6) {
      const { items } = matArr;
      function* mn(idx: number, fb = 0): EvaluationWork<number> {
        const resolved = yield* resolveEvaluationNode(items[idx]);
        return resolved?.kind === "number" ? resolved.value : fb;
      };
      const formMat: Matrix6 = [(yield* mn(0, 1)), (yield* mn(1, 0)), (yield* mn(2, 0)), (yield* mn(3, 1)), (yield* mn(4, 0)), (yield* mn(5, 0))];
      nextCtm = multiplyMatrices(formMat, nextCtm);
    }
    let nextClip = !compositeGroup && st.clipRect ? ([...st.clipRect] as [number, number, number, number]) : undefined;
    let nextClipPaths = compositeGroup ? undefined : st.clipPaths;
    const bboxArr = yield* resolveEvaluationArray(dictGet(form.dict, "BBox"));
    if (bboxArr && bboxArr.items.length >= 4) {
      const { items } = bboxArr;
      function* bn(idx: number, fb = 0): EvaluationWork<number> {
        const resolved = yield* resolveEvaluationNode(items[idx]);
        return resolved?.kind === "number" ? resolved.value : fb;
      };
      const bx0 = (yield* bn(0, 0)), by0 = (yield* bn(1, 0)), bx1 = (yield* bn(2, 0)), by1 = (yield* bn(3, 0));
      const pts = [
        transformPoint(nextCtm, bx0, by0),
        transformPoint(nextCtm, bx1, by0),
        transformPoint(nextCtm, bx1, by1),
        transformPoint(nextCtm, bx0, by1),
      ];
      nextClipPaths = [...(nextClipPaths ?? []), [
        ...pts.map(([x, y], index) => ({ kind: index === 0 ? "move" as const : "line" as const, x: x!, y: y! })),
        { kind: "close" },
      ]];
      const fMinX = Math.min(...pts.map(p => p[0]));
      const fMinY = Math.min(...pts.map(p => p[1]));
      const fMaxX = Math.max(...pts.map(p => p[0]));
      const fMaxY = Math.max(...pts.map(p => p[1]));
      if (fMaxX > fMinX && fMaxY > fMinY) {
        nextClip = nextClip
          ? [
              Math.max(nextClip[0], fMinX),
              Math.max(nextClip[1], fMinY),
              Math.min(nextClip[2], fMaxX),
              Math.min(nextClip[3], fMaxY),
            ]
          : [fMinX, fMinY, fMaxX, fMaxY];
      }
    }
    const parentOperations = capturedOperations;
    const children: PdfPaintOperation[] = [];
    const nextState = { ...st, ctm: nextCtm, initialCtm: nextCtm };
    if (compositeGroup) {
      capturedOperations = children;
      nextState.fillAlpha = nextState.strokeAlpha = 1;
      nextState.blendMode = "Normal";
      nextState.softMask = undefined;
      delete nextState.clipImages;
      delete nextState.clipPaths;
      delete nextState.clipRect;
    }
    if (nextClip) nextState.clipRect = nextClip;
    if (nextClipPaths) nextState.clipPaths = nextClipPaths;
    stateStack.push(nextState);
    try {
      yield* walkNodes(formNodes, mcid, actualText, formResDict, formFonts, depth + 1);
    } finally {
      stateStack.pop();
      capturedOperations = parentOperations;
    }
    if (compositeGroup) yield* emit({ kind: "group", value: { operations: children, alpha: st.fillAlpha, isolated, bboxClip: nextClipPaths?.[0], blendMode: st.blendMode, clipRect: st.clipRect } });
  };

  function* markedContext(node: Extract<PdfContentNode, { kind: "marked-content" }>,
    mcid: number | undefined, actualText: string | undefined, activeResources: PdfCosDict | undefined
  ): EvaluationWork<{ mcid: number | undefined; actualText: string | undefined } | undefined> {
    let resolvedMcid = node.mcid;
    let resolvedActualText = node.actualText;
    if (typeof node.properties === "string" && activeResources) {
      const propsMap = yield* resolveEvaluationDict(dictGet(activeResources, "Properties"));
      const propRefOrNode = propsMap ? dictGet(propsMap, node.properties) : undefined;
      if (propRefOrNode) {
        const propDict = yield* resolveEvaluationDict(propRefOrNode);
        const propType = propDict ? yield* resolveEvaluationNode(dictGet(propDict, "Type")) : undefined;
        const isOcTag =
          node.tag === "OC" ||
          (propType?.kind === "name" && (propType.decoded === "OCG" || propType.decoded === "OCMD"));
        if (isOcTag && !(yield* optionalContentVisibilitySteps(propRefOrNode))) {
          return undefined;
        }
        if (propDict) {
          if (resolvedActualText === undefined) {
            const at = yield* resolveEvaluationNode(dictGet(propDict, "ActualText"));
            if (at?.kind === "string") resolvedActualText = decodePdfString(at);
          }
          if (resolvedMcid === undefined) {
            const mc = yield* resolveEvaluationNode(dictGet(propDict, "MCID"));
            if (mc?.kind === "number") resolvedMcid = mc.value;
          }
        }
      }
    }
    return { mcid: resolvedMcid ?? mcid, actualText: resolvedActualText ?? actualText };
  }

  function* walkNodes(
    nodes: Iterable<PdfContentEvent> | PdfEvaluationContentSource | undefined,
    mcid?: number,
    actualText?: string,
    activeResources: PdfCosDict | undefined = params.resourcesDict,
    activeFonts: FontScope = fonts,
    depth = 0,
    initialNode?: PdfContentEvent
  ): EvaluationWork {
    const groups: Array<{ pushed: boolean; hidden: boolean; mcid: number | undefined; actualText: string | undefined }> = [];
    let hidden = false;
    const source = nodes && "stream" in nodes ? nodes : undefined;
    const iterator = nodes && !("stream" in nodes) ? nodes[Symbol.iterator]() : undefined;
    let failed = false, exhausted = false;
    try {
    while (true) {
      const next = initialNode ? undefined : iterator?.next();
      if (next?.done) exhausted = true;
      const node = initialNode ?? (next ? (next.done ? undefined : next.value) : yield { kind: "node", ...(source ? { source } : {}) });
      initialNode = undefined;
      if (!node) break;
      if (!("kind" in node) || node.kind === "stored-path") throw new TypeError("Expected a PDF content event");
      if (node.kind === "end-group") {
        const parent = groups.pop();
        if (parent) {
          if (parent.pushed) stateStack.pop();
          ({ hidden, mcid, actualText } = parent);
        }
        continue;
      }
      if (node.kind === "begin-group") {
        const pushed = !hidden && node.group.kind === "graphics-group";
        groups.push({ pushed, hidden, mcid, actualText });
        if (pushed) stateStack.push({ ...curState(), ctm: [...curState().ctm] as Matrix6 });
        else if (!hidden && node.group.kind === "marked-content") {
          const context = yield* markedContext(node.group, mcid, actualText, activeResources);
          if (context) ({ mcid, actualText } = context);
          else hidden = true;
        }
        continue;
      }
      if (hidden) continue;
      switch (node.kind) {
        case "graphics-group":
          stateStack.push({ ...curState(), ctm: [...curState().ctm] as Matrix6 });
          yield* walkNodes(node.ops, mcid, actualText, activeResources, activeFonts, depth);
          if (stateStack.length > 1) stateStack.pop();
          break;

        case "marked-content": {
          const context = yield* markedContext(node, mcid, actualText, activeResources);
          if (context) yield* walkNodes(node.children, context.mcid, context.actualText, activeResources, activeFonts, depth);
          break;
        }

        case "state-op": {
          yield* applyStateOperator(curState(), node.operator, node.operands, activeResources, activeFonts, depth);
          break;
        }

        case "path-op": {
          const st = curState();
          let storedSegments: PdfStoredPath | undefined;
          const transformedSegments: PdfPathSegment[] = [];
          const close = ["s", "b", "b*"].includes(node.paint);
          if (node.storedSegments) {
            const reply = yield {kind:"transform-path",path:node.storedSegments,matrix:st.ctm,close};
            if (!reply || !("kind" in reply) || reply.kind !== "stored-path") throw new TypeError("Expected transformed PDF path");
            storedSegments = reply;
          } else {
            for (const segment of node.segments) for (const transformed of transformPathSegment(segment, st.ctm)) transformedSegments.push(transformed);
            const last = transformedSegments[transformedSegments.length - 1];
            if (close && last && last.kind !== "close" && last.kind !== "rect") transformedSegments.push({kind:"close"});
          }

          const applyClip = () => {
            if (!node.clip) return;
            st.clipPaths = [...(st.clipPaths ?? []), {
              segments: transformedSegments,
              ...(storedSegments ? {storedSegments} : {}),
              fillRule: node.clip === "W*" ? "evenodd" : "nonzero",
            }];
            let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
            for (const s of transformedSegments) {
              if (s.kind === "move" || s.kind === "line") {
                cMinX = Math.min(cMinX, s.x);
                cMinY = Math.min(cMinY, s.y);
                cMaxX = Math.max(cMaxX, s.x);
                cMaxY = Math.max(cMaxY, s.y);
              } else if (s.kind === "cubic") {
                cMinX = Math.min(cMinX, s.x1, s.x2, s.x);
                cMinY = Math.min(cMinY, s.y1, s.y2, s.y);
                cMaxX = Math.max(cMaxX, s.x1, s.x2, s.x);
                cMaxY = Math.max(cMaxY, s.y1, s.y2, s.y);
              } else if (s.kind === "rect") {
                cMinX = Math.min(cMinX, s.x);
                cMinY = Math.min(cMinY, s.y);
                cMaxX = Math.max(cMaxX, s.x + s.width);
                cMaxY = Math.max(cMaxY, s.y + s.height);
              }
            }
            if (storedSegments) [cMinX, cMinY, cMaxX, cMaxY] = storedSegments.bounds;
            if (Number.isFinite(cMinX) && Number.isFinite(cMinY)) {
              st.clipRect = st.clipRect
                ? [
                    Math.max(st.clipRect[0], cMinX),
                    Math.max(st.clipRect[1], cMinY),
                    Math.min(st.clipRect[2], cMaxX),
                    Math.min(st.clipRect[3], cMaxY),
                  ]
                : [cMinX, cMinY, cMaxX, cMaxY];
            }
          };

          // PDF.js consumePath installs W/W* only after the current paint.
          if (node.paint === "n") {
            applyClip();
            break;
          }

          const isFill = ["f", "F", "f*", "B", "B*", "b", "b*"].includes(node.paint);
          const isStroke = ["S", "s", "B", "B*", "b", "b*"].includes(node.paint);
          const evaluatedFillPattern = isFill && (yield* paintPattern(transformedSegments,
            node.paint.includes("*") ? "evenodd" : "nonzero", activeResources, activeFonts, depth, mcid, actualText, storedSegments));
          if (evaluatedFillPattern && !isStroke) {
            applyClip();
            break;
          }
          const fillRule = node.paint.includes("*") ? "evenodd" : "nonzero";
          yield* emit({ kind: "path", value: {
            segments: transformedSegments,
              ...(storedSegments ? {storedSegments} : {}),
            fillColor: isFill && !evaluatedFillPattern ? st.fillColor : undefined,
            fillAlpha: isFill && !evaluatedFillPattern ? st.fillAlpha : undefined,
            strokeColor: isStroke ? st.strokeColor : undefined,
            strokeAlpha: isStroke ? st.strokeAlpha : undefined,
            strokeWidth: st.strokeWidth,
            ...(isStroke ? { strokeMatrix: [...st.ctm] as Matrix6 } : {}),
            ...(st.lineCap !== 0 ? { lineCap: st.lineCap } : {}),
            ...(st.lineJoin !== 0 ? { lineJoin: st.lineJoin } : {}),
            ...(st.miterLimit !== 10 ? { miterLimit: st.miterLimit } : {}),
            fillRule,
            ...(st.blendMode && st.blendMode !== "Normal" ? { blendMode: st.blendMode } : {}),
            ...(st.dashArray ? { dashArray: [...st.dashArray] } : {}),
            ...(st.dashPhase !== undefined ? { dashPhase: st.dashPhase } : {}),
            ...(st.clipRect ? { clipRect: [...st.clipRect] as [number, number, number, number] } : {}),
          } });
          applyClip();
          break;
        }

        case "xobject": {
          const st = curState();
          if (activeResources) {
            const xobjDict = yield* resolveEvaluationDict(dictGet(activeResources, "XObject"));
            const xobjNode = xobjDict ? yield* resolveEvaluationNode(dictGet(xobjDict, node.name)) : undefined;
            if (xobjNode?.kind === "stream") {
              if (!(yield* optionalContentVisibilitySteps(dictGet(xobjNode.dict, "OC")))) {
                break;
              }
              const subNode = yield* resolveEvaluationNode(dictGet(xobjNode.dict, "Subtype"));
              const sub = subNode?.kind === "name" ? subNode.decoded : "";
              if (sub === "Image") {
                const maskNode = yield* resolveEvaluationNode(dictGet(xobjNode.dict, "ImageMask"));
                const patternMask = !!st.fillPatternName && maskNode?.kind === "boolean" && maskNode.value;
                const imageResult = yield { kind: "image", stream: xobjNode, resources: activeResources,
                  fillColor: patternMask ? { r: 1, g: 1, b: 1, alpha: 1 } : { ...st.fillColor, alpha: st.fillAlpha } };
                if (!imageResult || !("kind" in imageResult) || imageResult.kind !== "decoded-image") throw new TypeError("Expected a decoded PDF image");
                const decoded = imageResult.image;
                yield* paintImage({
                  name: node.name,
                  matrix: [...st.ctm],
                  width: decoded.width,
                  height: decoded.height,
                  colorSpace: decoded.colorSpace,
                  bitsPerComponent: decoded.bitsPerComponent,
                  ...("rgba" in decoded ? {decodedRgba: decoded.rgba} : {storedRgba: decoded.storedRgba}),
                  ...(st.blendMode && st.blendMode !== "Normal" ? { blendMode: st.blendMode } : {}),
                  ...(st.clipRect ? { clipRect: [...st.clipRect] as [number, number, number, number] } : {}),
                }, patternMask, activeResources, activeFonts, depth);
              } else if (sub === "Form" && depth < 8) {
                yield* paintForm(xobjNode, activeResources, activeFonts, depth, mcid, actualText);
              }
            }
          }
          break;
        }

        case "inline-image": {
          const st = curState();
          const maskEntry = dictGet(node.dict, "ImageMask") ?? dictGet(node.dict, "IM");
          const maskNode = maskEntry?.kind === "ref" ? yield* resolveEvaluationNode(maskEntry) : maskEntry;
          const patternMask = !!st.fillPatternName && maskNode?.kind === "boolean" && maskNode.value;
          const imageResult = yield { kind: "inline-image", dict: node.dict, data: node.data, resources: activeResources,
            fillColor: patternMask ? { r: 1, g: 1, b: 1, alpha: 1 } : { ...st.fillColor, alpha: st.fillAlpha } };
          if (!imageResult || !("kind" in imageResult) || imageResult.kind !== "decoded-image") throw new TypeError("Expected a decoded inline PDF image");
          const decoded = imageResult.image;
          yield* paintImage({
            name: "InlineImage",
            matrix: [...st.ctm],
            width: decoded.width,
            height: decoded.height,
            colorSpace: decoded.colorSpace,
            bitsPerComponent: decoded.bitsPerComponent,
            ...("rgba" in decoded ? {decodedRgba: decoded.rgba} : {storedRgba: decoded.storedRgba}),
            ...(st.blendMode && st.blendMode !== "Normal" ? { blendMode: st.blendMode } : {}),
            ...(st.clipRect ? { clipRect: [...st.clipRect] as [number, number, number, number] } : {}),
          }, patternMask, activeResources, activeFonts, depth);
          break;
        }

        case "text-object": {
          const st = curState();
          if (!node.continuation) {
            pendingTextClip = [];
            hasTextClip = false;
            activeTm = [1, 0, 0, 1, 0, 0];
            activeTlm = [1, 0, 0, 1, 0, 0];
          }
          let tm: Matrix6 = activeTm;
          let tlm: Matrix6 = activeTlm;

          function* emitTokenBytes(bytes: Uint8Array): EvaluationWork {
            const font = st.fontOverride ?? (yield* selectedFont(activeFonts, st.fontName));
            const decoded = decodeTokenGlyphs(bytes, font);
            const scaleH = st.horizScale / 100;
            for (const item of decoded) {
              if (st.textRenderMode >= 4 && st.textRenderMode <= 7) hasTextClip = true;
              const totalMatrix = multiplyMatrices(tm, st.ctm);
              const [px, py] = [totalMatrix[4], totalMatrix[5] + st.rise];
              const effectiveFontSize = st.fontSize * Math.hypot(totalMatrix[0], totalMatrix[1]);
              let advance1000 = item.advance1000;
              let evaluatedType3 = false;
              let glyphPaint: PdfEvaluatedPath | undefined;
              if (font?.subtype === "Type3" && font.charProcs && depth < 8) {
                const gName = font.glyphNames.get(item.charCode) ?? item.unicode;
                const procNode = gName ? yield* resolveEvaluationNode(dictGet(font.charProcs, gName)) : undefined;
                if (procNode?.kind === "stream") {
                  const fm: Matrix6 = font.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0];
                  const source = { stream: procNode };
                  const firstOp = yield { kind: "node", source };
                  if (firstOp && (!("kind" in firstOp) || (firstOp.kind === "stored-path" || firstOp.kind === "resolved" || firstOp.kind === "decoded-image" || firstOp.kind === "mask-parameters" || firstOp.kind === "color" || firstOp.kind === "shading"))) throw new TypeError("Expected Type3 content event");
                  if (!font.widths.has(item.charCode)) {
                    if (
                      firstOp?.kind === "state-op" &&
                      (firstOp.operator === "d0" || firstOp.operator === "d1") &&
                      firstOp.operands[0]?.kind === "number"
                    ) {
                      advance1000 = firstOp.operands[0].value * Math.hypot(fm[0], fm[1]) * 1000;
                    }
                  }
                  if (st.textRenderMode !== 3) {
                    const textSpaceMatrix = multiplyMatrices(
                      [st.fontSize * scaleH, 0, 0, st.fontSize, 0, st.rise],
                      totalMatrix
                    );
                    const glyphCtm = multiplyMatrices(fm, textSpaceMatrix);
                    stateStack.push({ ...st, ctm: glyphCtm });
                    try {
                      if (firstOp) yield* walkNodes(
                        source,
                        mcid,
                        actualText,
                        font.fontResources ?? activeResources,
                        activeFonts,
                        depth + 1,
                        firstOp
                      );
                    } finally { stateStack.pop(); }
                    evaluatedType3 = true;
                  } else if (firstOp) yield { kind: "close-content", source };
                }
              } else if ((font?.embeddedTrueType || font?.embeddedCff || font?.standardOutlines) && st.textRenderMode !== 3) {
                const cp = item.unicode ? item.unicode.codePointAt(0) : undefined;
                const cidFont = font.subtype === "Type0" && font.embeddedTrueType;
                if (cidFont || font.simpleToGid) evaluatedType3 = true; // An empty mapped glyph must not fall back to standard text.
                const glyphCode = item.cid ?? item.charCode;
                const glyphId = font.cidToGid ? font.cidToGid[glyphCode] ?? 0 : glyphCode;
                const simpleGid = font.simpleToGid?.get(item.charCode) ?? 0;
                let glyphOutline: PdfPathSegment[] = [];
                if (cidFont) {
                  glyphOutline = cidFont.getGlyphOutlineByGid(glyphId);
                } else if (font.simpleToGid && font.embeddedTrueType) {
                  glyphOutline = font.embeddedTrueType.getGlyphOutlineByGid(simpleGid);
                } else if (font.embeddedCff) {
                  glyphOutline = font.embeddedCff.getGlyphOutline(glyphCode);
                } else if (cp !== undefined) {
                  glyphOutline = (font.embeddedTrueType ?? font.standardOutlines!).getGlyphOutline(cp);
                }
                if (glyphOutline.length === 0 && font.embeddedTrueType && !cidFont && !font.simpleToGid) {
                  glyphOutline = font.embeddedTrueType.getGlyphOutlineByGid(item.charCode);
                }
                if (!font.widths.has(item.charCode) && font.embeddedTrueType && !cidFont) {
                  const ttAdv = font.simpleToGid
                    ? font.embeddedTrueType.getAdvanceWidthUnits(simpleGid) * 1000 / font.embeddedTrueType.unitsPerEm
                    : cp !== undefined ? font.embeddedTrueType.getAdvanceWidth1000(cp) : undefined;
                  if (ttAdv !== undefined) advance1000 = ttAdv;
                }
                if (glyphOutline.length > 0) {
                  const textSpaceMatrix = multiplyMatrices(
                    [st.fontSize * scaleH, 0, 0, st.fontSize, 0, st.rise],
                    totalMatrix
                  );
                  const transformedGlyphSegs: PdfPathSegment[] = [];
                  for (const seg of glyphOutline) {
                    if (seg.kind === "move") {
                      const [gx, gy] = transformPoint(textSpaceMatrix, seg.x, seg.y);
                      transformedGlyphSegs.push({ kind: "move", x: gx, y: gy });
                    } else if (seg.kind === "line") {
                      const [gx, gy] = transformPoint(textSpaceMatrix, seg.x, seg.y);
                      transformedGlyphSegs.push({ kind: "line", x: gx, y: gy });
                    } else if (seg.kind === "cubic") {
                      const [gx1, gy1] = transformPoint(textSpaceMatrix, seg.x1, seg.y1);
                      const [gx2, gy2] = transformPoint(textSpaceMatrix, seg.x2, seg.y2);
                      const [gx, gy] = transformPoint(textSpaceMatrix, seg.x, seg.y);
                      transformedGlyphSegs.push({ kind: "cubic", x1: gx1, y1: gy1, x2: gx2, y2: gy2, x: gx, y: gy });
                    } else {
                      transformedGlyphSegs.push(seg);
                    }
                  }
                  if (st.textRenderMode >= 4 && st.textRenderMode <= 7) pendingTextClip.push(...transformedGlyphSegs);
                  const isFillGlyph = st.textRenderMode === 0 || st.textRenderMode === 2 || st.textRenderMode === 4 || st.textRenderMode === 6;
                  const isStrokeGlyph = st.textRenderMode === 1 || st.textRenderMode === 2 || st.textRenderMode === 5 || st.textRenderMode === 6;
                  const patterned = isFillGlyph && (yield* paintPattern(transformedGlyphSegs, "nonzero",
                    activeResources, activeFonts, depth, mcid, actualText));
                  const paint: PdfEvaluatedPath = {
                    segments: transformedGlyphSegs,
                    fillColor: isFillGlyph && !patterned ? st.fillColor : undefined,
                    fillAlpha: isFillGlyph && !patterned ? st.fillAlpha : undefined,
                    strokeColor: isStrokeGlyph ? st.strokeColor : undefined,
                    strokeAlpha: isStrokeGlyph ? st.strokeAlpha : undefined,
                    strokeWidth: isStrokeGlyph ? st.strokeWidth : 0,
                    ...(isStrokeGlyph ? { strokeMatrix: [...st.ctm] as Matrix6 } : {}),
                    fillRule: "nonzero",
                    ...(st.blendMode && st.blendMode !== "Normal" ? { blendMode: st.blendMode } : {}),
                    ...(st.clipRect ? { clipRect: [...st.clipRect] as [number, number, number, number] } : {}),
                  };
                  if (font.standardOutlines || font.embeddedCff) glyphPaint = paint;
                  else yield* emit({ kind: "path", value: paint });
                  evaluatedType3 = !font.standardOutlines && !font.embeddedCff;
                }
              }
              const advUser = ((advance1000 * st.fontSize) / 1000 + st.charSpace + (item.isSpace ? st.wordSpace : 0)) * scaleH;
              const [nextX, nextY] = transformPoint(totalMatrix, advUser, 0);
              const glyphWidth = Math.max(
                Math.hypot(nextX - px, nextY - py),
                (advance1000 * effectiveFontSize) / 1000
              );
              yield* emit({ kind: "glyph", value: {
                ...(glyphPaint ? { outline: glyphPaint } : {}),
                charCode: item.charCode,
                unicode: item.unicode,
                fontName: font?.baseFont ?? st.fontName,
                fontSize: effectiveFontSize,
                bbox: [px, py - effectiveFontSize * 0.2, px + glyphWidth, py + effectiveFontSize * 0.8],
                baselineY: py,
                advanceWidth: glyphWidth,
                matrix: totalMatrix,
                color: st.textRenderMode === 1 ? st.strokeColor : st.fillColor,
                ...(evaluatedType3 ? { renderMode: 3 } : st.textRenderMode !== 0 ? { renderMode: st.textRenderMode } : {}),
                ...(st.blendMode && st.blendMode !== "Normal" ? { blendMode: st.blendMode } : {}),
                ...(st.clipRect ? { clipRect: [...st.clipRect] as [number, number, number, number] } : {}),
                mcid,
                actualText,
              } });
              tm = multiplyMatrices([1, 0, 0, 1, advUser, 0], tm);
            }
          };

          for (const cmd of node.commands) {
            switch (cmd.kind) {
              case "font":
                st.fontName = cmd.fontName;
                st.fontOverride = undefined;
                st.fontSize = cmd.size;
                break;
              case "matrix":
                tm = [...cmd.matrix] as Matrix6;
                tlm = [...cmd.matrix] as Matrix6;
                break;
              case "move":
                if (cmd.setLeading) st.leading = -cmd.ty;
                tlm = multiplyMatrices([1, 0, 0, 1, cmd.tx, cmd.ty], tlm);
                tm = [...tlm] as Matrix6;
                break;
              case "next-line":
                tlm = multiplyMatrices([1, 0, 0, 1, 0, -st.leading], tlm);
                tm = [...tlm] as Matrix6;
                break;
              case "leading":
                st.leading = cmd.leading;
                break;
              case "char-spacing":
                st.charSpace = cmd.charSpace;
                break;
              case "word-spacing":
                st.wordSpace = cmd.wordSpace;
                break;
              case "horiz-scaling":
                st.horizScale = cmd.scalePercent;
                break;
              case "rise":
                st.rise = cmd.rise;
                break;
              case "render-mode":
                st.textRenderMode = cmd.mode;
                break;
              case "state-op":
                yield* applyStateOperator(st, cmd.operator, cmd.operands, activeResources, activeFonts, depth);
                break;
              case "show-text":
                yield* emitTokenBytes(cmd.token.bytes);
                break;
              case "show-text-array":
                for (const part of cmd.items) {
                  if (part.kind === "string") {
                    yield* emitTokenBytes(part.bytes);
                  } else if (part.kind === "number") {
                    const shiftUser = ((-part.value * st.fontSize) / 1000) * (st.horizScale / 100);
                    tm = multiplyMatrices([1, 0, 0, 1, shiftUser, 0], tm);
                  }
                }
                break;
            }
          }
          if (node.end !== false && hasTextClip) {
            st.clipPaths = [...(st.clipPaths ?? []), pendingTextClip];
            pendingTextClip = [];
            hasTextClip = false;
          }
          activeTm = tm;
          activeTlm = tlm;
          break;
        }
      }
    }
    } catch (error) { failed = true; throw error; }
    finally {
      while (groups.length) if (groups.pop()!.pushed) stateStack.pop();
      if (!exhausted) closeEvaluationIterators([iterator], failed);
    }
  };

  yield* walkNodes(undefined);
}

/** Synchronous input driver for the same resumable evaluator. */
export function* evaluateContentStreamSteps(params: PdfContentEvaluationOptions): Generator<PdfEvaluationOperation, void, void> {
  const input = params.nodes[Symbol.iterator]();
  const work = evaluateContentSteps(params);
  const fontCaches = new WeakMap<PdfCosDict, Map<string, ResolvedPageFont | undefined>>();
  const defaultFonts = new Map<string, ResolvedPageFont | undefined>();
  const nestedInputs = new Map<PdfEvaluationContentSource, Iterator<PdfContentEvent>>();
  let failed = false, exhausted = false;
  try {
    let step = work.next();
    while (!step.done) {
      if (step.value.kind === "node") {
        const source = step.value.source;
        let cursor = source ? nestedInputs.get(source) : input;
        if (!cursor) {
          if (!params.cosDoc || !source) throw new PdfError("E_CAPABILITY", "Nested PDF content requires a source driver");
          cursor = parseContentEvents(params.cosDoc.decodeStream(source.stream));
          nestedInputs.set(source, cursor);
        }
        const next = cursor.next();
        if (next.done) {
          if (source) nestedInputs.delete(source);
          else exhausted = true;
        }
        step = work.next(next.done ? undefined : next.value);
      } else if (step.value.kind === "transform-path") {
        throw new PdfError("E_CAPABILITY", "Stored PDF paths require an asynchronous source driver");
      } else if (step.value.kind === "shading") {
        if (!params.cosDoc) throw new PdfError("E_CAPABILITY", "PDF shading requires a source driver");
        const request = step.value;
        step = work.next({ kind: "shading", image: renderShadingDictToImage(params.cosDoc, request.dict, request.matrix, request.bounds,
          request.alpha, request.name, request.clipRect, request.stream, request.blendMode, params.onShadingAllocation) });
      } else if (step.value.kind === "color") {
        step = work.next({ kind: "color", value: runColorProgram(params.cosDoc, convertContentColorSteps(Boolean(params.cosDoc), undefined, step.value.name, step.value.components, step.value.resources)) });
      } else if (step.value.kind === "inline-image") {
        if (!(step.value.data instanceof Uint8Array)) throw new PdfError("E_CAPABILITY", "Retained inline images require an asynchronous source driver");
        step = work.next({ kind: "decoded-image", image: decodeInlineImageNodeToRgba(params.cosDoc, step.value.dict, step.value.data, step.value.resources, step.value.fillColor) });
      } else if (step.value.kind === "mask-parameters") {
        if (!params.cosDoc) throw new PdfError("E_CAPABILITY", "PDF soft-mask parameters require a source driver");
        step = work.next({ kind: "mask-parameters", value: runColorProgram(params.cosDoc, resolveMaskParameterSteps(step.value.mask, step.value.form, step.value.resources)) });
      } else if (step.value.kind === "image") {
        if (!params.cosDoc) throw new PdfError("E_CAPABILITY", "PDF image decoding requires a source driver");
        step = work.next({ kind: "decoded-image", image: decodeXObjectImageToRgba(params.cosDoc, step.value.stream, step.value.resources, step.value.fillColor) });
      } else if (step.value.kind === "close-content") {
        const cursor = nestedInputs.get(step.value.source);
        nestedInputs.delete(step.value.source);
        cursor?.return?.();
        step = work.next();
      } else if (step.value.kind === "resolve" || step.value.kind === "catalog") {
        step = work.next({ kind: "resolved", node: params.cosDoc?.resolve(step.value.kind === "catalog" ? params.cosDoc.rootRef : step.value.node) });
      } else if (step.value.kind === "font") {
        const { resources, name } = step.value;
        let cache = resources ? fontCaches.get(resources) : defaultFonts;
        if (!cache) { cache = new Map(); fontCaches.set(resources!, cache); }
        if (!cache.has(name)) cache.set(name, resolvePageFonts(params.cosDoc, resources, name).get(name));
        step = work.next(cache.get(name));
      } else {
        yield step.value;
        step = work.next();
      }
    }
  } catch (error) { failed = true; throw error; }
  finally { closeEvaluationIterators([work, ...nestedInputs.values(), exhausted ? undefined : input], failed); }
}

export function evaluateContentStreamToDisplayList(params: PdfContentEvaluationOptions): PdfDisplayList {
  const glyphs: PdfPlacedGlyph[] = [];
  const paths: PdfEvaluatedPath[] = [];
  const images: PdfEvaluatedImage[] = [];
  const operations: PdfPaintOperation[] = [];
  for (const { operation, captured, insideSoftMask } of evaluateContentStreamSteps(params)) {
    if (!captured) operations.push(operation);
    if (insideSoftMask) continue;
    switch (operation.kind) {
      case "path": paths.push(operation.value); break;
      case "image": images.push(operation.value); break;
      case "glyph": glyphs.push(operation.value); break;
    }
  }
  return {
    pageIndex: params.pageIndex,
    width: params.width,
    height: params.height,
    ...(params.origin ? { origin: params.origin } : {}),
    rotation: params.rotation ?? 0,
    glyphs,
    paths,
    images,
    operations,
    annotations: params.annotations ? [...params.annotations] : [],
  };
}

export function extractPageAnnotations(cosDoc: ParsedCosDocument, pageDict: PdfCosDict): PdfLinkAnnotation[] {
  function pageNumber(reference: import("../ast.js").PdfCosRef): number | undefined {
    const visited = new Set<number>();
    const work = annotationPageNumberSteps(cosDoc.rootRef, reference);
    let step = work.next();
    while (!step.done) {
      const request = step.value;
      if (request.kind === "resolve") step = work.next(cosDoc.resolve(request.node));
      else if (request.kind === "visit-page") {
        const number = request.reference.objectNumber, added = !visited.has(number);
        visited.add(number); step = work.next(added);
      } else throw new TypeError("Unexpected annotation page lookup request");
    }
    return step.value;
  }
  const output: PdfLinkAnnotation[] = [];
  const work = extractPageAnnotationSteps(pageDict, cosDoc.rootRef);
  let step = work.next();
  while (!step.done) {
    const request = step.value;
    if (request.kind === "annotation") { output.push(request.annotation); step = work.next(); }
    else if (request.kind === "resolve") step = work.next(cosDoc.resolve(request.node));
    else if (request.kind === "page-number") step = work.next(pageNumber(request.reference));
    else throw new TypeError("Unexpected annotation request");
  }
  return output;
}
