import { resolvePageFonts, type ResolvedPageFont } from "../fonts/resolve.js";
import { buildPostScriptJsFunction, DeviceCmykCS, MeshShading, Stream } from "../vendor/pdfjs-fonts.mjs";
import { decodeInlineImageNodeToRgba, decodeXObjectImageToRgba } from "../extract/images.js";
import {
  decodePdfString,
  dictGet,
  type PdfClipPath,
  type PdfContentNode,
  type PdfCosDict,
  type PdfCosStream,
  type PdfDisplayList,
  type PdfEvaluatedImage,
  type PdfEvaluatedPath,
  type PdfLinkAnnotation,
  type PdfPathSegment,
  type PdfPlacedGlyph,
  type PdfPaintOperation,
  type PdfRgbColor,
  type PdfSoftMask,
} from "../ast.js";
import type { ParsedCosDocument } from "../cos/parser.js";
import { PdfError } from "../errors.js";
import { bytesToString } from "../bytes.js";
import { iterateCMapCharacters } from "../fonts/cmap.js";
import { parseContentStream, type PdfContentEvent } from "./parser.js";
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

function getColorSpaceComponentCount(
  doc: ParsedCosDocument | undefined,
  csNode: import("../ast.js").PdfCosNode | undefined,
  activeResources?: PdfCosDict,
  depth = 0
): number {
  if (!csNode || depth > 4) return 3;
  const resolved = doc ? doc.resolve(csNode) : csNode;
  if (!resolved) return 3;
  if (resolved.kind === "name") {
    const name = resolved.decoded;
    if (name === "DeviceGray" || name === "G" || name === "CalGray") return 1;
    if (name === "DeviceCMYK" || name === "CMYK") return 4;
    if (name === "DeviceRGB" || name === "RGB" || name === "CalRGB" || name === "Lab") return 3;
    if (doc && activeResources) {
      const csDict = doc.resolveDict(dictGet(activeResources, "ColorSpace"));
      const mapped = csDict ? dictGet(csDict, name) : undefined;
      if (mapped) return getColorSpaceComponentCount(doc, mapped, activeResources, depth + 1);
    }
    return 3;
  }
  if (resolved.kind === "array" && resolved.items.length > 0) {
    const familyNode = doc ? doc.resolve(resolved.items[0]) : resolved.items[0];
    const family = familyNode?.kind === "name" ? familyNode.decoded : "";
    if (family === "CalGray" || family === "Indexed" || family === "Separation") return 1;
    if (family === "CalRGB" || family === "Lab") return 3;
    if (family === "DeviceN") {
      const namesArr = doc && resolved.items[1] ? doc.resolveArray(resolved.items[1]) : undefined;
      return namesArr ? Math.max(1, namesArr.items.length) : 1;
    }
    if (family === "ICCBased" && doc && resolved.items[1]) {
      const iccStream = doc.resolve(resolved.items[1]);
      const iccDict = iccStream?.kind === "stream" ? iccStream.dict : iccStream?.kind === "dict" ? iccStream : undefined;
      const nNode = iccDict ? doc.resolve(dictGet(iccDict, "N")) : undefined;
      if (nNode?.kind === "number" && (nNode.value === 1 || nNode.value === 3 || nNode.value === 4)) {
        return nNode.value;
      }
    }
  }
  return 3;
}

function convertColorSpaceComponentsToRgb(
  doc: ParsedCosDocument | undefined,
  csNode: import("../ast.js").PdfCosNode | undefined,
  csNameFallback: string,
  comps: readonly number[],
  activeResources?: PdfCosDict,
  depth = 0
): [number, number, number] {
  if (depth > 5) return shadingComponentsToRgb(csNameFallback, comps);
  let resolved = csNode && doc ? doc.resolve(csNode) : csNode;
  if ((!resolved || resolved.kind === "name") && doc && activeResources) {
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
      const csDict = doc.resolveDict(dictGet(activeResources, "ColorSpace"));
      const mapped = csDict ? dictGet(csDict, lookupName) : undefined;
      if (mapped) {
        resolved = doc.resolve(mapped);
      }
    }
  }
  if (!resolved || resolved.kind === "name") {
    const name = resolved?.kind === "name" ? resolved.decoded : csNameFallback;
    return shadingComponentsToRgb(name, comps);
  }
  if (resolved.kind === "array" && resolved.items.length > 0 && doc) {
    const familyNode = doc.resolve(resolved.items[0]);
    const family = familyNode?.kind === "name" ? familyNode.decoded : "";
    if (family === "CalGray" || family === "CalRGB" || family === "Lab") {
      const colorSpace = createCalibratedColorSpace(doc, family, resolved.items[1]);
      const rgb = colorSpace.getRgb(comps, 0);
      return [rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255];
    }
    if (family === "ICCBased" && resolved.items[1]) {
      const iccNode = doc.resolve(resolved.items[1]);
      const iccDict = iccNode?.kind === "stream" ? iccNode.dict : iccNode?.kind === "dict" ? iccNode : undefined;
      const altNode = iccDict ? dictGet(iccDict, "Alternate") : undefined;
      if (altNode) {
        return convertColorSpaceComponentsToRgb(doc, altNode, "DeviceRGB", comps, activeResources, depth + 1);
      }
      const nNode = iccDict ? doc.resolve(dictGet(iccDict, "N")) : undefined;
      const n = nNode?.kind === "number" ? nNode.value : comps.length;
      if (n === 1) return shadingComponentsToRgb("DeviceGray", comps);
      if (n === 4) return shadingComponentsToRgb("DeviceCMYK", comps);
      return shadingComponentsToRgb("DeviceRGB", comps);
    }
    if ((family === "Separation" || family === "DeviceN") && resolved.items.length >= 4) {
      const altSpaceNode = resolved.items[2];
      const tintFnNode = resolved.items[3];
      const altComps = evalShadingFunctionToComponents(doc, tintFnNode, comps);
      return convertColorSpaceComponentsToRgb(doc, altSpaceNode, "DeviceRGB", altComps, activeResources, depth + 1);
    }
    if (family === "Indexed" && resolved.items.length >= 4) {
      const baseSpaceNode = resolved.items[1];
      const hivalNode = doc.resolve(resolved.items[2]);
      const hival = hivalNode?.kind === "number" ? Math.max(0, Math.floor(hivalNode.value)) : 255;
      const lookupNode = doc.resolve(resolved.items[3]);
      let lookupBytes: Uint8Array | undefined;
      if (lookupNode?.kind === "stream") {
        lookupBytes = doc.decodeStream(lookupNode);
      } else if (lookupNode?.kind === "string") {
        lookupBytes = lookupNode.bytes;
      }
      if (lookupBytes) {
        const nBase = getColorSpaceComponentCount(doc, baseSpaceNode, activeResources, depth + 1);
        const idx = Math.max(0, Math.min(hival, Math.round(comps[0] ?? 0)));
        const offset = idx * nBase;
        const baseResolved = baseSpaceNode ? doc.resolve(baseSpaceNode) : undefined;
        const baseFamilyNode =
          baseResolved?.kind === "array" && baseResolved.items[0] ? doc.resolve(baseResolved.items[0]) : baseResolved;
        const baseFamily = baseFamilyNode?.kind === "name" ? baseFamilyNode.decoded : "";
        const baseComps: number[] = [];
        for (let c = 0; c < nBase; c++) {
          const byteVal = lookupBytes[offset + c] ?? 0;
          if (baseFamily === "Lab") {
            if (c === 0) {
              baseComps.push((byteVal / 255) * 100);
            } else {
              const labDict =
                baseResolved?.kind === "array" && baseResolved.items[1]
                  ? doc.resolveDict(baseResolved.items[1])
                  : undefined;
              const rArr = labDict ? doc.resolveArray(dictGet(labDict, "Range")) : undefined;
              const rMinNode = rArr && rArr.items[(c - 1) * 2] ? doc.resolve(rArr.items[(c - 1) * 2]) : undefined;
              const rMaxNode =
                rArr && rArr.items[(c - 1) * 2 + 1] ? doc.resolve(rArr.items[(c - 1) * 2 + 1]) : undefined;
              const rMin = rMinNode?.kind === "number" ? rMinNode.value : -100;
              const rMax = rMaxNode?.kind === "number" ? rMaxNode.value : 100;
              baseComps.push(rMin + (byteVal / 255) * (rMax - rMin));
            }
          } else {
            baseComps.push(byteVal / 255);
          }
        }
        return convertColorSpaceComponentsToRgb(doc, baseSpaceNode, "DeviceRGB", baseComps, activeResources, depth + 1);
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
  blendMode?: string
): PdfEvaluatedImage | undefined {
  const bytes = doc.decodeStream(shStream);
  if (bytes.length === 0) return undefined;
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
  const numComps = fnNode ? 1 : getColorSpaceComponentCount(doc, csNode);
  const mesh = new MeshShading(shType, new Stream(bytes), {
    bitsPerCoordinate: bpcCoord, bitsPerComponent: bpcComp, bitsPerFlag: bpcFlag,
    decode: decodeNums, numComps, colorFn: null,
    colorSpace: {
      numComps,
      getRgb(components) {
        const params = Array.from(components);
        const values = fnNode ? evalShadingFunctionToComponents(doc, fnNode, params) : params;
        return new Uint8Array(convertColorSpaceComponentsToRgb(doc, csNode, csName, values)
          .map(value => Math.round(Math.max(0, Math.min(1, value)) * 255)));
      },
    },
  }, vPerRow);
  const [, , positions, colors, vertexCount] = mesh.getIR();
  if (vertexCount === 0) return undefined;
  const [bx0, by0, bx1, by1] = targetBox;
  const boxW = Math.max(1, bx1 - bx0);
  const boxH = Math.max(1, by1 - by0);
  const imgW = Math.max(1, Math.min(256, Math.ceil(boxW)));
  const imgH = Math.max(1, Math.min(256, Math.ceil(boxH)));
  const rgba = new Uint8Array(imgW * imgH * 4);
  const a8 = Math.round(fillAlpha * 255);

  const toImgCoords = (vx: number, vy: number): [number, number] => {
    const [px, py] = transformPoint(effectiveCtm, vx, vy);
    return [((px - bx0) / boxW) * imgW, ((by1 - py) / boxH) * imgH];
  };

  for (let vertex = 0; vertex < vertexCount; vertex += 3) {
    const [x0, y0] = toImgCoords(positions[vertex * 2]!, positions[vertex * 2 + 1]!);
    const [x1, y1] = toImgCoords(positions[vertex * 2 + 2]!, positions[vertex * 2 + 3]!);
    const [x2, y2] = toImgCoords(positions[vertex * 2 + 4]!, positions[vertex * 2 + 5]!);
    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(denom) < 1e-6) continue;
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

function renderShadingDictToImage(
  doc: ParsedCosDocument,
  shDict: PdfCosDict,
  shadingCtm: Matrix6,
  targetBox: [number, number, number, number],
  fillAlpha: number,
  name: string,
  clipRect?: [number, number, number, number],
  shStream?: import("../ast.js").PdfCosStream,
  blendMode?: string
): PdfEvaluatedImage | undefined {
  const stTypeNode = doc.resolve(dictGet(shDict, "ShadingType"));
  const shType = stTypeNode?.kind === "number" ? stTypeNode.value : 0;
  if ((shType === 4 || shType === 5 || shType === 6 || shType === 7) && shStream) {
    return renderMeshShadingToImage(doc, shDict, shStream, shType, shadingCtm, targetBox, fillAlpha, name, clipRect, blendMode);
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
  const rgba = new Uint8Array(imgW * imgH * 4);
  if (bgComps && bgComps.length > 0) {
    const [bgr, bgg, bgb] = convertColorSpaceComponentsToRgb(doc, csNode, csName, bgComps);
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
        const [r, g, bl] = convertColorSpaceComponentsToRgb(doc, csNode, csName, comps);
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

export function isOptionalContentVisible(
  doc: ParsedCosDocument | undefined,
  ocNode: import("../ast.js").PdfCosNode | undefined
): boolean {
  if (!doc || !ocNode) return true;
  const resolved = doc.resolve(ocNode);
  const ocDict = resolved?.kind === "dict" ? resolved : resolved?.kind === "stream" ? resolved.dict : undefined;
  if (!ocDict) return true;

  const catalog = doc.resolveDict(doc.rootRef);
  const ocProps = catalog ? doc.resolveDict(dictGet(catalog, "OCProperties")) : undefined;
  const dDict = ocProps ? doc.resolveDict(dictGet(ocProps, "D")) : undefined;
  const baseStateNode = dDict ? doc.resolve(dictGet(dDict, "BaseState")) : undefined;
  const baseStateOff = baseStateNode?.kind === "name" && baseStateNode.decoded === "OFF";

  const collectRefSet = (arrNode: import("../ast.js").PdfCosNode | undefined): Set<number> => {
    const set = new Set<number>();
    const arr = doc.resolveArray(arrNode);
    if (!arr) return set;
    for (const item of arr.items) {
      if (item.kind === "ref") set.add(item.objectNumber);
    }
    return set;
  };
  const onSet = dDict ? collectRefSet(dictGet(dDict, "ON")) : new Set<number>();
  const offSet = dDict ? collectRefSet(dictGet(dDict, "OFF")) : new Set<number>();

  const isSingleOcgOn = (node: import("../ast.js").PdfCosNode | undefined): boolean => {
    if (!node) return true;
    const refObjNum = node.kind === "ref" ? node.objectNumber : undefined;
    const dict = doc.resolveDict(node);
    if (dict) {
      const usageDict = doc.resolveDict(dictGet(dict, "Usage"));
      const viewDict = usageDict ? doc.resolveDict(dictGet(usageDict, "View")) : undefined;
      const viewState = viewDict ? doc.resolve(dictGet(viewDict, "ViewState")) : undefined;
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

  const typeNode = doc.resolve(dictGet(ocDict, "Type"));
  const typeName = typeNode?.kind === "name" ? typeNode.decoded : "";
  if (typeName === "OCMD") {
    const pNode = doc.resolve(dictGet(ocDict, "P"));
    const policy = pNode?.kind === "name" ? pNode.decoded : "AnyOn";
    const ocgsEntry = dictGet(ocDict, "OCGs");
    const ocgsArr = doc.resolveArray(ocgsEntry);
    const memberNodes = ocgsArr ? ocgsArr.items : ocgsEntry ? [ocgsEntry] : [];
    if (memberNodes.length === 0) return true;
    const states = memberNodes.map(isSingleOcgOn);
    if (policy === "AllOn") return states.every(Boolean);
    if (policy === "AnyOff") return states.some((s) => !s);
    if (policy === "AllOff") return states.every((s) => !s);
    return states.some(Boolean);
  }
  return isSingleOcgOn(ocNode);
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
}
export interface PdfEvaluationOperation {
  readonly kind: "paint";
  readonly operation: PdfPaintOperation;
  /** The operation belongs to a captured group rather than the page paint list. */
  readonly captured: boolean;
  /** Mask paint is excluded from the page's text/image extraction views. */
  readonly insideSoftMask: boolean;
}

export type PdfEvaluationRequest = PdfEvaluationOperation | { readonly kind: "node" }
  | { readonly kind: "font"; readonly name: string; readonly resources: PdfCosDict | undefined };
export type PdfEvaluationResult = PdfContentEvent | ResolvedPageFont | undefined;
type EvaluationWork<T = void> = Generator<PdfEvaluationRequest, T, PdfEvaluationResult>;
type FontScope = ReadonlyArray<PdfCosDict | undefined>;

function closeEvaluationIterators(iterators: ReadonlyArray<Pick<Iterator<unknown>, "return"> | undefined>, failed: boolean): void {
  let cleanupFailure: { error: unknown } | undefined;
  for (const iterator of iterators) {
    try { iterator?.return?.(); } catch (error) { cleanupFailure ??= { error }; }
  }
  if (!failed && cleanupFailure) throw cleanupFailure.error;
}

/** Pull individual evaluated operations. Composite captures, fonts and decoded
 * resources still belong to this evaluator; this is not a retained I/O driver. */
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

  const resolveScColorOperands = (
    csName: string,
    ops: readonly import("../ast.js").PdfCosNode[],
    activeResources: PdfCosDict | undefined
  ): PdfRgbColor => {
    const comps: number[] = [];
    for (const op of ops) {
      if (op.kind === "number") comps.push(op.value);
    }
    if (comps.length === 0) return { r: 0, g: 0, b: 0 };
    const [r, g, b] = convertColorSpaceComponentsToRgb(
      params.cosDoc,
      undefined,
      csName,
      comps,
      activeResources
    );
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
    } else if (operator === "sh" && params.cosDoc && activeResources && ops[0]?.kind === "name") {
      const shMap = params.cosDoc.resolveDict(dictGet(activeResources, "Shading"));
      const shNode = shMap ? params.cosDoc.resolve(dictGet(shMap, ops[0].decoded)) : undefined;
      const shDict = shNode?.kind === "dict" ? shNode : shNode?.kind === "stream" ? shNode.dict : undefined;
      const shStream = shNode?.kind === "stream" ? shNode : undefined;
      if (shDict) {
        const [originX, originY] = params.origin ?? [0, 0];
        const targetBox: [number, number, number, number] = st.clipRect ?? [originX, originY, originX + params.width, originY + params.height];
        const img = renderShadingDictToImage(
          params.cosDoc,
          shDict,
          st.ctm,
          targetBox,
          st.fillAlpha,
          "Shading_" + ops[0].decoded,
          st.clipRect ? ([...st.clipRect] as [number, number, number, number]) : undefined,
          shStream,
          st.blendMode
        );
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
          st.fillColor = resolveScColorOperands(st.fillColorSpaceName, ops.slice(0, -1), activeResources);
        }
      } else {
        st.fillPatternName = undefined;
        st.fillColor = resolveScColorOperands(operator === "rg" ? "DeviceRGB" : st.fillColorSpaceName, ops, activeResources);
      }
    } else if (operator === "RG" || operator === "SC" || operator === "SCN") {
      st.strokeColor = resolveScColorOperands(operator === "RG" ? "DeviceRGB" : st.strokeColorSpaceName, ops, activeResources);
    } else if (operator === "k") {
      st.fillColor = resolveScColorOperands("DeviceCMYK", ops, activeResources);
      st.fillPatternName = undefined;
    } else if (operator === "K") {
      st.strokeColor = resolveScColorOperands("DeviceCMYK", ops, activeResources);
    } else if (operator === "gs" && params.cosDoc && activeResources && ops[0]?.kind === "name") {
      const extDict = params.cosDoc.resolveDict(dictGet(activeResources, "ExtGState"));
      const gsDict = extDict ? params.cosDoc.resolveDict(dictGet(extDict, ops[0].decoded)) : undefined;
      if (gsDict) {
        const mask = params.cosDoc.resolve(dictGet(gsDict, "SMask"));
        if (mask?.kind === "name" && mask.decoded === "None") {
          st.softMask = undefined;
        } else if (mask?.kind === "dict") {
          const subtype = params.cosDoc.resolve(dictGet(mask, "S"));
          const form = params.cosDoc.resolve(dictGet(mask, "G"));
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
            const group = params.cosDoc.resolveDict(dictGet(form.dict, "Group"));
            const colorSpace = group ? dictGet(group, "CS") : undefined;
            const bc = params.cosDoc.resolveArray(dictGet(mask, "BC"));
            const components = bc?.items.map(item => {
              const value = params.cosDoc!.resolve(item);
              return value?.kind === "number" ? value.value : 0;
            });
            const [r, g, b] = components ? convertColorSpaceComponentsToRgb(params.cosDoc, colorSpace, "DeviceRGB", components, activeResources) : [0, 0, 0];
            const transfer = params.cosDoc.resolve(dictGet(mask, "TR"));
            const transferMap = transfer?.kind === "dict" || transfer?.kind === "stream"
              ? Uint8Array.from({ length: 256 }, (_, i) => Math.floor(kClamp(Math.fround(evalShadingFunctionToComponents(params.cosDoc!, transfer, Math.fround(i / 255))[0] ?? 0)) * 255))
              : undefined;
            st.softMask = { subtype: subtype.decoded, operations: captured, backdrop: { r, g, b }, transferMap };
          }
        }
        const bmNode = params.cosDoc.resolve(dictGet(gsDict, "BM"));
        if (bmNode?.kind === "name") {
          st.blendMode = bmNode.decoded === "Compatible" ? "Normal" : bmNode.decoded;
        } else if (bmNode?.kind === "array" && bmNode.items.length > 0) {
          const firstBm = params.cosDoc.resolve(bmNode.items[0]);
          if (firstBm?.kind === "name") {
            st.blendMode = firstBm.decoded === "Compatible" ? "Normal" : firstBm.decoded;
          }
        }
        const caNode = params.cosDoc.resolve(dictGet(gsDict, "ca"));
        if (caNode?.kind === "number") st.fillAlpha = Math.max(0, Math.min(1, caNode.value));
        const CANode = params.cosDoc.resolve(dictGet(gsDict, "CA"));
        if (CANode?.kind === "number") st.strokeAlpha = Math.max(0, Math.min(1, CANode.value));
        const lwNode = params.cosDoc.resolve(dictGet(gsDict, "LW"));
        if (lwNode?.kind === "number") st.strokeWidth = Math.max(0, lwNode.value);
        const lcNode = params.cosDoc.resolve(dictGet(gsDict, "LC"));
        if (lcNode?.kind === "number" && (lcNode.value === 0 || lcNode.value === 1 || lcNode.value === 2)) {
          st.lineCap = lcNode.value;
        }
        const ljNode = params.cosDoc.resolve(dictGet(gsDict, "LJ"));
        if (ljNode?.kind === "number" && (ljNode.value === 0 || ljNode.value === 1 || ljNode.value === 2)) {
          st.lineJoin = ljNode.value;
        }
        const mlNode = params.cosDoc.resolve(dictGet(gsDict, "ML"));
        if (mlNode?.kind === "number" && mlNode.value > 0) {
          st.miterLimit = mlNode.value;
        }
        const dArr = params.cosDoc.resolveArray(dictGet(gsDict, "D"));
        if (dArr && dArr.items.length >= 2) {
          const patArr = params.cosDoc.resolveArray(dArr.items[0]);
          const phaseNode = params.cosDoc.resolve(dArr.items[1]);
          if (patArr) {
            const dashArray = patArr.items
              .map(it => {
                const r = params.cosDoc!.resolve(it);
                return r?.kind === "number" ? r.value : 0;
              })
              .filter(n => n >= 0);
            st.dashArray = dashArray.some(value => value > 0) ? dashArray : undefined;
            st.dashPhase = phaseNode?.kind === "number" ? phaseNode.value : 0;
          }
        }
        const fontArr = params.cosDoc.resolveArray(dictGet(gsDict, "Font"));
        if (fontArr && fontArr.items.length >= 2) {
          const fSizeNode = params.cosDoc.resolve(fontArr.items[1]);
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
    actualText?: string
  ): EvaluationWork<boolean> {
    const st = curState(), doc = params.cosDoc;
    if (!st.fillPatternName || !doc || !resources) return false;
    if (depth >= 8) throw new PdfError("E_LIMIT", "Pattern nesting exceeds the form depth limit");
    const patterns = doc.resolveDict(dictGet(resources, "Pattern"));
    const pattern = patterns && doc.resolve(dictGet(patterns, st.fillPatternName));
    const dict = pattern?.kind === "stream" ? pattern.dict : pattern?.kind === "dict" ? pattern : undefined;
    if (!dict) return false;
    const nums = (key: string, fallback: number[]): number[] => {
      const array = doc.resolveArray(dictGet(dict, key));
      return array ? array.items.map((item, i) => {
        const value = doc.resolve(item);
        return value?.kind === "number" ? value.value : fallback[i] ?? 0;
      }) : fallback;
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
    const [originX, originY] = params.origin ?? [0, 0];
    const clip = st.clipRect ?? [originX, originY, originX + params.width, originY + params.height];
    const bounds: [number, number, number, number] = [Math.max(x0, clip[0]!), Math.max(y0, clip[1]!), Math.min(x1, clip[2]!), Math.min(y1, clip[3]!)];
    if (!(bounds[2] > bounds[0] && bounds[3] > bounds[1])) return true;
    // PDFBox TilingPaint / PageDrawer: pattern coordinates start at the
    // containing stream's initial matrix, independently of the text matrix.
    const matrix = multiplyMatrices(nums("Matrix", [1, 0, 0, 1, 0, 0]) as Matrix6, st.initialCtm);
    const type = doc.resolve(dictGet(dict, "PatternType"));
    stateStack.push({ ...st, clipRect: bounds, clipPaths: [...(st.clipPaths ?? []), { segments, fillRule }] });
    try {
      if (type?.kind === "number" && type.value === 2) {
        const shading = doc.resolve(dictGet(dict, "Shading"));
        const shadingDict = shading?.kind === "stream" ? shading.dict : shading?.kind === "dict" ? shading : undefined;
        if (!shadingDict) return false;
        const image = renderShadingDictToImage(doc, shadingDict, matrix, bounds, st.fillAlpha,
          "PatternShading_" + st.fillPatternName, bounds, shading?.kind === "stream" ? shading : undefined, st.blendMode);
        if (image) yield* emit({ kind: "image", value: image });
        return !!image;
      }
      if (pattern?.kind !== "stream") return false;
      const xStepNode = doc.resolve(dictGet(dict, "XStep"));
      const yStepNode = doc.resolve(dictGet(dict, "YStep"));
      const xStep = xStepNode?.kind === "number" ? Math.abs(xStepNode.value) : 0;
      const yStep = yStepNode?.kind === "number" ? Math.abs(yStepNode.value) : 0;
      const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
      if (!xStep || !yStep || !determinant) return true;
      const inverse: Matrix6 = [matrix[3] / determinant, -matrix[1] / determinant, -matrix[2] / determinant,
        matrix[0] / determinant, (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
        (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant];
      const corners = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]]
        .map(([x, y]) => transformPoint(inverse, x!, y!));
      const box = nums("BBox", [0, 0, xStep, yStep]);
      const ix0 = Math.floor((Math.min(...corners.map(p => p[0])) - box[2]!) / xStep) + 1;
      const ix1 = Math.ceil((Math.max(...corners.map(p => p[0])) - box[0]!) / xStep) - 1;
      const iy0 = Math.floor((Math.min(...corners.map(p => p[1])) - box[3]!) / yStep) + 1;
      const iy1 = Math.ceil((Math.max(...corners.map(p => p[1])) - box[1]!) / yStep) - 1;
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > 20000) throw new PdfError("E_LIMIT", "Pattern tile count exceeds 20000");
      const nodes = parseContentStream(doc.decodeStream(pattern));
      const patternResources = doc.resolveDict(dictGet(dict, "Resources")) ?? resources;
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
          try { yield* walkNodes(nodes, mcid, actualText, patternResources, patternFonts, depth + 1); }
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
    const group = params.cosDoc!.resolveDict(dictGet(form.dict, "Group"));
    const groupType = group ? params.cosDoc!.resolve(dictGet(group, "S")) : undefined;
    const isolation = group ? params.cosDoc!.resolve(dictGet(group, "I")) : undefined;
    const isolated = isolation?.kind === "boolean" && isolation.value;
    // PDF.js beginGroup: ordinary non-isolated
    // Forms paint directly, retaining inherited state. Group effects instead
    // apply once to the finished Form, after resetting its inner paint state.
    const compositeGroup = !maskGroup && groupType?.kind === "name" && groupType.decoded === "Transparency" &&
      (isolated || st.fillAlpha !== 1 || !!st.softMask || (!!st.blendMode && st.blendMode !== "Normal" && st.blendMode !== "Compatible"));
    const formStreamBytes = params.cosDoc!.decodeStream(form);
    const formNodes = parseContentStream(formStreamBytes);
    const formResDict = params.cosDoc!.resolveDict(dictGet(form.dict, "Resources")) ?? activeResources;
    const formFonts: FontScope = [formResDict, ...activeFonts];
    let nextCtm: Matrix6 = [...st.ctm] as Matrix6;
    const matArr = params.cosDoc!.resolveArray(dictGet(form.dict, "Matrix"));
    if (matArr && matArr.items.length >= 6) {
      const mn = (idx: number, fb = 0) => {
        const resolved = params.cosDoc!.resolve(matArr.items[idx]);
        return resolved?.kind === "number" ? resolved.value : fb;
      };
      const formMat: Matrix6 = [mn(0, 1), mn(1, 0), mn(2, 0), mn(3, 1), mn(4, 0), mn(5, 0)];
      nextCtm = multiplyMatrices(formMat, nextCtm);
    }
    let nextClip = !compositeGroup && st.clipRect ? ([...st.clipRect] as [number, number, number, number]) : undefined;
    let nextClipPaths = compositeGroup ? undefined : st.clipPaths;
    const bboxArr = params.cosDoc!.resolveArray(dictGet(form.dict, "BBox"));
    if (bboxArr && bboxArr.items.length >= 4) {
      const bn = (idx: number, fb = 0) => {
        const resolved = params.cosDoc!.resolve(bboxArr.items[idx]);
        return resolved?.kind === "number" ? resolved.value : fb;
      };
      const bx0 = bn(0, 0), by0 = bn(1, 0), bx1 = bn(2, 0), by1 = bn(3, 0);
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

  function markedContext(node: Extract<PdfContentNode, { kind: "marked-content" }>,
    mcid: number | undefined, actualText: string | undefined, activeResources: PdfCosDict | undefined
  ): { mcid: number | undefined; actualText: string | undefined } | undefined {
    let resolvedMcid = node.mcid;
    let resolvedActualText = node.actualText;
    if (params.cosDoc && typeof node.properties === "string" && activeResources) {
      const propsMap = params.cosDoc.resolveDict(dictGet(activeResources, "Properties"));
      const propRefOrNode = propsMap ? dictGet(propsMap, node.properties) : undefined;
      if (propRefOrNode) {
        const propDict = params.cosDoc.resolveDict(propRefOrNode);
        const propType = propDict ? params.cosDoc.resolve(dictGet(propDict, "Type")) : undefined;
        const isOcTag =
          node.tag === "OC" ||
          (propType?.kind === "name" && (propType.decoded === "OCG" || propType.decoded === "OCMD"));
        if (isOcTag && !isOptionalContentVisible(params.cosDoc, propRefOrNode)) {
          return undefined;
        }
        if (propDict) {
          if (resolvedActualText === undefined) {
            const at = params.cosDoc.resolve(dictGet(propDict, "ActualText"));
            if (at?.kind === "string") resolvedActualText = decodePdfString(at);
          }
          if (resolvedMcid === undefined) {
            const mc = params.cosDoc.resolve(dictGet(propDict, "MCID"));
            if (mc?.kind === "number") resolvedMcid = mc.value;
          }
        }
      }
    }
    return { mcid: resolvedMcid ?? mcid, actualText: resolvedActualText ?? actualText };
  }

  function* walkNodes(
    nodes: Iterable<PdfContentEvent> | undefined,
    mcid?: number,
    actualText?: string,
    activeResources: PdfCosDict | undefined = params.resourcesDict,
    activeFonts: FontScope = fonts,
    depth = 0
  ): EvaluationWork {
    const groups: Array<{ pushed: boolean; hidden: boolean; mcid: number | undefined; actualText: string | undefined }> = [];
    let hidden = false;
    const iterator = nodes?.[Symbol.iterator]();
    let failed = false, exhausted = false;
    try {
    while (true) {
      const next = iterator?.next();
      if (next?.done) exhausted = true;
      const node = next ? (next.done ? undefined : next.value) : yield { kind: "node" };
      if (!node) break;
      if (!("kind" in node)) throw new TypeError("Expected a PDF content event");
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
          const context = markedContext(node.group, mcid, actualText, activeResources);
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
          const context = markedContext(node, mcid, actualText, activeResources);
          if (context) yield* walkNodes(node.children, context.mcid, context.actualText, activeResources, activeFonts, depth);
          break;
        }

        case "state-op": {
          yield* applyStateOperator(curState(), node.operator, node.operands, activeResources, activeFonts, depth);
          break;
        }

        case "path-op": {
          const st = curState();
          const hasRotOrShear = Math.abs(st.ctm[1]) > 1e-6 || Math.abs(st.ctm[2]) > 1e-6;
          const transformedSegments: PdfPathSegment[] = [];
          for (const seg of node.segments) {
            if (seg.kind === "move") {
              const [x, y] = transformPoint(st.ctm, seg.x, seg.y);
              transformedSegments.push({ kind: "move", x, y });
            } else if (seg.kind === "line") {
              const [x, y] = transformPoint(st.ctm, seg.x, seg.y);
              transformedSegments.push({ kind: "line", x, y });
            } else if (seg.kind === "cubic") {
              const [x1, y1] = transformPoint(st.ctm, seg.x1, seg.y1);
              const [x2, y2] = transformPoint(st.ctm, seg.x2, seg.y2);
              const [x, y] = transformPoint(st.ctm, seg.x, seg.y);
              transformedSegments.push({ kind: "cubic", x1, y1, x2, y2, x, y });
            } else if (seg.kind === "rect") {
              if (hasRotOrShear || seg.width * st.ctm[0] < 0 || seg.height * st.ctm[3] < 0) {
                const [p0x, p0y] = transformPoint(st.ctm, seg.x, seg.y);
                const [p1x, p1y] = transformPoint(st.ctm, seg.x + seg.width, seg.y);
                const [p2x, p2y] = transformPoint(st.ctm, seg.x + seg.width, seg.y + seg.height);
                const [p3x, p3y] = transformPoint(st.ctm, seg.x, seg.y + seg.height);
                transformedSegments.push(
                  { kind: "move", x: p0x, y: p0y },
                  { kind: "line", x: p1x, y: p1y },
                  { kind: "line", x: p2x, y: p2y },
                  { kind: "line", x: p3x, y: p3y },
                  { kind: "close" }
                );
              } else {
                const [x0, y0] = transformPoint(st.ctm, seg.x, seg.y);
                const [x1, y1] = transformPoint(st.ctm, seg.x + seg.width, seg.y + seg.height);
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
          }

          if (["s", "b", "b*"].includes(node.paint) && transformedSegments.length > 0) {
            const lastSeg = transformedSegments[transformedSegments.length - 1]!;
            if (lastSeg.kind !== "close" && lastSeg.kind !== "rect") {
              transformedSegments.push({ kind: "close" });
            }
          }

          const applyClip = () => {
            if (!node.clip) return;
            st.clipPaths = [...(st.clipPaths ?? []), {
              segments: transformedSegments,
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
            node.paint.includes("*") ? "evenodd" : "nonzero", activeResources, activeFonts, depth, mcid, actualText));
          if (evaluatedFillPattern && !isStroke) {
            applyClip();
            break;
          }
          const fillRule = node.paint.includes("*") ? "evenodd" : "nonzero";
          yield* emit({ kind: "path", value: {
            segments: transformedSegments,
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
          if (params.cosDoc && activeResources) {
            const xobjDict = params.cosDoc.resolveDict(dictGet(activeResources, "XObject"));
            const xobjNode = xobjDict ? params.cosDoc.resolve(dictGet(xobjDict, node.name)) : undefined;
            if (xobjNode?.kind === "stream") {
              if (!isOptionalContentVisible(params.cosDoc, dictGet(xobjNode.dict, "OC"))) {
                break;
              }
              const subNode = params.cosDoc.resolve(dictGet(xobjNode.dict, "Subtype"));
              const sub = subNode?.kind === "name" ? subNode.decoded : "";
              if (sub === "Image") {
                const maskNode = params.cosDoc.resolve(dictGet(xobjNode.dict, "ImageMask"));
                const patternMask = !!st.fillPatternName && maskNode?.kind === "boolean" && maskNode.value;
                const decoded = decodeXObjectImageToRgba(
                  params.cosDoc,
                  xobjNode,
                  activeResources,
                  patternMask ? { r: 1, g: 1, b: 1, alpha: 1 } : {
                    r: st.fillColor.r,
                    g: st.fillColor.g,
                    b: st.fillColor.b,
                    alpha: st.fillAlpha,
                  }
                );
                yield* paintImage({
                  name: node.name,
                  matrix: [...st.ctm],
                  width: decoded.width,
                  height: decoded.height,
                  colorSpace: decoded.colorSpace,
                  bitsPerComponent: decoded.bitsPerComponent,
                  decodedRgba: decoded.rgba,
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
          const maskNode = params.cosDoc ? params.cosDoc.resolve(maskEntry) : maskEntry;
          const patternMask = !!st.fillPatternName && maskNode?.kind === "boolean" && maskNode.value;
          const decoded = decodeInlineImageNodeToRgba(
            params.cosDoc,
            node.dict,
            node.data,
            activeResources,
            patternMask ? { r: 1, g: 1, b: 1, alpha: 1 } : {
              r: st.fillColor.r,
              g: st.fillColor.g,
              b: st.fillColor.b,
              alpha: st.fillAlpha,
            }
          );
          yield* paintImage({
            name: "InlineImage",
            matrix: [...st.ctm],
            width: decoded.width,
            height: decoded.height,
            colorSpace: decoded.colorSpace,
            bitsPerComponent: decoded.bitsPerComponent,
            decodedRgba: decoded.rgba,
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
              if (font?.subtype === "Type3" && font.charProcs && params.cosDoc && depth < 8) {
                const gName = font.glyphNames.get(item.charCode) ?? item.unicode;
                const procNode = gName ? params.cosDoc.resolve(dictGet(font.charProcs, gName)) : undefined;
                if (procNode?.kind === "stream") {
                  const fm: Matrix6 = font.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0];
                  const procNodes = parseContentStream(params.cosDoc.decodeStream(procNode));
                  if (!font.widths.has(item.charCode) && procNodes.length > 0) {
                    const firstOp = procNodes[0];
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
                    yield* walkNodes(
                      procNodes,
                      mcid,
                      actualText,
                      font.fontResources ?? activeResources,
                      activeFonts,
                      depth + 1
                    );
                    if (stateStack.length > 1) stateStack.pop();
                    evaluatedType3 = true;
                  }
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
  let failed = false, exhausted = false;
  try {
    let step = work.next();
    while (!step.done) {
      if (step.value.kind === "node") {
        const next = input.next();
        if (next.done) exhausted = true;
        step = work.next(next.done ? undefined : next.value);
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
  finally { closeEvaluationIterators([work, exhausted ? undefined : input], failed); }
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

export function extractPageAnnotations(
  cosDoc: ParsedCosDocument,
  pageDict: PdfCosDict
): PdfLinkAnnotation[] {
  const annotsArr = cosDoc.resolveArray(dictGet(pageDict, "Annots"));
  if (!annotsArr) return [];

  let pageObjToNum: Map<number, number> | undefined;
  const getPageObjMap = (): Map<number, number> => {
    if (pageObjToNum) return pageObjToNum;
    pageObjToNum = new Map<number, number>();
    const catalog = cosDoc.resolveDict(cosDoc.rootRef);
    const pagesNode = catalog ? dictGet(catalog, "Pages") : undefined;
    let pageIdx = 1;
    const visited = new Set<number>();
    const walkPages = (node: import("../ast.js").PdfCosNode | undefined): void => {
      if (!node) return;
      if (node.kind === "ref") {
        if (visited.has(node.objectNumber)) return;
        visited.add(node.objectNumber);
      }
      const d = cosDoc.resolveDict(node);
      if (!d) return;
      const typeName = cosDoc.resolve(dictGet(d, "Type"));
      const kids = cosDoc.resolveArray(dictGet(d, "Kids"));
      if (kids && (typeName?.kind !== "name" || typeName.decoded !== "Page")) {
        for (const k of kids.items) walkPages(k);
      } else {
        if (node.kind === "ref") {
          pageObjToNum!.set(node.objectNumber, pageIdx);
        }
        pageIdx++;
      }
    };
    walkPages(pagesNode);
    return pageObjToNum;
  };

  const resolveDestToPageNum = (destNode: import("../ast.js").PdfCosNode | undefined, depth = 0): number | undefined => {
    if (!destNode || depth > 4) return undefined;
    const resolved = cosDoc.resolve(destNode);
    if (!resolved) return undefined;
    if (resolved.kind === "array" && resolved.items.length > 0) {
      const first = resolved.items[0]!;
      if (first.kind === "ref") {
        return getPageObjMap().get(first.objectNumber);
      }
      const rFirst = cosDoc.resolve(first);
      if (rFirst?.kind === "number") {
        return rFirst.value + 1;
      }
    }
    if (resolved.kind === "dict") {
      return resolveDestToPageNum(dictGet(resolved, "D"), depth + 1);
    }
    if (resolved.kind === "name" || resolved.kind === "string") {
      const destName = resolved.kind === "name" ? resolved.decoded : decodePdfString(resolved);
      const catalog = cosDoc.resolveDict(cosDoc.rootRef);
      if (catalog) {
        const destsDict = cosDoc.resolveDict(dictGet(catalog, "Dests"));
        if (destsDict) {
          const found = dictGet(destsDict, destName);
          if (found) return resolveDestToPageNum(found, depth + 1);
        }
        const namesDict = cosDoc.resolveDict(dictGet(catalog, "Names"));
        const destsTree = namesDict ? cosDoc.resolveDict(dictGet(namesDict, "Dests")) : undefined;
        const searchNameTree = (treeDict: PdfCosDict | undefined): import("../ast.js").PdfCosNode | undefined => {
          if (!treeDict) return undefined;
          const namesArr = cosDoc.resolveArray(dictGet(treeDict, "Names"));
          if (namesArr) {
            for (let i = 0; i + 1 < namesArr.items.length; i += 2) {
              const kNode = cosDoc.resolve(namesArr.items[i]);
              const kStr = kNode?.kind === "string" ? decodePdfString(kNode) : kNode?.kind === "name" ? kNode.decoded : "";
              if (kStr === destName) return namesArr.items[i + 1];
            }
          }
          const kidsArr = cosDoc.resolveArray(dictGet(treeDict, "Kids"));
          if (kidsArr) {
            for (const kid of kidsArr.items) {
              const res = searchNameTree(cosDoc.resolveDict(kid));
              if (res) return res;
            }
          }
          return undefined;
        };
        const treeFound = searchNameTree(destsTree);
        if (treeFound) return resolveDestToPageNum(treeFound, depth + 1);
      }
    }
    return undefined;
  };

  const out: PdfLinkAnnotation[] = [];
  for (const item of annotsArr.items) {
    const dict = cosDoc.resolveDict(item);
    if (!dict) continue;
    const rectArr = cosDoc.resolveArray(dictGet(dict, "Rect"));
    if (!rectArr || rectArr.items.length < 4) continue;
    const r0 = cosDoc.resolve(rectArr.items[0]);
    const r1 = cosDoc.resolve(rectArr.items[1]);
    const r2 = cosDoc.resolve(rectArr.items[2]);
    const r3 = cosDoc.resolve(rectArr.items[3]);
    const rect: [number, number, number, number] = [
      r0?.kind === "number" ? r0.value : 0,
      r1?.kind === "number" ? r1.value : 0,
      r2?.kind === "number" ? r2.value : 0,
      r3?.kind === "number" ? r3.value : 0,
    ];
    const aDict = cosDoc.resolveDict(dictGet(dict, "A"));
    let uri: string | undefined;
    if (aDict) {
      const uNode = cosDoc.resolve(dictGet(aDict, "URI"));
      if (uNode?.kind === "string") uri = decodePdfString(uNode);
      if (!uri) {
        const sNode = cosDoc.resolve(dictGet(aDict, "S"));
        if (!sNode || (sNode.kind === "name" && sNode.decoded === "GoTo")) {
          const targetPage = resolveDestToPageNum(dictGet(aDict, "D"));
          if (targetPage !== undefined) uri = `#page${targetPage}`;
        }
      }
    }
    if (!uri) {
      const targetPage = resolveDestToPageNum(dictGet(dict, "Dest"));
      if (targetPage !== undefined) uri = `#page${targetPage}`;
    }
    const contentsNode = cosDoc.resolve(dictGet(dict, "Contents"));
    const contents = contentsNode?.kind === "string" ? decodePdfString(contentsNode) : undefined;
    out.push({ rect, uri, contents });
  }
  return out;
}
