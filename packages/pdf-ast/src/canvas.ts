import {
  cosArray,
  cosDict,
  cosHexString,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  dictGet,
  dictSet,
  type PdfContentNode,
  type PdfCosDict,
  type PdfCosRef,
  type PdfDisplayList,
  type PdfExtractedPage,
  type PdfExtractedTable,
  type PdfPathSegment,
  type PdfRgbColor,
} from "./ast.js";
import { evaluateContentStreamToDisplayList, extractPageAnnotations } from "./content/evaluator.js";
import { parseContentStream } from "./content/parser.js";
import { serializeContentAst } from "./content/serializer.js";
import type { ParsedCosDocument } from "./cos/parser.js";
import { redactPageContentAst, type RedactOptions } from "./edit/redact.js";
import { extractTablesFromDisplayList } from "./extract/tables.js";
import { extractPageFromDisplayList, formatExtractedPageText, type ExtractTextOptions } from "./extract/text.js";
import {
  encodeWinAnsiBytes,
  measureStandard14TextWidth,
  type Standard14FontName,
} from "./fonts/standard14.js";
import { embedTrueTypeFontInCos, type ParsedTrueTypeFont } from "./fonts/truetype.js";
import { renderDisplayListToPng, type RenderToPngOptions } from "./render/raster.js";

export function rgb(r: number, g: number, b: number): PdfRgbColor {
  return { r, g, b };
}

export interface PdfFontHandle {
  readonly kind: "standard14" | "truetype";
  readonly name: string;
  readonly standardName?: Standard14FontName | undefined;
  readonly truetype?: ParsedTrueTypeFont | undefined;
  widthOfTextAtSize(text: string, size: number): number;
}

export interface PdfImageHandle {
  readonly xobjectRef: PdfCosRef;
  readonly width: number;
  readonly height: number;
}

export interface DrawTextOptions {
  readonly x: number;
  readonly y: number;
  readonly size?: number | undefined;
  readonly font?: PdfFontHandle | Standard14FontName | undefined;
  readonly color?: PdfRgbColor | undefined;
  readonly rotateRadians?: number | undefined;
}

export interface DrawRectOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill?: PdfRgbColor | undefined;
  readonly stroke?: PdfRgbColor | undefined;
  readonly strokeWidth?: number | undefined;
}

export interface DrawLineOptions {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stroke?: PdfRgbColor | undefined;
  readonly strokeWidth?: number | undefined;
}

export interface DrawPathOptions {
  readonly fill?: PdfRgbColor | undefined;
  readonly stroke?: PdfRgbColor | undefined;
  readonly strokeWidth?: number | undefined;
  readonly fillRule?: "nonzero" | "evenodd" | undefined;
}

export interface DrawImageOptions {
  readonly x: number;
  readonly y: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export class PdfPage {
  readonly cosDoc: ParsedCosDocument;
  readonly pageRef: PdfCosRef;
  readonly pageDict: PdfCosDict;
  index: number;
  private cachedContentAst: PdfContentNode[] | undefined;
  private fontResourceCounter = 1;
  private xobjectResourceCounter = 1;

  constructor(cosDoc: ParsedCosDocument, pageRef: PdfCosRef, pageDict: PdfCosDict, index: number) {
    this.cosDoc = cosDoc;
    this.pageRef = pageRef;
    this.pageDict = pageDict;
    this.index = index;
  }

  get dict(): PdfCosDict {
    return this.pageDict;
  }

  get ref(): PdfCosRef {
    return this.pageRef;
  }

  getDisplayList(): PdfDisplayList {
    return this.evaluateDisplayList();
  }

  get width(): number {
    return this.getSize().width;
  }

  get height(): number {
    return this.getSize().height;
  }

  getSize(): { width: number; height: number } {
    const mb = this.resolveInheritedArray("MediaBox");
    if (mb && mb.items.length >= 4) {
      const x0 = this.cosDoc.resolve(mb.items[0]);
      const y0 = this.cosDoc.resolve(mb.items[1]);
      const x1 = this.cosDoc.resolve(mb.items[2]);
      const y1 = this.cosDoc.resolve(mb.items[3]);
      if (
        x0?.kind === "number" &&
        y0?.kind === "number" &&
        x1?.kind === "number" &&
        y1?.kind === "number"
      ) {
        return { width: Math.abs(x1.value - x0.value), height: Math.abs(y1.value - y0.value) };
      }
    }
    return { width: 612, height: 792 };
  }

  setSize(width: number, height: number): void {
    dictSet(
      this.pageDict,
      "MediaBox",
      cosArray([cosNumber(0), cosNumber(0), cosNumber(width), cosNumber(height)])
    );
  }

  getRotation(): 0 | 90 | 180 | 270 {
    const rotNode = this.resolveInheritedNode("Rotate");
    if (rotNode?.kind === "number") {
      const norm = ((rotNode.value % 360) + 360) % 360;
      if (norm === 90 || norm === 180 || norm === 270) return norm;
    }
    return 0;
  }

  setRotation(degrees: 0 | 90 | 180 | 270): void {
    dictSet(this.pageDict, "Rotate", cosNumber(degrees));
  }

  private resolveInheritedNode(key: string) {
    let cur: PdfCosDict | undefined = this.pageDict;
    const visited = new Set< PdfCosDict>();
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      const val = dictGet(cur, key);
      if (val) return this.cosDoc.resolve(val);
      cur = this.cosDoc.resolveDict(dictGet(cur, "Parent"));
    }
    return undefined;
  }

  private resolveInheritedArray(key: string) {
    const node = this.resolveInheritedNode(key);
    return node?.kind === "array" ? node : undefined;
  }

  getResourcesDict(): PdfCosDict {
    let res = this.cosDoc.resolveDict(dictGet(this.pageDict, "Resources"));
    if (!res) {
      const inherited = this.resolveInheritedNode("Resources");
      if (inherited?.kind === "dict") {
        res = inherited;
      } else {
        res = cosDict({});
      }
      dictSet(this.pageDict, "Resources", res);
    }
    return res;
  }

  ensureStandardFontResource(fontName: Standard14FontName): string {
    const res = this.getResourcesDict();
    let fontDict = this.cosDoc.resolveDict(dictGet(res, "Font"));
    if (!fontDict) {
      fontDict = cosDict({});
      dictSet(res, "Font", fontDict);
    }
    for (const entry of fontDict.entries) {
      const fObj = this.cosDoc.resolveDict(entry.value);
      const bf = fObj ? this.cosDoc.resolve(dictGet(fObj, "BaseFont")) : undefined;
      if (bf?.kind === "name" && bf.decoded === fontName) {
        return entry.key.decoded;
      }
    }
    let key = `F${this.fontResourceCounter++}`;
    while (dictGet(fontDict, key)) {
      key = `F${this.fontResourceCounter++}`;
    }
    const fRef = this.cosDoc.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type1"),
        BaseFont: cosName(fontName),
        Encoding: cosName("WinAnsiEncoding"),
      })
    );
    dictSet(fontDict, key, fRef);
    return key;
  }

  ensureTrueTypeFontResource(font: ParsedTrueTypeFont, usedGlyphs: ReadonlyMap<number, string>): string {
    const res = this.getResourcesDict();
    let fontDict = this.cosDoc.resolveDict(dictGet(res, "Font"));
    if (!fontDict) {
      fontDict = cosDict({});
      dictSet(res, "Font", fontDict);
    }
    let key = `FT${this.fontResourceCounter++}`;
    while (dictGet(fontDict, key)) {
      key = `FT${this.fontResourceCounter++}`;
    }
    const fRef = embedTrueTypeFontInCos(this.cosDoc, font, usedGlyphs);
    dictSet(fontDict, key, fRef);
    return key;
  }

  ensureXObjectResource(xobjectRef: PdfCosRef): string {
    const res = this.getResourcesDict();
    let xobjDict = this.cosDoc.resolveDict(dictGet(res, "XObject"));
    if (!xobjDict) {
      xobjDict = cosDict({});
      dictSet(res, "XObject", xobjDict);
    }
    let key = `Im${this.xobjectResourceCounter++}`;
    while (dictGet(xobjDict, key)) {
      key = `Im${this.xobjectResourceCounter++}`;
    }
    dictSet(xobjDict, key, xobjectRef);
    return key;
  }

  getContentAst(): PdfContentNode[] {
    if (this.cachedContentAst) return this.cachedContentAst;
    const merged = this.getRawContentStream();
    this.cachedContentAst = parseContentStream(merged);
    return this.cachedContentAst;
  }

  getRawContentStream(): Uint8Array {
    const contentsNode = this.cosDoc.resolve(dictGet(this.pageDict, "Contents"));
    const chunks: Uint8Array[] = [];
    if (contentsNode?.kind === "stream") {
      chunks.push(this.cosDoc.decodeStream(contentsNode));
    } else if (contentsNode?.kind === "array") {
      for (const item of contentsNode.items) {
        const stm = this.cosDoc.resolve(item);
        if (stm?.kind === "stream") {
          chunks.push(this.cosDoc.decodeStream(stm));
          chunks.push(new TextEncoder().encode("\n"));
        }
      }
    }
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return merged;
  }

  setRawContentStream(bytes: Uint8Array, compress = true): void {
    this.cachedContentAst = parseContentStream(bytes);
    const stm = cosStream(bytes, { compress });
    const contentsRef = dictGet(this.pageDict, "Contents");
    if (contentsRef?.kind === "ref") {
      this.cosDoc.setObject(contentsRef.objectNumber, stm);
    } else {
      const newRef = this.cosDoc.allocateObject(stm);
      dictSet(this.pageDict, "Contents", newRef);
    }
  }

  setContentAst(nodes: PdfContentNode[], compress = true): void {
    this.cachedContentAst = [...nodes];
    const bytes = serializeContentAst(this.cachedContentAst);
    const streamObj = cosStream(bytes, { compress });
    const existingContents = dictGet(this.pageDict, "Contents");
    if (existingContents?.kind === "ref") {
      this.cosDoc.setObject(existingContents.objectNumber, streamObj, existingContents.generationNumber);
    } else {
      const ref = this.cosDoc.allocateObject(streamObj);
      dictSet(this.pageDict, "Contents", ref);
    }
  }

  drawText(text: string, options: DrawTextOptions): void {
    const size = options.size ?? 12;
    const color = options.color ?? { r: 0, g: 0, b: 0 };
    const ast = this.getContentAst();

    let fontResKey: string;
    let tokenNode;
    if (options.font && typeof options.font === "object" && options.font.kind === "truetype" && options.font.truetype) {
      const { hexBytes, usedGlyphs } = options.font.truetype.encodeTextToCidHex(text);
      fontResKey = this.ensureTrueTypeFontResource(options.font.truetype, usedGlyphs);
      tokenNode = cosHexString(hexBytes);
    } else {
      const stdName: Standard14FontName =
        typeof options.font === "string"
          ? options.font
          : options.font?.standardName ?? "Helvetica";
      fontResKey = this.ensureStandardFontResource(stdName);
      tokenNode = cosString(encodeWinAnsiBytes(text));
    }

    const rad = options.rotateRadians ?? 0;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    ast.push({
      kind: "graphics-group",
      ops: [
        {
          kind: "state-op",
          operator: "rg",
          operands: [cosNumber(color.r), cosNumber(color.g), cosNumber(color.b)],
        },
        {
          kind: "text-object",
          commands: [
            { kind: "font", fontName: fontResKey, size },
            { kind: "matrix", matrix: [cos, sin, -sin, cos, options.x, options.y] },
            { kind: "show-text", token: tokenNode },
          ],
        },
      ],
    });
    this.setContentAst(ast);
  }

  drawRect(options: DrawRectOptions): void {
    const ast = this.getContentAst();
    const ops: PdfContentNode[] = [];
    if (options.fill) {
      ops.push({
        kind: "state-op",
        operator: "rg",
        operands: [cosNumber(options.fill.r), cosNumber(options.fill.g), cosNumber(options.fill.b)],
      });
    }
    if (options.stroke) {
      ops.push({
        kind: "state-op",
        operator: "RG",
        operands: [cosNumber(options.stroke.r), cosNumber(options.stroke.g), cosNumber(options.stroke.b)],
      });
    }
    if (options.strokeWidth !== undefined) {
      ops.push({
        kind: "state-op",
        operator: "w",
        operands: [cosNumber(options.strokeWidth)],
      });
    }
    const paint = options.fill && options.stroke ? "B" : options.fill ? "f" : "S";
    ops.push({
      kind: "path-op",
      segments: [
        {
          kind: "rect",
          x: options.x,
          y: options.y,
          width: options.width,
          height: options.height,
        },
      ],
      paint,
    });
    ast.push({ kind: "graphics-group", ops });
    this.setContentAst(ast);
  }

  drawLine(options: DrawLineOptions): void {
    const stroke = options.stroke ?? { r: 0, g: 0, b: 0 };
    const sw = options.strokeWidth ?? 1;
    this.drawPath(
      [
        { kind: "move", x: options.x1, y: options.y1 },
        { kind: "line", x: options.x2, y: options.y2 },
      ],
      { stroke, strokeWidth: sw }
    );
  }

  drawPath(segments: readonly PdfPathSegment[], options: DrawPathOptions = {}): void {
    const ast = this.getContentAst();
    const ops: PdfContentNode[] = [];
    if (options.fill) {
      ops.push({
        kind: "state-op",
        operator: "rg",
        operands: [cosNumber(options.fill.r), cosNumber(options.fill.g), cosNumber(options.fill.b)],
      });
    }
    if (options.stroke) {
      ops.push({
        kind: "state-op",
        operator: "RG",
        operands: [cosNumber(options.stroke.r), cosNumber(options.stroke.g), cosNumber(options.stroke.b)],
      });
    }
    if (options.strokeWidth !== undefined) {
      ops.push({
        kind: "state-op",
        operator: "w",
        operands: [cosNumber(options.strokeWidth)],
      });
    }
    const evenOdd = options.fillRule === "evenodd";
    const paint =
      options.fill && options.stroke
        ? evenOdd
          ? "B*"
          : "B"
        : options.fill
          ? evenOdd
            ? "f*"
            : "f"
          : "S";
    ops.push({
      kind: "path-op",
      segments: [...segments],
      paint,
    });
    ast.push({ kind: "graphics-group", ops });
    this.setContentAst(ast);
  }

  drawImage(
    image: PdfImageHandle | { readonly width: number; readonly height: number; readonly data: Uint8Array },
    options: DrawImageOptions
  ): void {
    let handle: PdfImageHandle;
    if ("xobjectRef" in image && image.xobjectRef) {
      handle = image;
    } else {
      const bmp = image as { readonly width: number; readonly height: number; readonly data: Uint8Array };
      const pixelCount = bmp.width * bmp.height;
      let rgbBytes: Uint8Array;
      if (bmp.data.length === pixelCount * 4) {
        rgbBytes = new Uint8Array(pixelCount * 3);
        for (let i = 0, j = 0; i < bmp.data.length; i += 4, j += 3) {
          rgbBytes[j] = bmp.data[i]!;
          rgbBytes[j + 1] = bmp.data[i + 1]!;
          rgbBytes[j + 2] = bmp.data[i + 2]!;
        }
      } else {
        rgbBytes = bmp.data;
      }
      const streamObj = cosStream(rgbBytes, {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(bmp.width),
          Height: cosNumber(bmp.height),
          ColorSpace: cosName("DeviceRGB"),
          BitsPerComponent: cosNumber(8),
        }),
        compress: true,
      });
      const xobjectRef = this.cosDoc.allocateObject(streamObj);
      handle = { xobjectRef, width: bmp.width, height: bmp.height };
    }
    const w = options.width ?? handle.width;
    const h = options.height ?? handle.height;
    const resKey = this.ensureXObjectResource(handle.xobjectRef);
    const ast = this.getContentAst();
    ast.push({
      kind: "graphics-group",
      ops: [
        {
          kind: "state-op",
          operator: "cm",
          operands: [
            cosNumber(w),
            cosNumber(0),
            cosNumber(0),
            cosNumber(h),
            cosNumber(options.x),
            cosNumber(options.y),
          ],
        },
        { kind: "xobject", name: resKey },
      ],
    });
    this.setContentAst(ast);
  }

  addLinkAnnotation(params: {
    readonly rect: readonly [number, number, number, number];
    readonly uri: string;
    readonly contents?: string | undefined;
  }): void {
    let annots = this.cosDoc.resolveArray(dictGet(this.pageDict, "Annots"));
    if (!annots) {
      annots = cosArray([]);
      dictSet(this.pageDict, "Annots", annots);
    }
    const annotDict = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Link"),
      Rect: cosArray([
        cosNumber(params.rect[0]),
        cosNumber(params.rect[1]),
        cosNumber(params.rect[2]),
        cosNumber(params.rect[3]),
      ]),
      Border: cosArray([cosNumber(0), cosNumber(0), cosNumber(0)]),
      Contents: params.contents ? cosString(params.contents) : undefined,
      A: cosDict({
        Type: cosName("Action"),
        S: cosName("URI"),
        URI: cosString(params.uri),
      }),
    });
    annots.items.push(this.cosDoc.allocateObject(annotDict));
  }

  redact(
    regionsOrSingle:
      | readonly [number, number, number, number]
      | readonly (readonly [number, number, number, number])[],
    options?: RedactOptions
  ): void {
    const regions: readonly (readonly [number, number, number, number])[] =
      typeof regionsOrSingle[0] === "number"
        ? [regionsOrSingle as readonly [number, number, number, number]]
        : (regionsOrSingle as readonly (readonly [number, number, number, number])[]);
    const fontName = this.ensureStandardFontResource("Helvetica");
    const { width, height } = this.getSize();
    const redactedNodes = redactPageContentAst({
      pageIndex: this.index,
      width,
      height,
      nodes: this.getContentAst(),
      regions,
      cosDoc: this.cosDoc,
      resourcesDict: this.getResourcesDict(),
      options: { ...options, fontName },
    });
    this.setContentAst(redactedNodes);
  }

  evaluateDisplayList(): PdfDisplayList {
    const { width, height } = this.getSize();
    return evaluateContentStreamToDisplayList({
      pageIndex: this.index,
      width,
      height,
      rotation: this.getRotation(),
      nodes: this.getContentAst(),
      cosDoc: this.cosDoc,
      resourcesDict: this.getResourcesDict(),
      annotations: extractPageAnnotations(this.cosDoc, this.pageDict),
    });
  }

  extractPage(options?: ExtractTextOptions): PdfExtractedPage {
    const dl = this.evaluateDisplayList();
    const extracted = extractPageFromDisplayList(dl, options);
    const tables = extractTablesFromDisplayList(dl);
    return {
      ...extracted,
      tables,
    };
  }

  extractText(options?: ExtractTextOptions): string {
    return formatExtractedPageText(this.extractPage(options), options);
  }

  extractTables(): PdfExtractedTable[] {
    return extractTablesFromDisplayList(this.evaluateDisplayList());
  }

  renderToPng(options?: RenderToPngOptions): Uint8Array {
    return renderDisplayListToPng(this.evaluateDisplayList(), options);
  }
}

export function createStandardFontHandle(standardName: Standard14FontName): PdfFontHandle {
  return {
    kind: "standard14",
    name: standardName,
    standardName,
    widthOfTextAtSize(text: string, size: number): number {
      return measureStandard14TextWidth(text, standardName, size);
    },
  };
}

export function createTrueTypeFontHandle(truetype: ParsedTrueTypeFont): PdfFontHandle {
  return {
    kind: "truetype",
    name: truetype.postScriptName,
    truetype,
    widthOfTextAtSize(text: string, size: number): number {
      return truetype.measureTextWidth(text, size);
    },
  };
}
