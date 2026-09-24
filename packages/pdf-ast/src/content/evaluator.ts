import {
  decodePdfString,
  dictGet,
  type PdfContentNode,
  type PdfCosDict,
  type PdfDisplayList,
  type PdfEvaluatedImage,
  type PdfEvaluatedPath,
  type PdfLinkAnnotation,
  type PdfPathSegment,
  type PdfPlacedGlyph,
  type PdfRgbColor,
} from "../ast.js";
import type { ParsedCosDocument } from "../cos/parser.js";
import { parseToUnicodeCMap, type ParsedToUnicodeCMap } from "../fonts/cmap.js";
import { parseContentStream } from "./parser.js";
import {
  buildFontEncodingDifferencesMap,
  decodeWinAnsiByte,
  normalizeStandard14FontName,
  STANDARD_14_FONTS,
} from "../fonts/standard14.js";

type Matrix6 = [number, number, number, number, number, number];

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

interface ResolvedPageFont {
  readonly name: string;
  readonly baseFont: string;
  readonly isTwoByteCid: boolean;
  readonly cmap?: ParsedToUnicodeCMap | undefined;
  readonly differences: ReadonlyMap<number, string>;
  readonly widths: ReadonlyMap<number, number>;
  readonly defaultWidth: number;
}

function resolvePageFonts(doc: ParsedCosDocument | undefined, resourcesDict: PdfCosDict | undefined): Map<string, ResolvedPageFont> {
  const fonts = new Map<string, ResolvedPageFont>();
  if (!doc || !resourcesDict) return fonts;
  const fontDict = doc.resolveDict(dictGet(resourcesDict, "Font"));
  if (!fontDict) return fonts;

  for (const entry of fontDict.entries) {
    const fName = entry.key.decoded;
    const fObj = doc.resolveDict(entry.value);
    if (!fObj) continue;

    const subtypeNode = doc.resolve(dictGet(fObj, "Subtype"));
    const subtype = subtypeNode?.kind === "name" ? subtypeNode.decoded : "Type1";
    const baseFontNode = doc.resolve(dictGet(fObj, "BaseFont"));
    const baseFont = baseFontNode?.kind === "name" ? baseFontNode.decoded : "Helvetica";

    let cmap: ParsedToUnicodeCMap | undefined;
    const toUniNode = doc.resolve(dictGet(fObj, "ToUnicode"));
    if (toUniNode?.kind === "stream") {
      cmap = parseToUnicodeCMap(doc.decodeStream(toUniNode));
    }

    const encNode = doc.resolve(dictGet(fObj, "Encoding"));
    const differences = buildFontEncodingDifferencesMap(encNode);
    const widths = new Map<number, number>();
    let defaultWidth = 556;
    const isTwoByteCid = subtype === "Type0" || Boolean(cmap?.isTwoByte);

    if (subtype === "Type0") {
      const descArr = doc.resolveArray(dictGet(fObj, "DescendantFonts"));
      const cidDict = descArr && descArr.items[0] ? doc.resolveDict(descArr.items[0]) : undefined;
      if (cidDict) {
        const dwNode = doc.resolve(dictGet(cidDict, "DW"));
        if (dwNode?.kind === "number") defaultWidth = dwNode.value;
        const wArr = doc.resolveArray(dictGet(cidDict, "W"));
        if (wArr) {
          let idx = 0;
          while (idx < wArr.items.length) {
            const first = doc.resolve(wArr.items[idx++]);
            const second = doc.resolve(wArr.items[idx++]);
            if (first?.kind === "number" && second?.kind === "array") {
              for (let k = 0; k < second.items.length; k++) {
                const wItem = doc.resolve(second.items[k]);
                if (wItem?.kind === "number") {
                  widths.set(first.value + k, wItem.value);
                }
              }
            } else if (first?.kind === "number" && second?.kind === "number") {
              const third = doc.resolve(wArr.items[idx++]);
              if (third?.kind === "number") {
                for (let c = first.value; c <= second.value; c++) {
                  widths.set(c, third.value);
                }
              }
            }
          }
        }
      }
    } else {
      const stdName = normalizeStandard14FontName(baseFont);
      const stdMetrics = STANDARD_14_FONTS[stdName];
      defaultWidth = stdMetrics.defaultWidth;
      for (const [codeStr, wVal] of Object.entries(stdMetrics.widthsByCode)) {
        widths.set(Number(codeStr), wVal);
      }
      const firstCharNode = doc.resolve(dictGet(fObj, "FirstChar"));
      const widthsArr = doc.resolveArray(dictGet(fObj, "Widths"));
      if (firstCharNode?.kind === "number" && widthsArr) {
        for (let k = 0; k < widthsArr.items.length; k++) {
          const wItem = doc.resolve(widthsArr.items[k]);
          if (wItem?.kind === "number") {
            widths.set(firstCharNode.value + k, wItem.value);
          }
        }
      }
    }

    fonts.set(fName, {
      name: fName,
      baseFont,
      isTwoByteCid,
      cmap,
      differences,
      widths,
      defaultWidth,
    });
  }

  return fonts;
}

interface GraphicsState {
  ctm: Matrix6;
  strokeColor: PdfRgbColor;
  fillColor: PdfRgbColor;
  strokeWidth: number;
  fontName: string;
  fontSize: number;
  charSpace: number;
  wordSpace: number;
  horizScale: number;
  leading: number;
  rise: number;
}

export function evaluateContentStreamToDisplayList(params: {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: 0 | 90 | 180 | 270 | undefined;
  readonly nodes: readonly PdfContentNode[];
  readonly cosDoc?: ParsedCosDocument | undefined;
  readonly resourcesDict?: PdfCosDict | undefined;
  readonly annotations?: readonly PdfLinkAnnotation[] | undefined;
}): PdfDisplayList {
  const fonts = resolvePageFonts(params.cosDoc, params.resourcesDict);
  const glyphs: PdfPlacedGlyph[] = [];
  const paths: PdfEvaluatedPath[] = [];
  const images: PdfEvaluatedImage[] = [];

  const initialState: GraphicsState = {
    ctm: [1, 0, 0, 1, 0, 0],
    strokeColor: { r: 0, g: 0, b: 0 },
    fillColor: { r: 0, g: 0, b: 0 },
    strokeWidth: 1,
    fontName: "Helvetica",
    fontSize: 12,
    charSpace: 0,
    wordSpace: 0,
    horizScale: 100,
    leading: 14,
    rise: 0,
  };

  const stateStack: GraphicsState[] = [initialState];
  const curState = (): GraphicsState => stateStack[stateStack.length - 1]!;

  const decodeTokenGlyphs = (
    bytes: Uint8Array,
    font: ResolvedPageFont | undefined
  ): Array<{ charCode: number; unicode: string; advance1000: number }> => {
    if (font?.cmap) {
      const decoded = font.cmap.decodeBytes(bytes);
      return decoded.map(item => ({
        charCode: item.charCode,
        unicode: item.unicode,
        advance1000: font.widths.get(item.charCode) ?? font.defaultWidth,
      }));
    }
    if (font?.isTwoByteCid && bytes.length >= 2 && bytes.length % 2 === 0) {
      const out: Array<{ charCode: number; unicode: string; advance1000: number }> = [];
      for (let i = 0; i < bytes.length; i += 2) {
        const cid = (bytes[i]! << 8) | bytes[i + 1]!;
        out.push({
          charCode: cid,
          unicode: cid >= 0x20 ? String.fromCodePoint(cid) : "",
          advance1000: font.widths.get(cid) ?? font.defaultWidth,
        });
      }
      return out;
    }
    const stdName = normalizeStandard14FontName(font?.baseFont ?? curState().fontName);
    const stdMetrics = STANDARD_14_FONTS[stdName];
    const out: Array<{ charCode: number; unicode: string; advance1000: number }> = [];
    for (let i = 0; i < bytes.length; i++) {
      const code = bytes[i]!;
      const unicode = font?.differences.get(code) ?? decodeWinAnsiByte(code);
      const advance1000 = font?.widths.get(code) ?? stdMetrics.widthsByCode[code] ?? stdMetrics.defaultWidth;
      out.push({ charCode: code, unicode, advance1000 });
    }
    return out;
  };

  const walkNodes = (
    nodes: readonly PdfContentNode[],
    mcid?: number,
    actualText?: string,
    activeResources: PdfCosDict | undefined = params.resourcesDict,
    activeFonts: Map<string, ResolvedPageFont> = fonts,
    depth = 0
  ): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case "graphics-group":
          stateStack.push({ ...curState(), ctm: [...curState().ctm] as Matrix6 });
          walkNodes(node.ops, mcid, actualText, activeResources, activeFonts, depth);
          if (stateStack.length > 1) stateStack.pop();
          break;

        case "marked-content":
          walkNodes(
            node.children,
            node.mcid ?? mcid,
            node.actualText ?? actualText,
            activeResources,
            activeFonts,
            depth
          );
          break;

        case "state-op": {
          const st = curState();
          const ops = node.operands;
          const num = (i: number, fb = 0) => (ops[i]?.kind === "number" ? ops[i]!.value : fb);
          if (node.operator === "cm") {
            const m: Matrix6 = [num(0, 1), num(1, 0), num(2, 0), num(3, 1), num(4, 0), num(5, 0)];
            st.ctm = multiplyMatrices(m, st.ctm);
          } else if (node.operator === "w") {
            st.strokeWidth = num(0, 1);
          } else if (node.operator === "g") {
            const v = num(0, 0);
            st.fillColor = { r: v, g: v, b: v };
          } else if (node.operator === "G") {
            const v = num(0, 0);
            st.strokeColor = { r: v, g: v, b: v };
          } else if (node.operator === "rg" || node.operator === "sc" || node.operator === "scn") {
            if (ops.length >= 3) {
              st.fillColor = { r: num(0), g: num(1), b: num(2) };
            } else if (ops.length === 1) {
              const v = num(0);
              st.fillColor = { r: v, g: v, b: v };
            }
          } else if (node.operator === "RG" || node.operator === "SC" || node.operator === "SCN") {
            if (ops.length >= 3) {
              st.strokeColor = { r: num(0), g: num(1), b: num(2) };
            } else if (ops.length === 1) {
              const v = num(0);
              st.strokeColor = { r: v, g: v, b: v };
            }
          } else if (node.operator === "k") {
            const c = num(0), m = num(1), y = num(2), k = num(3);
            st.fillColor = { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
          } else if (node.operator === "K") {
            const c = num(0), m = num(1), y = num(2), k = num(3);
            st.strokeColor = { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
          }
          break;
        }

        case "path-op": {
          if (node.paint === "n") break;
          const st = curState();
          const transformedSegments: PdfPathSegment[] = node.segments.map(seg => {
            if (seg.kind === "move") {
              const [x, y] = transformPoint(st.ctm, seg.x, seg.y);
              return { kind: "move", x, y };
            }
            if (seg.kind === "line") {
              const [x, y] = transformPoint(st.ctm, seg.x, seg.y);
              return { kind: "line", x, y };
            }
            if (seg.kind === "cubic") {
              const [x1, y1] = transformPoint(st.ctm, seg.x1, seg.y1);
              const [x2, y2] = transformPoint(st.ctm, seg.x2, seg.y2);
              const [x, y] = transformPoint(st.ctm, seg.x, seg.y);
              return { kind: "cubic", x1, y1, x2, y2, x, y };
            }
            if (seg.kind === "rect") {
              const [x0, y0] = transformPoint(st.ctm, seg.x, seg.y);
              const [x1, y1] = transformPoint(st.ctm, seg.x + seg.width, seg.y + seg.height);
              return {
                kind: "rect",
                x: Math.min(x0, x1),
                y: Math.min(y0, y1),
                width: Math.abs(x1 - x0),
                height: Math.abs(y1 - y0),
              };
            }
            return seg;
          });

          const isFill = ["f", "F", "f*", "B", "B*", "b", "b*"].includes(node.paint);
          const isStroke = ["S", "s", "B", "B*", "b", "b*"].includes(node.paint);
          const fillRule = node.paint.includes("*") ? "evenodd" : "nonzero";
          paths.push({
            segments: transformedSegments,
            fillColor: isFill ? st.fillColor : undefined,
            strokeColor: isStroke ? st.strokeColor : undefined,
            strokeWidth: st.strokeWidth,
            fillRule,
          });
          break;
        }

        case "xobject": {
          const st = curState();
          if (params.cosDoc && activeResources) {
            const xobjDict = params.cosDoc.resolveDict(dictGet(activeResources, "XObject"));
            const xobjNode = xobjDict ? params.cosDoc.resolve(dictGet(xobjDict, node.name)) : undefined;
            if (xobjNode?.kind === "stream") {
              const subNode = params.cosDoc.resolve(dictGet(xobjNode.dict, "Subtype"));
              const sub = subNode?.kind === "name" ? subNode.decoded : "";
              if (sub === "Image") {
                const wNode = params.cosDoc.resolve(dictGet(xobjNode.dict, "Width"));
                const hNode = params.cosDoc.resolve(dictGet(xobjNode.dict, "Height"));
                const bpcNode = params.cosDoc.resolve(dictGet(xobjNode.dict, "BitsPerComponent"));
                const csNode = params.cosDoc.resolve(dictGet(xobjNode.dict, "ColorSpace"));
                const w = wNode?.kind === "number" ? wNode.value : 1;
                const h = hNode?.kind === "number" ? hNode.value : 1;
                const bpc = bpcNode?.kind === "number" ? bpcNode.value : 8;
                let cs = "DeviceRGB";
                if (csNode?.kind === "name") {
                  cs = csNode.decoded;
                } else if (csNode?.kind === "array" && csNode.items.length > 0) {
                  const csFirst = params.cosDoc.resolve(csNode.items[0]);
                  if (csFirst?.kind === "name") cs = csFirst.decoded;
                }
                const rawSamples = params.cosDoc.decodeStream(xobjNode);
                const rgba = new Uint8Array(w * h * 4);
                if ((cs === "DeviceRGB" || cs === "ICCBased") && rawSamples.length >= w * h * 3) {
                  for (let p = 0; p < w * h; p++) {
                    rgba[p * 4] = rawSamples[p * 3]!;
                    rgba[p * 4 + 1] = rawSamples[p * 3 + 1]!;
                    rgba[p * 4 + 2] = rawSamples[p * 3 + 2]!;
                    rgba[p * 4 + 3] = 255;
                  }
                } else if (cs === "DeviceGray" && rawSamples.length >= w * h) {
                  for (let p = 0; p < w * h; p++) {
                    const g = rawSamples[p]!;
                    rgba[p * 4] = g;
                    rgba[p * 4 + 1] = g;
                    rgba[p * 4 + 2] = g;
                    rgba[p * 4 + 3] = 255;
                  }
                } else if (cs === "DeviceGray" && bpc === 1) {
                  const rowBytes = Math.ceil(w / 8);
                  for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                      const byteIdx = y * rowBytes + (x >> 3);
                      const bit = ((rawSamples[byteIdx] ?? 0) >> (7 - (x & 7))) & 1;
                      const g = bit ? 255 : 0;
                      const p = y * w + x;
                      rgba[p * 4] = g;
                      rgba[p * 4 + 1] = g;
                      rgba[p * 4 + 2] = g;
                      rgba[p * 4 + 3] = 255;
                    }
                  }
                } else if (cs === "DeviceCMYK" && rawSamples.length >= w * h * 4) {
                  for (let p = 0; p < w * h; p++) {
                    const c = rawSamples[p * 4]! / 255;
                    const m = rawSamples[p * 4 + 1]! / 255;
                    const y = rawSamples[p * 4 + 2]! / 255;
                    const k = rawSamples[p * 4 + 3]! / 255;
                    rgba[p * 4] = Math.round((1 - c) * (1 - k) * 255);
                    rgba[p * 4 + 1] = Math.round((1 - m) * (1 - k) * 255);
                    rgba[p * 4 + 2] = Math.round((1 - y) * (1 - k) * 255);
                    rgba[p * 4 + 3] = 255;
                  }
                }
                const smaskNode = params.cosDoc.resolve(dictGet(xobjNode.dict, "SMask"));
                if (smaskNode?.kind === "stream") {
                  const alphaSamples = params.cosDoc.decodeStream(smaskNode);
                  if (alphaSamples.length >= w * h) {
                    for (let p = 0; p < w * h; p++) {
                      rgba[p * 4 + 3] = alphaSamples[p]!;
                    }
                  }
                }
                images.push({
                  name: node.name,
                  matrix: [...st.ctm],
                  width: w,
                  height: h,
                  colorSpace: cs,
                  bitsPerComponent: bpc,
                  decodedRgba: rgba,
                });
              } else if (sub === "Form" && depth < 8) {
                const formStreamBytes = params.cosDoc.decodeStream(xobjNode);
                const formNodes = parseContentStream(formStreamBytes);
                const formResDict = params.cosDoc.resolveDict(dictGet(xobjNode.dict, "Resources")) ?? activeResources;
                const formFonts = new Map<string, ResolvedPageFont>(activeFonts);
                for (const [k, v] of resolvePageFonts(params.cosDoc, formResDict).entries()) {
                  formFonts.set(k, v);
                }
                let nextCtm: Matrix6 = [...st.ctm] as Matrix6;
                const matArr = params.cosDoc.resolveArray(dictGet(xobjNode.dict, "Matrix"));
                if (matArr && matArr.items.length >= 6) {
                  const mn = (idx: number, fb = 0) => {
                    const resolved = params.cosDoc!.resolve(matArr.items[idx]);
                    return resolved?.kind === "number" ? resolved.value : fb;
                  };
                  const formMat: Matrix6 = [mn(0, 1), mn(1, 0), mn(2, 0), mn(3, 1), mn(4, 0), mn(5, 0)];
                  nextCtm = multiplyMatrices(formMat, nextCtm);
                }
                stateStack.push({ ...st, ctm: nextCtm });
                walkNodes(formNodes, mcid, actualText, formResDict, formFonts, depth + 1);
                if (stateStack.length > 1) stateStack.pop();
              }
            }
          }
          break;
        }

        case "inline-image": {
          const st = curState();
          const wNode = dictGet(node.dict, "W") ?? dictGet(node.dict, "Width");
          const hNode = dictGet(node.dict, "H") ?? dictGet(node.dict, "Height");
          const bpcNode = dictGet(node.dict, "BPC") ?? dictGet(node.dict, "BitsPerComponent");
          const csNode = dictGet(node.dict, "CS") ?? dictGet(node.dict, "ColorSpace");
          const w = wNode?.kind === "number" ? wNode.value : 1;
          const h = hNode?.kind === "number" ? hNode.value : 1;
          const bpc = bpcNode?.kind === "number" ? bpcNode.value : 8;
          const csRaw = csNode?.kind === "name" ? csNode.decoded : "DeviceRGB";
          const cs = csRaw === "RGB" ? "DeviceRGB" : csRaw === "G" ? "DeviceGray" : csRaw === "CMYK" ? "DeviceCMYK" : csRaw;
          const rgba = new Uint8Array(w * h * 4);
          if (cs === "DeviceRGB" && node.data.length >= w * h * 3) {
            for (let p = 0; p < w * h; p++) {
              rgba[p * 4] = node.data[p * 3]!;
              rgba[p * 4 + 1] = node.data[p * 3 + 1]!;
              rgba[p * 4 + 2] = node.data[p * 3 + 2]!;
              rgba[p * 4 + 3] = 255;
            }
          } else if (cs === "DeviceGray" && node.data.length >= w * h) {
            for (let p = 0; p < w * h; p++) {
              const g = node.data[p]!;
              rgba[p * 4] = g;
              rgba[p * 4 + 1] = g;
              rgba[p * 4 + 2] = g;
              rgba[p * 4 + 3] = 255;
            }
          }
          images.push({
            name: "InlineImage",
            matrix: [...st.ctm],
            width: w,
            height: h,
            colorSpace: cs,
            bitsPerComponent: bpc,
            decodedRgba: rgba,
          });
          break;
        }

        case "text-object": {
          const st = curState();
          let tm: Matrix6 = [1, 0, 0, 1, 0, 0];
          let tlm: Matrix6 = [1, 0, 0, 1, 0, 0];

          const emitTokenBytes = (bytes: Uint8Array) => {
            const font = activeFonts.get(st.fontName) ?? fonts.get(st.fontName);
            const decoded = decodeTokenGlyphs(bytes, font);
            const scaleH = st.horizScale / 100;
            for (const item of decoded) {
              const totalMatrix = multiplyMatrices(tm, st.ctm);
              const [px, py] = [totalMatrix[4], totalMatrix[5] + st.rise];
              const effectiveFontSize = st.fontSize * Math.hypot(totalMatrix[0], totalMatrix[1]);
              const advUser = ((item.advance1000 * st.fontSize) / 1000 + st.charSpace + (item.unicode === " " ? st.wordSpace : 0)) * scaleH;
              const [nextX] = transformPoint(totalMatrix, advUser / Math.max(0.001, Math.hypot(tm[0], tm[1])), 0);
              const glyphWidth = Math.max(Math.abs(nextX - px), (item.advance1000 * effectiveFontSize) / 1000);
              glyphs.push({
                charCode: item.charCode,
                unicode: item.unicode,
                fontName: font?.baseFont ?? st.fontName,
                fontSize: effectiveFontSize,
                bbox: [px, py - effectiveFontSize * 0.2, px + glyphWidth, py + effectiveFontSize * 0.8],
                baselineY: py,
                advanceWidth: glyphWidth,
                matrix: totalMatrix,
                color: st.fillColor,
                mcid,
                actualText,
              });
              tm = multiplyMatrices([1, 0, 0, 1, advUser, 0], tm);
            }
          };

          for (const cmd of node.commands) {
            switch (cmd.kind) {
              case "font":
                st.fontName = cmd.fontName;
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
              case "show-text":
                emitTokenBytes(cmd.token.bytes);
                break;
              case "show-text-array":
                for (const part of cmd.items) {
                  if (part.kind === "string") {
                    emitTokenBytes(part.bytes);
                  } else if (part.kind === "number") {
                    const shiftUser = ((-part.value * st.fontSize) / 1000) * (st.horizScale / 100);
                    tm = multiplyMatrices([1, 0, 0, 1, shiftUser, 0], tm);
                  }
                }
                break;
            }
          }
          break;
        }
      }
    }
  };

  walkNodes(params.nodes);

  return {
    pageIndex: params.pageIndex,
    width: params.width,
    height: params.height,
    rotation: params.rotation ?? 0,
    glyphs,
    paths,
    images,
    annotations: params.annotations ? [...params.annotations] : [],
  };
}

export function extractPageAnnotations(
  cosDoc: ParsedCosDocument,
  pageDict: PdfCosDict
): PdfLinkAnnotation[] {
  const annotsArr = cosDoc.resolveArray(dictGet(pageDict, "Annots"));
  if (!annotsArr) return [];
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
    }
    const contentsNode = cosDoc.resolve(dictGet(dict, "Contents"));
    const contents = contentsNode?.kind === "string" ? decodePdfString(contentsNode) : undefined;
    out.push({ rect, uri, contents });
  }
  return out;
}
