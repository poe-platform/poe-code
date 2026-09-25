import { decodeInlineImageNodeToRgba, decodeXObjectImageToRgba } from "../extract/images.js";
import {
  decodePdfString,
  dictGet,
  dictSet,
  type PdfContentNode,
  type PdfCosDict,
  type PdfDictEntry,
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
import { parseTrueTypeFont, type ParsedTrueTypeFont } from "../fonts/truetype.js";
import { parseContentStream } from "./parser.js";
import {
  buildFontEncodingDifferencesMap,
  buildFontEncodingGlyphNamesMap,
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
  readonly subtype: string;
  readonly isTwoByteCid: boolean;
  readonly cmap?: ParsedToUnicodeCMap | undefined;
  readonly differences: ReadonlyMap<number, string>;
  readonly glyphNames: ReadonlyMap<number, string>;
  readonly widths: ReadonlyMap<number, number>;
  readonly defaultWidth: number;
  readonly fontMatrix?: Matrix6 | undefined;
  readonly charProcs?: PdfCosDict | undefined;
  readonly fontResources?: PdfCosDict | undefined;
  readonly embeddedTrueType?: ParsedTrueTypeFont | undefined;
}

function resolvePageFonts(doc: ParsedCosDocument | undefined, resourcesDict: PdfCosDict | undefined): Map<string, ResolvedPageFont> {
  const fonts = new Map<string, ResolvedPageFont>();
  if (!doc) return fonts;

  const fontEntries: PdfDictEntry[] = [];
  const catalog = doc.resolveDict(doc.rootRef);
  const acroForm = catalog ? doc.resolveDict(dictGet(catalog, "AcroForm")) : undefined;
  const drDict = acroForm ? doc.resolveDict(dictGet(acroForm, "DR")) : undefined;
  const drFontDict = drDict ? doc.resolveDict(dictGet(drDict, "Font")) : undefined;
  if (drFontDict) {
    fontEntries.push(...drFontDict.entries);
  }
  const pageFontDict = resourcesDict ? doc.resolveDict(dictGet(resourcesDict, "Font")) : undefined;
  if (pageFontDict) {
    fontEntries.push(...pageFontDict.entries);
  }
  if (fontEntries.length === 0) return fonts;

  for (const entry of fontEntries) {
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
    if (encNode?.kind === "dict") {
      const diffRef = dictGet(encNode, "Differences");
      if (diffRef?.kind === "ref") {
        const resolvedDiff = doc.resolve(diffRef);
        if (resolvedDiff?.kind === "array") {
          dictSet(encNode, "Differences", resolvedDiff);
        }
      }
    }
    const differences = buildFontEncodingDifferencesMap(encNode);
    const glyphNames = buildFontEncodingGlyphNamesMap(encNode);
    const widths = new Map<number, number>();
    let defaultWidth = 556;
    const isTwoByteCid = subtype === "Type0" || Boolean(cmap?.isTwoByte);

    let fontMatrix: Matrix6 | undefined;
    let charProcs: PdfCosDict | undefined;
    let fontResources: PdfCosDict | undefined;
    if (subtype === "Type3") {
      const fmArr = doc.resolveArray(dictGet(fObj, "FontMatrix"));
      if (fmArr && fmArr.items.length >= 6) {
        const mn = (idx: number, fb = 0) => {
          const r = doc.resolve(fmArr.items[idx]);
          return r?.kind === "number" ? r.value : fb;
        };
        fontMatrix = [mn(0, 0.001), mn(1, 0), mn(2, 0), mn(3, 0.001), mn(4, 0), mn(5, 0)];
      } else {
        fontMatrix = [0.001, 0, 0, 0.001, 0, 0];
      }
      charProcs = doc.resolveDict(dictGet(fObj, "CharProcs"));
      fontResources = doc.resolveDict(dictGet(fObj, "Resources"));
    }
    const type3Scale1000 =
      subtype === "Type3" && fontMatrix
        ? Math.hypot(fontMatrix[0], fontMatrix[1]) * 1000
        : 1;

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
            widths.set(firstCharNode.value + k, wItem.value * type3Scale1000);
          }
        }
      }
    }

    let embeddedTrueType: ParsedTrueTypeFont | undefined;
    const fDescDirect = doc.resolveDict(dictGet(fObj, "FontDescriptor"));
    const descArrForTt = subtype === "Type0" ? doc.resolveArray(dictGet(fObj, "DescendantFonts")) : undefined;
    const cidDictForTt = descArrForTt && descArrForTt.items[0] ? doc.resolveDict(descArrForTt.items[0]) : undefined;
    const fDesc = fDescDirect ?? (cidDictForTt ? doc.resolveDict(dictGet(cidDictForTt, "FontDescriptor")) : undefined);
    if (fDesc) {
      const ff2Node = doc.resolve(dictGet(fDesc, "FontFile2")) ?? doc.resolve(dictGet(fDesc, "FontFile3"));
      if (ff2Node?.kind === "stream") {
        embeddedTrueType = parseTrueTypeFont(doc.decodeStream(ff2Node));
      }
    }

    fonts.set(fName, {
      name: fName,
      baseFont,
      subtype,
      isTwoByteCid,
      cmap,
      differences,
      glyphNames,
      widths,
      defaultWidth,
      fontMatrix,
      charProcs,
      fontResources,
      embeddedTrueType,
    });
  }

  return fonts;
}

interface GraphicsState {
  ctm: Matrix6;
  strokeColor: PdfRgbColor;
  fillColor: PdfRgbColor;
  strokeAlpha: number;
  fillAlpha: number;
  strokeWidth: number;
  lineCap: 0 | 1 | 2;
  lineJoin: 0 | 1 | 2;
  miterLimit: number;
  fontName: string;
  fontSize: number;
  charSpace: number;
  wordSpace: number;
  horizScale: number;
  leading: number;
  rise: number;
  textRenderMode: number;
  fillColorSpaceName: string;
  strokeColorSpaceName: string;
  clipRect?: [number, number, number, number] | undefined;
  dashArray?: readonly number[] | undefined;
  dashPhase?: number | undefined;
  fillPatternName?: string | undefined;
  blendMode?: string | undefined;
}

function evaluateType4PostScriptTokens(tokens: readonly string[], initialStack: readonly number[]): number[] {
  const stack: number[] = [...initialStack];
  const runRange = (start: number, end: number): void => {
    let i = start;
    while (i < end) {
      const tok = tokens[i]!;
      if (tok === "{") {
        let depth = 1;
        let j = i + 1;
        while (j < end && depth > 0) {
          if (tokens[j] === "{") depth++;
          else if (tokens[j] === "}") depth--;
          j++;
        }
        const blockStart = i + 1;
        const blockEnd = j - 1;
        if (j < end && tokens[j] === "{") {
          let depth2 = 1;
          let k = j + 1;
          while (k < end && depth2 > 0) {
            if (tokens[k] === "{") depth2++;
            else if (tokens[k] === "}") depth2--;
            k++;
          }
          if (k < end && tokens[k] === "ifelse") {
            const cond = stack.pop() ?? 0;
            if (cond !== 0) runRange(blockStart, blockEnd);
            else runRange(j + 1, k - 1);
            i = k + 1;
            continue;
          }
        }
        if (j < end && tokens[j] === "if") {
          const cond = stack.pop() ?? 0;
          if (cond !== 0) runRange(blockStart, blockEnd);
          i = j + 1;
          continue;
        }
        runRange(blockStart, blockEnd);
        i = j;
        continue;
      }
      if (tok === "}") {
        i++;
        continue;
      }
      const numVal = Number(tok);
      if (tok.length > 0 && !Number.isNaN(numVal)) {
        stack.push(numVal);
      } else if (tok === "true") {
        stack.push(1);
      } else if (tok === "false") {
        stack.push(0);
      } else if (tok === "add") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(a + b);
      } else if (tok === "sub") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(a - b);
      } else if (tok === "mul") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(a * b);
      } else if (tok === "div") {
        const b = stack.pop() ?? 1, a = stack.pop() ?? 0;
        stack.push(Math.abs(b) > 1e-12 ? a / b : 0);
      } else if (tok === "idiv") {
        const b = stack.pop() ?? 1, a = stack.pop() ?? 0;
        stack.push(Math.abs(b) > 1e-12 ? Math.trunc(a / b) : 0);
      } else if (tok === "mod") {
        const b = stack.pop() ?? 1, a = stack.pop() ?? 0;
        stack.push(Math.abs(b) > 1e-12 ? a % b : 0);
      } else if (tok === "neg") {
        stack.push(-(stack.pop() ?? 0));
      } else if (tok === "abs") {
        stack.push(Math.abs(stack.pop() ?? 0));
      } else if (tok === "ceiling") {
        stack.push(Math.ceil(stack.pop() ?? 0));
      } else if (tok === "floor") {
        stack.push(Math.floor(stack.pop() ?? 0));
      } else if (tok === "round") {
        stack.push(Math.round(stack.pop() ?? 0));
      } else if (tok === "truncate" || tok === "cvi") {
        stack.push(Math.trunc(stack.pop() ?? 0));
      } else if (tok === "sqrt") {
        stack.push(Math.sqrt(Math.max(0, stack.pop() ?? 0)));
      } else if (tok === "sin") {
        stack.push(Math.sin(((stack.pop() ?? 0) * Math.PI) / 180));
      } else if (tok === "cos") {
        stack.push(Math.cos(((stack.pop() ?? 0) * Math.PI) / 180));
      } else if (tok === "atan") {
        const dx = stack.pop() ?? 1, dy = stack.pop() ?? 0;
        let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (deg < 0) deg += 360;
        stack.push(deg);
      } else if (tok === "exp") {
        const exp = stack.pop() ?? 1, base = stack.pop() ?? 0;
        stack.push(Math.pow(base, exp));
      } else if (tok === "ln") {
        stack.push(Math.log(Math.max(1e-12, stack.pop() ?? 1)));
      } else if (tok === "log") {
        stack.push(Math.log10(Math.max(1e-12, stack.pop() ?? 1)));
      } else if (tok === "dup") {
        if (stack.length > 0) stack.push(stack[stack.length - 1]!);
      } else if (tok === "exch") {
        if (stack.length >= 2) {
          const b = stack.pop()!, a = stack.pop()!;
          stack.push(b, a);
        }
      } else if (tok === "pop") {
        stack.pop();
      } else if (tok === "copy") {
        const n = Math.max(0, Math.trunc(stack.pop() ?? 0));
        const slice = stack.slice(Math.max(0, stack.length - n));
        stack.push(...slice);
      } else if (tok === "index") {
        const n = Math.max(0, Math.trunc(stack.pop() ?? 0));
        const idx = stack.length - 1 - n;
        if (idx >= 0 && idx < stack.length) stack.push(stack[idx]!);
      } else if (tok === "roll") {
        const jShift = Math.trunc(stack.pop() ?? 0);
        const n = Math.max(0, Math.trunc(stack.pop() ?? 0));
        if (n > 0 && stack.length >= n) {
          const sub = stack.splice(stack.length - n, n);
          const modShift = ((jShift % n) + n) % n;
          const rolled = [...sub.slice(n - modShift), ...sub.slice(0, n - modShift)];
          stack.push(...rolled);
        }
      } else if (tok === "eq") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(Math.abs(a - b) < 1e-9 ? 1 : 0);
      } else if (tok === "ne") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(Math.abs(a - b) >= 1e-9 ? 1 : 0);
      } else if (tok === "gt") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(a > b ? 1 : 0);
      } else if (tok === "ge") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(a >= b ? 1 : 0);
      } else if (tok === "lt") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(a < b ? 1 : 0);
      } else if (tok === "le") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(a <= b ? 1 : 0);
      } else if (tok === "and") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(a !== 0 && b !== 0 ? 1 : 0);
      } else if (tok === "or") {
        const b = stack.pop() ?? 0, a = stack.pop() ?? 0;
        stack.push(a !== 0 || b !== 0 ? 1 : 0);
      } else if (tok === "not") {
        const a = stack.pop() ?? 0;
        stack.push(a === 0 ? 1 : 0);
      }
      i++;
    }
  };
  runRange(0, tokens.length);
  return stack;
}

function tokenizePostScriptCode(bytes: Uint8Array): string[] {
  const tokens: string[] = [];
  let cur = "";
  for (let i = 0; i < bytes.length; i++) {
    const ch = String.fromCharCode(bytes[i]!);
    if (ch === "{" || ch === "}") {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
      tokens.push(ch);
    } else if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) tokens.push(cur);
  if (tokens[0] === "{" && tokens[tokens.length - 1] === "}") {
    return tokens.slice(1, -1);
  }
  return tokens;
}

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
    let flatGridIndex = 0;
    let stride = 1;
    for (let i = 0; i < mIn; i++) {
      const d0 = dom[i * 2] ?? 0;
      const d1 = dom[i * 2 + 1] ?? 1;
      const sMax = Math.max(1, (size[i] ?? 2) - 1);
      const e0 = encode[i * 2] ?? 0;
      const e1 = encode[i * 2 + 1] ?? sMax;
      const x = Math.max(d0, Math.min(d1, inArr[i] ?? 0));
      const u = Math.abs(d1 - d0) > 1e-8 ? (x - d0) / (d1 - d0) : 0;
      const idx = Math.round(Math.max(0, Math.min(sMax, e0 + u * (e1 - e0))));
      flatGridIndex += idx * stride;
      stride *= size[i] ?? 2;
    }
    const streamBytes = doc.decodeStream(resolved);
    const out: number[] = [];
    const maxSample = bps === 16 ? 65535 : 255;
    for (let j = 0; j < nOut; j++) {
      const sampleIdx = flatGridIndex * nOut + j;
      let rawVal = 0;
      if (bps === 16) {
        rawVal = ((streamBytes[sampleIdx * 2] ?? 0) << 8) | (streamBytes[sampleIdx * 2 + 1] ?? 0);
      } else {
        rawVal = streamBytes[sampleIdx] ?? 0;
      }
      const frac = rawVal / maxSample;
      const dec0 = decode[j * 2] ?? 0;
      const dec1 = decode[j * 2 + 1] ?? 1;
      out.push(dec0 + frac * (dec1 - dec0));
    }
    return clampRange(out);
  }

  if (ft === 4 && resolved.kind === "stream") {
    const clampedInputs = inArr.map((v, i) => {
      const d0 = dom[i * 2] ?? 0;
      const d1 = dom[i * 2 + 1] ?? 1;
      return Math.max(d0, Math.min(d1, v));
    });
    const tokens = tokenizePostScriptCode(doc.decodeStream(resolved));
    const stackOut = evaluateType4PostScriptTokens(tokens, clampedInputs);
    return clampRange(stackOut);
  }

  if (ft === 3) {
    const fnsArr = doc.resolveArray(dictGet(fnDict, "Functions"));
    const bounds = getNums("Bounds", []);
    const encode = getNums("Encode", []);
    if (fnsArr && fnsArr.items.length > 0) {
      let segIdx = 0;
      while (segIdx < bounds.length && t >= bounds[segIdx]!) segIdx++;
      segIdx = Math.min(fnsArr.items.length - 1, segIdx);
      const b0 = segIdx === 0 ? (dom[0] ?? 0) : bounds[segIdx - 1]!;
      const b1 = segIdx < bounds.length ? bounds[segIdx]! : (dom[1] ?? 1);
      const e0 = encode[segIdx * 2] ?? 0;
      const e1 = encode[segIdx * 2 + 1] ?? 1;
      const localT = Math.abs(b1 - b0) > 1e-8 ? e0 + ((t - b0) / (b1 - b0)) * (e1 - e0) : e0;
      return evalShadingFunctionToComponents(doc, fnsArr.items[segIdx], Math.max(0, Math.min(1, localT)));
    }
  }
  const c0 = getNums("C0", [0, 0, 0]);
  const c1 = getNums("C1", [1, 1, 1]);
  const nNode = doc.resolve(dictGet(fnDict, "N"));
  const expN = nNode?.kind === "number" && nNode.value > 0 ? nNode.value : 1;
  const d0 = dom[0] ?? 0;
  const d1 = dom[1] ?? 1;
  const normT = Math.abs(d1 - d0) > 1e-8 ? (t - d0) / (d1 - d0) : t;
  const w = Math.pow(Math.max(0, Math.min(1, normT)), expN);
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
    const cc = comps[0] ?? 0, cm = comps[1] ?? 0, cy = comps[2] ?? 0, ck = comps[3] ?? 0;
    return [(1 - cc) * (1 - ck), (1 - cm) * (1 - kClamp(ck)), (1 - cy) * (1 - kClamp(ck))];
  }
  return [comps[0] ?? 0, comps[1] ?? 0, comps[2] ?? 0];
}

function kClamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function xyzToSrgb(X: number, Y: number, Z: number, Xw = 0.95047, Yw = 1.0, Zw = 1.08883): [number, number, number] {
  const scaleX = Xw > 1e-6 ? 0.95047 / Xw : 1;
  const scaleY = Yw > 1e-6 ? 1.0 / Yw : 1;
  const scaleZ = Zw > 1e-6 ? 1.08883 / Zw : 1;
  const x = X * scaleX;
  const y = Y * scaleY;
  const z = Z * scaleZ;
  const rl = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const gl = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  const toGamma = (u: number): number => {
    const c = Math.max(0, Math.min(1, u));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return [toGamma(rl), toGamma(gl), toGamma(bl)];
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
    if (family === "CalGray") {
      const paramDict = resolved.items[1] ? doc.resolveDict(resolved.items[1]) : undefined;
      const gNode = paramDict ? doc.resolve(dictGet(paramDict, "Gamma")) : undefined;
      const gamma = gNode?.kind === "number" && gNode.value > 0 ? gNode.value : 1;
      const a = Math.pow(kClamp(comps[0] ?? 0), gamma);
      return [a, a, a];
    }
    if (family === "CalRGB") {
      const paramDict = resolved.items[1] ? doc.resolveDict(resolved.items[1]) : undefined;
      const gammaArr = paramDict ? doc.resolveArray(dictGet(paramDict, "Gamma")) : undefined;
      const getArrNum = (arr: typeof gammaArr, idx: number, fb: number) => {
        const r = arr && arr.items[idx] ? doc.resolve(arr.items[idx]) : undefined;
        return r?.kind === "number" ? r.value : fb;
      };
      const gr = getArrNum(gammaArr, 0, 1);
      const gg = getArrNum(gammaArr, 1, 1);
      const gb = getArrNum(gammaArr, 2, 1);
      const ag = Math.pow(kClamp(comps[0] ?? 0), gr > 0 ? gr : 1);
      const bg = Math.pow(kClamp(comps[1] ?? 0), gg > 0 ? gg : 1);
      const cg = Math.pow(kClamp(comps[2] ?? 0), gb > 0 ? gb : 1);
      const matArr = paramDict ? doc.resolveArray(dictGet(paramDict, "Matrix")) : undefined;
      if (matArr && matArr.items.length >= 9) {
        const m = (i: number) => getArrNum(matArr, i, 0);
        const X = m(0) * ag + m(3) * bg + m(6) * cg;
        const Y = m(1) * ag + m(4) * bg + m(7) * cg;
        const Z = m(2) * ag + m(5) * bg + m(8) * cg;
        const wpArr = paramDict ? doc.resolveArray(dictGet(paramDict, "WhitePoint")) : undefined;
        const Xw = getArrNum(wpArr, 0, 0.95047);
        const Yw = getArrNum(wpArr, 1, 1.0);
        const Zw = getArrNum(wpArr, 2, 1.08883);
        return xyzToSrgb(X, Y, Z, Xw, Yw, Zw);
      }
      return [ag, bg, cg];
    }
    if (family === "Lab") {
      const paramDict = resolved.items[1] ? doc.resolveDict(resolved.items[1]) : undefined;
      const wpArr = paramDict ? doc.resolveArray(dictGet(paramDict, "WhitePoint")) : undefined;
      const rangeArr = paramDict ? doc.resolveArray(dictGet(paramDict, "Range")) : undefined;
      const getNum = (arr: typeof wpArr, idx: number, fb: number) => {
        const r = arr && arr.items[idx] ? doc.resolve(arr.items[idx]) : undefined;
        return r?.kind === "number" ? r.value : fb;
      };
      const Xw = getNum(wpArr, 0, 0.95047);
      const Yw = getNum(wpArr, 1, 1.0);
      const Zw = getNum(wpArr, 2, 1.08883);
      const amin = getNum(rangeArr, 0, -100);
      const amax = getNum(rangeArr, 1, 100);
      const bmin = getNum(rangeArr, 2, -100);
      const bmax = getNum(rangeArr, 3, 100);
      const Lstar = Math.max(0, Math.min(100, comps[0] ?? 0));
      const astar = Math.max(amin, Math.min(amax, comps[1] ?? 0));
      const bstar = Math.max(bmin, Math.min(bmax, comps[2] ?? 0));
      const M = (Lstar + 16) / 116;
      const L = M + astar / 500;
      const N = M - bstar / 200;
      const gFn = (x: number): number => (x >= 6 / 29 ? x * x * x : (108 / 841) * (x - 4 / 29));
      return xyzToSrgb(Xw * gFn(L), Yw * gFn(M), Zw * gFn(N), Xw, Yw, Zw);
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
  const xmin = decodeNums[0]!, xmax = decodeNums[1]!, ymin = decodeNums[2]!, ymax = decodeNums[3]!;
  const numColorParams = Math.max(1, Math.floor((decodeNums.length - 4) / 2));
  const fnNode = dictGet(shDict, "Function");
  const csNode = doc.resolve(dictGet(shDict, "ColorSpace"));
  const csName = csNode?.kind === "name" ? csNode.decoded : "DeviceRGB";

  let bitPos = 0;
  const totalBits = bytes.length * 8;
  const readBits = (n: number): number => {
    let val = 0;
    for (let i = 0; i < n; i++) {
      if (bitPos >= totalBits) return val;
      const byteIdx = bitPos >> 3;
      const bitIdx = 7 - (bitPos & 7);
      val = val * 2 + ((bytes[byteIdx]! >> bitIdx) & 1);
      bitPos++;
    }
    return val;
  };
  const coordMax = Math.pow(2, bpcCoord) - 1 || 1;
  const compMax = Math.pow(2, bpcComp) - 1 || 1;
  const readCoord = (): [number, number] => {
    const rx = readBits(bpcCoord) / coordMax;
    const ry = readBits(bpcCoord) / coordMax;
    return [xmin + rx * (xmax - xmin), ymin + ry * (ymax - ymin)];
  };
  const readColorRgb = (): [number, number, number] => {
    const params: number[] = [];
    for (let c = 0; c < numColorParams; c++) {
      const rc = readBits(bpcComp) / compMax;
      const cMin = decodeNums[4 + c * 2] ?? 0;
      const cMax = decodeNums[4 + c * 2 + 1] ?? 1;
      params.push(cMin + rc * (cMax - cMin));
    }
    const comps = fnNode ? evalShadingFunctionToComponents(doc, fnNode, params) : params;
    return convertColorSpaceComponentsToRgb(doc, csNode, csName, comps);
  };

  interface MeshVertex {
    x: number;
    y: number;
    rgb: [number, number, number];
  }
  const triangles: Array<[MeshVertex, MeshVertex, MeshVertex]> = [];

  if (shType === 4) {
    const minBitsPerVert = bpcFlag + 2 * bpcCoord + numColorParams * bpcComp;
    let triVerts: [MeshVertex, MeshVertex, MeshVertex] | undefined;
    while (bitPos + minBitsPerVert <= totalBits) {
      const flag = readBits(bpcFlag) & 3;
      const [x, y] = readCoord();
      const rgb = readColorRgb();
      const vNew: MeshVertex = { x, y, rgb };
      if (flag === 0 || !triVerts) {
        if (bitPos + 2 * minBitsPerVert > totalBits) break;
        readBits(bpcFlag);
        const [x1, y1] = readCoord();
        const rgb1 = readColorRgb();
        readBits(bpcFlag);
        const [x2, y2] = readCoord();
        const rgb2 = readColorRgb();
        triVerts = [vNew, { x: x1, y: y1, rgb: rgb1 }, { x: x2, y: y2, rgb: rgb2 }];
        triangles.push(triVerts);
      } else if (flag === 1) {
        triVerts = [triVerts[1], triVerts[2], vNew];
        triangles.push(triVerts);
      } else if (flag === 2) {
        triVerts = [triVerts[0], triVerts[2], vNew];
        triangles.push(triVerts);
      }
    }
  } else if (shType === 5) {
    const minBitsPerVert = 2 * bpcCoord + numColorParams * bpcComp;
    const verts: MeshVertex[] = [];
    while (bitPos + minBitsPerVert <= totalBits) {
      const [x, y] = readCoord();
      const rgb = readColorRgb();
      verts.push({ x, y, rgb });
    }
    const numRows = Math.floor(verts.length / vPerRow);
    for (let r = 0; r + 1 < numRows; r++) {
      for (let c = 0; c + 1 < vPerRow; c++) {
        const v00 = verts[r * vPerRow + c]!;
        const v01 = verts[r * vPerRow + c + 1]!;
        const v11 = verts[(r + 1) * vPerRow + c + 1]!;
        const v10 = verts[(r + 1) * vPerRow + c]!;
        triangles.push([v00, v01, v11], [v00, v11, v10]);
      }
    }
  } else if (shType === 6 || shType === 7) {
    const numCtrl = shType === 6 ? 12 : 16;
    const minBitsPatch = bpcFlag + (numCtrl - 4) * 2 * bpcCoord + 2 * numColorParams * bpcComp;
    let prevPts: Array<[number, number]> | undefined;
    let prevColors: Array<[number, number, number]> | undefined;
    while (bitPos + minBitsPatch <= totalBits) {
      const flag = readBits(bpcFlag) & 3;
      let pts: Array<[number, number]> = [];
      let cols: Array<[number, number, number]> = [];
      if (flag === 0 || !prevPts || !prevColors) {
        for (let i = 0; i < numCtrl; i++) pts.push(readCoord());
        for (let i = 0; i < 4; i++) cols.push(readColorRgb());
      } else {
        const extraCtrl = numCtrl - 4;
        const readExtra: Array<[number, number]> = [];
        for (let i = 0; i < extraCtrl; i++) readExtra.push(readCoord());
        const c2 = readColorRgb();
        const c3 = readColorRgb();
        pts = [prevPts[3]!, prevPts[4]!, prevPts[5]!, prevPts[6]!, ...readExtra];
        cols = [prevColors[1]!, prevColors[2]!, c2, c3];
      }
      prevPts = pts;
      prevColors = cols;
      const p00 = pts[0]!;
      const p03 = pts[3]!;
      const p33 = pts[6]!;
      const p30 = pts[9]!;
      const c00 = cols[0]!, c03 = cols[1]!, c33 = cols[2]!, c30 = cols[3]!;
      const steps = 4;
      const grid: MeshVertex[][] = [];
      for (let iu = 0; iu <= steps; iu++) {
        const u = iu / steps;
        const row: MeshVertex[] = [];
        for (let iv = 0; iv <= steps; iv++) {
          const v = iv / steps;
          const x = (1 - u) * (1 - v) * p00[0] + (1 - u) * v * p03[0] + u * v * p33[0] + u * (1 - v) * p30[0];
          const y = (1 - u) * (1 - v) * p00[1] + (1 - u) * v * p03[1] + u * v * p33[1] + u * (1 - v) * p30[1];
          const r = (1 - u) * (1 - v) * c00[0] + (1 - u) * v * c03[0] + u * v * c33[0] + u * (1 - v) * c30[0];
          const g = (1 - u) * (1 - v) * c00[1] + (1 - u) * v * c03[1] + u * v * c33[1] + u * (1 - v) * c30[1];
          const b = (1 - u) * (1 - v) * c00[2] + (1 - u) * v * c03[2] + u * v * c33[2] + u * (1 - v) * c30[2];
          row.push({ x, y, rgb: [r, g, b] });
        }
        grid.push(row);
      }
      for (let iu = 0; iu < steps; iu++) {
        for (let iv = 0; iv < steps; iv++) {
          const g00 = grid[iu]![iv]!;
          const g01 = grid[iu]![iv + 1]!;
          const g11 = grid[iu + 1]![iv + 1]!;
          const g10 = grid[iu + 1]![iv]!;
          triangles.push([g00, g01, g11], [g00, g11, g10]);
        }
      }
    }
  }

  if (triangles.length === 0) return undefined;
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

  for (const [v0, v1, v2] of triangles) {
    const [x0, y0] = toImgCoords(v0.x, v0.y);
    const [x1, y1] = toImgCoords(v1.x, v1.y);
    const [x2, y2] = toImgCoords(v2.x, v2.y);
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
          const r = w0 * v0.rgb[0] + w1 * v1.rgb[0] + w2 * v2.rgb[0];
          const g = w0 * v0.rgb[1] + w1 * v1.rgb[1] + w2 * v2.rgb[1];
          const b = w0 * v0.rgb[2] + w1 * v1.rgb[2] + w2 * v2.rgb[2];
          const pIdx = (iy * imgW + ix) * 4;
          rgba[pIdx] = Math.round(Math.max(0, Math.min(1, r)) * 255);
          rgba[pIdx + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
          rgba[pIdx + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
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

      if (shBBox && (xs < shBBox[0]! || xs > shBBox[2]! || ys < shBBox[1]! || ys > shBBox[3]!)) {
        continue;
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

  const decodeTokenGlyphs = (
    bytes: Uint8Array,
    font: ResolvedPageFont | undefined
  ): Array<{ charCode: number; unicode: string; advance1000: number }> => {
    if (font?.cmap) {
      if (!font.isTwoByteCid) {
        const stdName = normalizeStandard14FontName(font.baseFont);
        const stdMetrics = STANDARD_14_FONTS[stdName];
        const out: Array<{ charCode: number; unicode: string; advance1000: number }> = [];
        for (let i = 0; i < bytes.length; i++) {
          const code = bytes[i]!;
          const unicode =
            font.cmap.map.get(code) ??
            (font.differences.has(code) ? font.differences.get(code)! : decodeWinAnsiByte(code));
          const advance1000 =
            font.widths.get(code) ?? stdMetrics.widthsByCode[code] ?? stdMetrics.defaultWidth;
          out.push({ charCode: code, unicode, advance1000 });
        }
        return out;
      }
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

  const applyStateOperator = (
    st: GraphicsState,
    operator: string,
    ops: readonly import("../ast.js").PdfCosNode[],
    activeResources: PdfCosDict | undefined
  ): void => {
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
        const ctmScale = Math.max(1e-6, Math.hypot(st.ctm[0], st.ctm[1]));
        const nums = arrNode.items
          .map((it) => (it.kind === "number" ? it.value * ctmScale : 0))
          .filter((v) => v >= 0);
        const sum = nums.reduce((a, b) => a + b, 0);
        st.dashArray = sum > 0 ? nums : undefined;
        st.dashPhase = num(1, 0) * ctmScale;
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
        const targetBox: [number, number, number, number] = st.clipRect ?? [0, 0, params.width, params.height];
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
        if (img) images.push(img);
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
      const c = num(0), m = num(1), y = num(2), k = num(3);
      st.fillColor = { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
      st.fillPatternName = undefined;
    } else if (operator === "K") {
      const c = num(0), m = num(1), y = num(2), k = num(3);
      st.strokeColor = { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
    } else if (operator === "gs" && params.cosDoc && activeResources && ops[0]?.kind === "name") {
      const extDict = params.cosDoc.resolveDict(dictGet(activeResources, "ExtGState"));
      const gsDict = extDict ? params.cosDoc.resolveDict(dictGet(extDict, ops[0].decoded)) : undefined;
      if (gsDict) {
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
            st.dashArray = patArr.items
              .map(it => {
                const r = params.cosDoc!.resolve(it);
                return r?.kind === "number" ? r.value : 0;
              })
              .filter(n => n > 0);
            st.dashPhase = phaseNode?.kind === "number" ? phaseNode.value : 0;
          }
        }
        const fontArr = params.cosDoc.resolveArray(dictGet(gsDict, "Font"));
        if (fontArr && fontArr.items.length >= 2) {
          const fSizeNode = params.cosDoc.resolve(fontArr.items[1]);
          if (fSizeNode?.kind === "number") st.fontSize = fSizeNode.value;
          const gsFontKey = `__ExtGS_Font_${ops[0].decoded}`;
          const resolvedGsMap = resolvePageFonts(params.cosDoc, {
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
          });
          const resolvedGsFont = resolvedGsMap.get(gsFontKey);
          if (resolvedGsFont) {
            fonts.set(gsFontKey, resolvedGsFont);
            st.fontName = gsFontKey;
          }
        }
      }
    }
  };

  let activeTm: Matrix6 = [1, 0, 0, 1, 0, 0];
  let activeTlm: Matrix6 = [1, 0, 0, 1, 0, 0];

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

        case "marked-content": {
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
                break;
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
          walkNodes(
            node.children,
            resolvedMcid ?? mcid,
            resolvedActualText ?? actualText,
            activeResources,
            activeFonts,
            depth
          );
          break;
        }

        case "state-op": {
          applyStateOperator(curState(), node.operator, node.operands, activeResources);
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
              if (hasRotOrShear) {
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

          if (node.clip && transformedSegments.length > 0) {
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
          }

          if (node.paint === "n") break;

          const isFill = ["f", "F", "f*", "B", "B*", "b", "b*"].includes(node.paint);
          const isStroke = ["S", "s", "B", "B*", "b", "b*"].includes(node.paint);
          let evaluatedFillPattern = false;
          if (isFill && st.fillPatternName && params.cosDoc && activeResources && depth < 6) {
            const patMap = params.cosDoc.resolveDict(dictGet(activeResources, "Pattern"));
            const patNode = patMap ? params.cosDoc.resolve(dictGet(patMap, st.fillPatternName)) : undefined;
            const patDict = patNode?.kind === "stream" ? patNode.dict : patNode?.kind === "dict" ? patNode : undefined;
            const patTypeNode = patDict && params.cosDoc ? params.cosDoc.resolve(dictGet(patDict, "PatternType")) : undefined;
            const patType = patTypeNode?.kind === "number" ? patTypeNode.value : patNode?.kind === "stream" ? 1 : 0;
            if (patDict && patType === 2 && params.cosDoc) {
              let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
              for (const s of transformedSegments) {
                if (s.kind === "move" || s.kind === "line") {
                  pMinX = Math.min(pMinX, s.x);
                  pMinY = Math.min(pMinY, s.y);
                  pMaxX = Math.max(pMaxX, s.x);
                  pMaxY = Math.max(pMaxY, s.y);
                } else if (s.kind === "cubic") {
                  pMinX = Math.min(pMinX, s.x1, s.x2, s.x);
                  pMinY = Math.min(pMinY, s.y1, s.y2, s.y);
                  pMaxX = Math.max(pMaxX, s.x1, s.x2, s.x);
                  pMaxY = Math.max(pMaxY, s.y1, s.y2, s.y);
                } else if (s.kind === "rect") {
                  pMinX = Math.min(pMinX, s.x);
                  pMinY = Math.min(pMinY, s.y);
                  pMaxX = Math.max(pMaxX, s.x + s.width);
                  pMaxY = Math.max(pMaxY, s.y + s.height);
                }
              }
              if (Number.isFinite(pMinX) && Number.isFinite(pMinY) && pMaxX > pMinX && pMaxY > pMinY) {
                const shDict = params.cosDoc.resolveDict(dictGet(patDict, "Shading"));
                if (shDict) {
                  let patMatrix: Matrix6 = [1, 0, 0, 1, 0, 0];
                  const pmArr = params.cosDoc.resolveArray(dictGet(patDict, "Matrix"));
                  if (pmArr && pmArr.items.length >= 6) {
                    const mn = (idx: number, fb = 0) => {
                      const r = params.cosDoc!.resolve(pmArr.items[idx]);
                      return r?.kind === "number" ? r.value : fb;
                    };
                    patMatrix = [mn(0, 1), mn(1, 0), mn(2, 0), mn(3, 1), mn(4, 0), mn(5, 0)];
                  }
                  const patClip: [number, number, number, number] = st.clipRect
                    ? [
                        Math.max(st.clipRect[0], pMinX),
                        Math.max(st.clipRect[1], pMinY),
                        Math.min(st.clipRect[2], pMaxX),
                        Math.min(st.clipRect[3], pMaxY),
                      ]
                    : [pMinX, pMinY, pMaxX, pMaxY];
                  const shImg = renderShadingDictToImage(
                    params.cosDoc,
                    shDict,
                    patMatrix,
                    patClip,
                    st.fillAlpha,
                    "PatternShading_" + st.fillPatternName,
                    patClip
                  );
                  if (shImg) {
                    images.push(shImg);
                    evaluatedFillPattern = true;
                  }
                }
              }
            } else if (patNode?.kind === "stream") {
              let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
              for (const s of transformedSegments) {
                if (s.kind === "move" || s.kind === "line") {
                  pMinX = Math.min(pMinX, s.x);
                  pMinY = Math.min(pMinY, s.y);
                  pMaxX = Math.max(pMaxX, s.x);
                  pMaxY = Math.max(pMaxY, s.y);
                } else if (s.kind === "cubic") {
                  pMinX = Math.min(pMinX, s.x1, s.x2, s.x);
                  pMinY = Math.min(pMinY, s.y1, s.y2, s.y);
                  pMaxX = Math.max(pMaxX, s.x1, s.x2, s.x);
                  pMaxY = Math.max(pMaxY, s.y1, s.y2, s.y);
                } else if (s.kind === "rect") {
                  pMinX = Math.min(pMinX, s.x);
                  pMinY = Math.min(pMinY, s.y);
                  pMaxX = Math.max(pMaxX, s.x + s.width);
                  pMaxY = Math.max(pMaxY, s.y + s.height);
                }
              }
              if (Number.isFinite(pMinX) && Number.isFinite(pMinY) && pMaxX > pMinX && pMaxY > pMinY) {
                const xsNode = params.cosDoc.resolve(dictGet(patNode.dict, "XStep"));
                const ysNode = params.cosDoc.resolve(dictGet(patNode.dict, "YStep"));
                const xStep = xsNode?.kind === "number" && Math.abs(xsNode.value) > 1e-3 ? Math.abs(xsNode.value) : 40;
                const yStep = ysNode?.kind === "number" && Math.abs(ysNode.value) > 1e-3 ? Math.abs(ysNode.value) : 40;
                let patMatrix: Matrix6 = [1, 0, 0, 1, 0, 0];
                const pmArr = params.cosDoc.resolveArray(dictGet(patNode.dict, "Matrix"));
                if (pmArr && pmArr.items.length >= 6) {
                  const mn = (idx: number, fb = 0) => {
                    const r = params.cosDoc!.resolve(pmArr.items[idx]);
                    return r?.kind === "number" ? r.value : fb;
                  };
                  patMatrix = [mn(0, 1), mn(1, 0), mn(2, 0), mn(3, 1), mn(4, 0), mn(5, 0)];
                }
                const tileClip: [number, number, number, number] = st.clipRect
                  ? [
                      Math.max(st.clipRect[0], pMinX),
                      Math.max(st.clipRect[1], pMinY),
                      Math.min(st.clipRect[2], pMaxX),
                      Math.min(st.clipRect[3], pMaxY),
                    ]
                  : [pMinX, pMinY, pMaxX, pMaxY];
                const patNodes = parseContentStream(params.cosDoc.decodeStream(patNode));
                const patResDict = params.cosDoc.resolveDict(dictGet(patNode.dict, "Resources")) ?? activeResources;
                const patFonts = new Map<string, ResolvedPageFont>(activeFonts);
                for (const [fk, fv] of resolvePageFonts(params.cosDoc, patResDict).entries()) {
                  patFonts.set(fk, fv);
                }
                const ixStart = Math.floor(pMinX / xStep);
                const ixEnd = Math.min(ixStart + 8, Math.ceil(pMaxX / xStep) - 1);
                const iyStart = Math.floor(pMinY / yStep);
                const iyEnd = Math.min(iyStart + 8, Math.ceil(pMaxY / yStep) - 1);
                for (let iy = iyStart; iy <= iyEnd; iy++) {
                  for (let ix = ixStart; ix <= ixEnd; ix++) {
                    const tileCtm = multiplyMatrices([1, 0, 0, 1, ix * xStep, iy * yStep], patMatrix);
                    stateStack.push({
                      ...st,
                      fillPatternName: undefined,
                      ctm: tileCtm,
                      clipRect: tileClip,
                    });
                    walkNodes(patNodes, mcid, actualText, patResDict, patFonts, depth + 1);
                    if (stateStack.length > 1) stateStack.pop();
                  }
                }
                evaluatedFillPattern = true;
              }
            }
          }
          if (evaluatedFillPattern && !isStroke) break;
          const fillRule = node.paint.includes("*") ? "evenodd" : "nonzero";
          const ctmScale = Math.max(1e-6, Math.hypot(st.ctm[0], st.ctm[1]));
          const scaledStrokeWidth = st.strokeWidth === 0 ? 0 : st.strokeWidth * ctmScale;
          paths.push({
            segments: transformedSegments,
            fillColor: isFill && !evaluatedFillPattern ? st.fillColor : undefined,
            fillAlpha: isFill && !evaluatedFillPattern ? st.fillAlpha : undefined,
            strokeColor: isStroke ? st.strokeColor : undefined,
            strokeAlpha: isStroke ? st.strokeAlpha : undefined,
            strokeWidth: scaledStrokeWidth,
            ...(st.lineCap !== 0 ? { lineCap: st.lineCap } : {}),
            ...(st.lineJoin !== 0 ? { lineJoin: st.lineJoin } : {}),
            ...(st.miterLimit !== 10 ? { miterLimit: st.miterLimit } : {}),
            fillRule,
            ...(st.blendMode && st.blendMode !== "Normal" ? { blendMode: st.blendMode } : {}),
            ...(st.dashArray ? { dashArray: [...st.dashArray] } : {}),
            ...(st.dashPhase !== undefined ? { dashPhase: st.dashPhase } : {}),
            ...(st.clipRect ? { clipRect: [...st.clipRect] as [number, number, number, number] } : {}),
          });
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
                const decoded = decodeXObjectImageToRgba(
                  params.cosDoc,
                  xobjNode,
                  activeResources,
                  {
                    r: st.fillColor.r,
                    g: st.fillColor.g,
                    b: st.fillColor.b,
                    alpha: st.fillAlpha,
                  }
                );
                images.push({
                  name: node.name,
                  matrix: [...st.ctm],
                  width: decoded.width,
                  height: decoded.height,
                  colorSpace: decoded.colorSpace,
                  bitsPerComponent: decoded.bitsPerComponent,
                  decodedRgba: decoded.rgba,
                  ...(st.blendMode && st.blendMode !== "Normal" ? { blendMode: st.blendMode } : {}),
                  ...(st.clipRect ? { clipRect: [...st.clipRect] as [number, number, number, number] } : {}),
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
                let nextClip = st.clipRect ? ([...st.clipRect] as [number, number, number, number]) : undefined;
                const bboxArr = params.cosDoc.resolveArray(dictGet(xobjNode.dict, "BBox"));
                if (bboxArr && bboxArr.items.length >= 4) {
                  const bn = (idx: number, fb = 0) => {
                    const resolved = params.cosDoc!.resolve(bboxArr.items[idx]);
                    return resolved?.kind === "number" ? resolved.value : fb;
                  };
                  const bx0 = bn(0, 0), by0 = bn(1, 0), bx1 = bn(2, 0), by1 = bn(3, 0);
                  const pts = [
                    transformPoint(nextCtm, bx0, by0),
                    transformPoint(nextCtm, bx1, by0),
                    transformPoint(nextCtm, bx0, by1),
                    transformPoint(nextCtm, bx1, by1),
                  ];
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
                stateStack.push({ ...st, ctm: nextCtm, ...(nextClip ? { clipRect: nextClip } : {}) });
                walkNodes(formNodes, mcid, actualText, formResDict, formFonts, depth + 1);
                if (stateStack.length > 1) stateStack.pop();
              }
            }
          }
          break;
        }

        case "inline-image": {
          const st = curState();
          const decoded = decodeInlineImageNodeToRgba(
            params.cosDoc,
            node.dict,
            node.data,
            activeResources,
            {
              r: st.fillColor.r,
              g: st.fillColor.g,
              b: st.fillColor.b,
              alpha: st.fillAlpha,
            }
          );
          images.push({
            name: "InlineImage",
            matrix: [...st.ctm],
            width: decoded.width,
            height: decoded.height,
            colorSpace: decoded.colorSpace,
            bitsPerComponent: decoded.bitsPerComponent,
            decodedRgba: decoded.rgba,
            ...(st.blendMode && st.blendMode !== "Normal" ? { blendMode: st.blendMode } : {}),
            ...(st.clipRect ? { clipRect: [...st.clipRect] as [number, number, number, number] } : {}),
          });
          break;
        }

        case "text-object": {
          const st = curState();
          if (!node.continuation) {
            activeTm = [1, 0, 0, 1, 0, 0];
            activeTlm = [1, 0, 0, 1, 0, 0];
          }
          let tm: Matrix6 = activeTm;
          let tlm: Matrix6 = activeTlm;

          const emitTokenBytes = (bytes: Uint8Array) => {
            const font = activeFonts.get(st.fontName) ?? fonts.get(st.fontName);
            const decoded = decodeTokenGlyphs(bytes, font);
            const scaleH = st.horizScale / 100;
            for (const item of decoded) {
              const totalMatrix = multiplyMatrices(tm, st.ctm);
              const [px, py] = [totalMatrix[4], totalMatrix[5] + st.rise];
              const effectiveFontSize = st.fontSize * Math.hypot(totalMatrix[0], totalMatrix[1]);
              let advance1000 = item.advance1000;
              let evaluatedType3 = false;
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
                    walkNodes(
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
              } else if (font?.embeddedTrueType && st.textRenderMode !== 3) {
                const cp = item.unicode ? item.unicode.codePointAt(0) : undefined;
                let glyphOutline = cp !== undefined ? font.embeddedTrueType.getGlyphOutline(cp) : [];
                if (glyphOutline.length === 0) {
                  glyphOutline = font.embeddedTrueType.getGlyphOutlineByGid(item.charCode);
                }
                if (!font.widths.has(item.charCode)) {
                  const ttAdv = cp !== undefined ? font.embeddedTrueType.getAdvanceWidth1000(cp) : undefined;
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
                  const isFillGlyph = st.textRenderMode === 0 || st.textRenderMode === 2 || st.textRenderMode === 4 || st.textRenderMode === 6;
                  const isStrokeGlyph = st.textRenderMode === 1 || st.textRenderMode === 2 || st.textRenderMode === 5 || st.textRenderMode === 6;
                  const ctmScale = Math.max(1e-6, Math.hypot(st.ctm[0], st.ctm[1]));
                  paths.push({
                    segments: transformedGlyphSegs,
                    fillColor: isFillGlyph ? st.fillColor : undefined,
                    fillAlpha: isFillGlyph ? st.fillAlpha : undefined,
                    strokeColor: isStrokeGlyph ? st.strokeColor : undefined,
                    strokeAlpha: isStrokeGlyph ? st.strokeAlpha : undefined,
                    strokeWidth: isStrokeGlyph ? st.strokeWidth * ctmScale : 0,
                    fillRule: "nonzero",
                    ...(st.blendMode && st.blendMode !== "Normal" ? { blendMode: st.blendMode } : {}),
                    ...(st.clipRect ? { clipRect: [...st.clipRect] as [number, number, number, number] } : {}),
                  });
                  evaluatedType3 = true;
                }
              }
              const advUser = ((advance1000 * st.fontSize) / 1000 + st.charSpace + (item.unicode === " " ? st.wordSpace : 0)) * scaleH;
              const [nextX, nextY] = transformPoint(totalMatrix, advUser, 0);
              const glyphWidth = Math.max(
                Math.hypot(nextX - px, nextY - py),
                (advance1000 * effectiveFontSize) / 1000
              );
              glyphs.push({
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
              case "render-mode":
                st.textRenderMode = cmd.mode;
                break;
              case "state-op":
                applyStateOperator(st, cmd.operator, cmd.operands, activeResources);
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
          activeTm = tm;
          activeTlm = tlm;
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
