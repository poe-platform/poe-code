import { PdfDictionaryCursor, type PdfDictionaryEntryRequest } from "../content/dictionary-cursor.js";
import type { StoredFontEncoding } from "./stored-encoding.js";
import { StoredFontWidths } from "./stored-widths.js";
import type { StoredCffFont } from "./stored-cff.js";
import type { StoredTrueTypeFont } from "./stored-truetype.js";
import type {StoredCMap} from "./stored-cmap.js";
import type { StoredCidMap } from "./stored-cid-map.js";
import { FontWidths } from "./widths.js";
import { PdfFontAllocation, type PdfFontAllocationOptions } from "./memory.js";
import { getEncoding, type Type1Properties, type CMap } from "../vendor/pdfjs-fonts.mjs";
import { parseEmbeddedType1Font } from "./type1.js";
import { parseEmbeddedCffFont, type EmbeddedCffFont } from "./cff.js";
import { getStandardFontOutlines, type StandardFontOutlines } from "./standard-outlines.js";
import { dictGet, dictSet, type PdfCosNode, type PdfCosDict, type PdfCosArray, type PdfCosRef, type PdfCosStream, type PdfPixelStorage, type PdfStoredItems } from "../ast.js";
import type { ParsedCosDocument } from "../cos/parser.js";
import { PdfError } from "../errors.js";
import { parseCharacterCMap, parseToUnicodeCMap, type ParsedToUnicodeCMap } from "./cmap.js";
import { parseTrueTypeFont, type ParsedTrueTypeFont } from "./truetype.js";
import { buildFontEncodingDifferencesMap, buildFontEncodingGlyphNamesMap, normalizeStandard14FontName, STANDARD_14_FONTS } from "./standard14.js";
type Matrix6 = [number, number, number, number, number, number];
export type FontResolutionRequest = PdfDictionaryEntryRequest | {kind:"font-encoding";array:PdfCosArray} | {kind:"font-label";lookup:(code:number)=>Promise<string|undefined>;code:number} | {kind:"array-item"; items:PdfStoredItems; position:number} | {kind:"font-width-set";widths:StoredFontWidths;first:number;width:number;last?:number} | {kind:"truetype-map";font:StoredTrueTypeFont;code?:number;name?:string} | { kind: "resolve"; node: PdfCosNode | undefined; storeRootArray?:boolean; storeRootDictionary?:boolean } | { kind: "decode"; stream: PdfCosStream; encodingName?: string | undefined; differences?: ReadonlyMap<number,string>; storedEncoding?:StoredFontEncoding; type1Properties?: Type1Properties; purpose?: "type1" | "cid-map" | "unicode-cmap" | "encoding-cmap" | "truetype" | "cff" };
export type FontResolutionResult = StoredFontEncoding | StoredCffFont | StoredTrueTypeFont | PdfCosNode | Uint8Array | StoredCidMap | StoredCMap | ParsedToUnicodeCMap | CMap | undefined;
function* resolve(node: PdfCosNode | undefined, storeRootArray = false, storeRootDictionary = false): Generator<FontResolutionRequest, PdfCosNode | undefined, FontResolutionResult> {
  const value = yield { kind: "resolve", node, storeRootArray, storeRootDictionary };
  if (value && !("kind" in value)) throw new TypeError("Font lookup returned stream bytes instead of a COS value");
  return value;
}
function* resolveDict(node: PdfCosNode | undefined, backed = false): Generator<FontResolutionRequest, PdfCosDict | undefined, FontResolutionResult> {
  const value = yield* resolve(node, false, backed); return value?.kind === "dict" ? value : value?.kind === "stream" ? value.dict : undefined;
}
function* resolveArray(node: PdfCosNode | undefined, backed = false): Generator<FontResolutionRequest, PdfCosArray | undefined, FontResolutionResult> {
  const value = yield* resolve(node, backed); return value?.kind === "array" ? value : undefined;
}

function arrayCursor(array: PdfCosArray) {
  let index = 0, position = array.storedItems?.position ?? -1;
  return {
    get remaining() { return (array.storedItems?.length ?? array.items.length) - index; },
    *next(): Generator<FontResolutionRequest, PdfCosNode | undefined, FontResolutionResult> {
      if (index >= (array.storedItems?.length ?? array.items.length)) return undefined;
      index++;
      if (!array.storedItems) return array.items[index - 1];
      const record = (yield {kind:"array-item", items:array.storedItems, position}) as PdfCosArray;
      const next = record.items[1];
      if (next?.kind !== "number") throw new Error("Invalid font array record");
      position = next.value;
      if (index === array.storedItems.length && position !== -1) throw new Error("Invalid stored array terminator");
      return record.items[0];
    }
  };
}

export interface ResolvedPageFont {
  readonly name: string;
  readonly baseFont: string;
  readonly subtype: string;
  readonly isTwoByteCid: boolean;
  readonly cmap?: ParsedToUnicodeCMap | undefined;
  readonly storedCMap?: StoredCMap | undefined;
  readonly storedEncodingCMap?: StoredCMap | undefined;
  readonly encodingCMap?: CMap | undefined;
  readonly differences: ReadonlyMap<number, string>;
  readonly glyphNames: ReadonlyMap<number, string>;
  readonly storedEncoding?: StoredFontEncoding;
  readonly widths: Pick<ReadonlyMap<number, number>, "get" | "has"> | StoredFontWidths;
  readonly defaultWidth: number;
  readonly fontMatrix?: Matrix6 | undefined;
  readonly charProcs?: PdfCosDict | undefined;
  readonly fontResources?: PdfCosDict | undefined;
  readonly embeddedCff?: EmbeddedCffFont | StoredCffFont | undefined;
  readonly storedTrueType?: StoredTrueTypeFont | undefined;
  readonly embeddedTrueType?: ParsedTrueTypeFont | undefined;
  readonly cidToGid?: Uint16Array | undefined;
  readonly storedCidToGid?: StoredCidMap | undefined;
  readonly simpleToGid?: ReadonlyMap<number, number> | undefined;
  readonly standardOutlines?: StandardFontOutlines | undefined;
}

export function* resolvePageFontsSteps(rootRef: PdfCosRef | undefined, resourcesDict: PdfCosDict | undefined, selectedName?: string, options: Pick<PdfFontAllocationOptions, "onAllocation"> & {resourceStorage?:PdfPixelStorage;signal?:AbortSignal} = {}): Generator<FontResolutionRequest, Map<string, ResolvedPageFont>, FontResolutionResult> {
    const allocation = new PdfFontAllocation(options);
    const allocationOptions = { onAllocation: (bytes: number) => allocation.admit(bytes) };
    const fonts = new Map<string, ResolvedPageFont>();
    const catalog = (yield* resolveDict(rootRef));
    const acroForm = catalog ? (yield* resolveDict(dictGet(catalog, "AcroForm"))) : undefined;
    const drDict = acroForm ? (yield* resolveDict(dictGet(acroForm, "DR"))) : undefined;
    const drFontDict = drDict ? (yield* resolveDict(dictGet(drDict, "Font"), true)) : undefined;
    const pageFontDict = resourcesDict ? (yield* resolveDict(dictGet(resourcesDict, "Font"), true)) : undefined;
    for (const dictionary of [drFontDict, pageFontDict]) {
      if (!dictionary) continue;
      const cursor = new PdfDictionaryCursor(dictionary);
      for (;;) {
        const item = yield* cursor.next();
        if (item.done) break;
        const entry = item.value;
        const fName = entry.key.decoded;
        if (selectedName !== undefined && fName !== selectedName)
            continue;
        const fObj = (yield* resolveDict(entry.value));
        if (!fObj)
            continue;
        allocation.admit(1024);
        const subtypeNode = (yield* resolve(dictGet(fObj, "Subtype")));
        const subtype = subtypeNode?.kind === "name" ? subtypeNode.decoded : "Type1";
        const baseFontNode = (yield* resolve(dictGet(fObj, "BaseFont")));
        const baseFont = baseFontNode?.kind === "name" ? baseFontNode.decoded : "Helvetica";
        let cmap: ParsedToUnicodeCMap | undefined;
        let storedCMap: StoredCMap | undefined;
        const toUniNode = (yield* resolve(dictGet(fObj, "ToUnicode")));
        if (toUniNode?.kind === "stream") {
            try {
                const value=yield {kind:"decode",stream:toUniNode,purpose:"unicode-cmap"};
                if(value instanceof Uint8Array)cmap=parseToUnicodeCMap(value,allocationOptions);
                else if(value&&"storedCMap" in value)storedCMap=value;
                else if(value&&"iterateBytes" in value)cmap=value;
                else throw new TypeError("Font decoder did not return a Unicode CMap");
            }
            catch (error) {
                allocation.rethrowAllocationFailure(error);
                if (error instanceof PdfError && error.code === "E_LIMIT")
                    throw error;
                // PDF.js readToUnicode ignores a damaged optional mapping: the font's
                // character-code/CID mapping can still supply its visible outlines.
            }
        }
        const encNode = (yield* resolve(dictGet(fObj, "Encoding")));
        if (encNode?.kind === "dict") {
            const diffRef = dictGet(encNode, "Differences");
            if (diffRef?.kind === "ref") {
                const resolvedDiff = (yield* resolve(diffRef, true));
                if (resolvedDiff?.kind === "array") {
                    dictSet(encNode, "Differences", resolvedDiff);
                }
            }
        }
        const differenceArray = encNode?.kind === "dict" ? dictGet(encNode, "Differences") : undefined;
        let storedEncoding:StoredFontEncoding|undefined;
        if(options.resourceStorage && differenceArray?.kind === "array") {
            const value=yield {kind:"font-encoding",array:differenceArray};
            if(!value || !("storedEncoding" in value))throw new TypeError("Expected stored font encoding");
            storedEncoding=value;
        }
        allocation.admit(32768 + (!storedEncoding && differenceArray?.kind === "array" ? differenceArray.items.length * 128 : 0));
        const differences = storedEncoding ? new Map<number,string>() : buildFontEncodingDifferencesMap(encNode);
        const glyphNames = storedEncoding ? new Map<number,string>() : buildFontEncodingGlyphNamesMap(encNode);
        function* glyphName(code:number):Generator<FontResolutionRequest,string|undefined,FontResolutionResult>{
            if(!storedEncoding)return glyphNames.get(code);
            const result=yield {kind:"font-label",lookup:storedEncoding.glyphName,code};
            return result && "kind" in result && result.kind==="name" ? result.decoded : undefined;
        }
        const widths = options.resourceStorage ? new StoredFontWidths(options.resourceStorage,{...allocationOptions,...(options.signal?{signal:options.signal}:{})}) : new FontWidths(allocation);
        function* setWidth(first:number,width:number,last=first):Generator<FontResolutionRequest,void,FontResolutionResult>{
            if(widths instanceof StoredFontWidths)yield {kind:"font-width-set",widths,first,width,last};
            else widths.set(first,width,last);
        }
        let defaultWidth = 556;
        // ToUnicode labels codes; only the font's encoding determines their width.
        const isTwoByteCid = subtype === "Type0";
        let fontMatrix: Matrix6 | undefined;
        let charProcs: PdfCosDict | undefined;
        let fontResources: PdfCosDict | undefined;
        if (subtype === "Type3") {
            const fmArr = (yield* resolveArray(dictGet(fObj, "FontMatrix")));
            if (fmArr && fmArr.items.length >= 6) {
                const mn = function* (idx: number, fb = 0) {
                    const r = (yield* resolve(fmArr.items[idx]));
                    return r?.kind === "number" ? r.value : fb;
                };
                fontMatrix = [(yield* mn(0, 0.001)), (yield* mn(1, 0)), (yield* mn(2, 0)), (yield* mn(3, 0.001)), (yield* mn(4, 0)), (yield* mn(5, 0))];
            }
            else {
                fontMatrix = [0.001, 0, 0, 0.001, 0, 0];
            }
            charProcs = (yield* resolveDict(dictGet(fObj, "CharProcs")));
            fontResources = (yield* resolveDict(dictGet(fObj, "Resources")));
        }
        const type3Scale1000 = subtype === "Type3" && fontMatrix
            ? Math.hypot(fontMatrix[0], fontMatrix[1]) * 1000
            : 1;
        if (subtype === "Type0") {
            const descArr = (yield* resolveArray(dictGet(fObj, "DescendantFonts")));
            const cidDict = descArr && descArr.items[0] ? (yield* resolveDict(descArr.items[0])) : undefined;
            if (cidDict) {
                const dwNode = (yield* resolve(dictGet(cidDict, "DW")));
                if (dwNode?.kind === "number")
                    defaultWidth = dwNode.value;
                const wArr = (yield* resolveArray(dictGet(cidDict, "W"), true));
                if (wArr) {
                    const cursor = arrayCursor(wArr);
                    while (cursor.remaining) {
                        const first = (yield* resolve(yield* cursor.next(), true));
                        const second = (yield* resolve(yield* cursor.next(), true));
                        if (first?.kind === "number" && second?.kind === "array") {
                            const nested = arrayCursor(second);
                            for (let k = 0; nested.remaining; k++) {
                                const wItem = (yield* resolve(yield* nested.next()));
                                if (wItem?.kind === "number") {
                                    yield* setWidth(first.value + k, wItem.value);
                                }
                            }
                        }
                        else if (first?.kind === "number" && second?.kind === "number") {
                            const third = (yield* resolve(yield* cursor.next(), true));
                            if (third?.kind === "number") {
                                if (!Number.isSafeInteger(first.value) || !Number.isSafeInteger(second.value))
                                    throw new PdfError("E_LIMIT", "Unsafe PDF font width range");
                                yield* setWidth(first.value, third.value, second.value);
                            }
                        }
                    }
                }
            }
        }
        else {
            const firstCharNode = (yield* resolve(dictGet(fObj, "FirstChar")));
            const widthsArr = (yield* resolveArray(dictGet(fObj, "Widths"), true));
            if (widthsArr) {
                // PDF.js extractWidths: explicit tables use MissingWidth, not a
                // standard-font width for characters omitted from the table.
                const descriptor = (yield* resolveDict(dictGet(fObj, "FontDescriptor")));
                const missingWidth = descriptor ? (yield* resolve(dictGet(descriptor, "MissingWidth"))) : undefined;
                defaultWidth = (missingWidth?.kind === "number" ? missingWidth.value : 0) * type3Scale1000;
                const firstChar = firstCharNode?.kind === "number" ? firstCharNode.value : 0;
                const cursor = arrayCursor(widthsArr);
                for (let k = 0; cursor.remaining; k++) {
                    const wItem = (yield* resolve(yield* cursor.next()));
                    if (wItem?.kind === "number") {
                        yield* setWidth(firstChar + k, wItem.value * type3Scale1000);
                    }
                }
            }
            else {
                const stdMetrics = STANDARD_14_FONTS[normalizeStandard14FontName(baseFont)];
                defaultWidth = stdMetrics.defaultWidth;
                if(widths instanceof StoredFontWidths) widths.setDefaults(stdMetrics.widthsByCode);
                else for (const [codeStr, wVal] of Object.entries(stdMetrics.widthsByCode)) {
                    yield* setWidth(Number(codeStr), wVal);
                }
            }
        }
        let embeddedCff: EmbeddedCffFont | StoredCffFont | undefined;
        let storedTrueType: StoredTrueTypeFont | undefined;
        let embeddedTrueType: ParsedTrueTypeFont | undefined;
        let simpleToGid: Map<number, number> | undefined;
        const fDescDirect = (yield* resolveDict(dictGet(fObj, "FontDescriptor")));
        const descArrForTt = subtype === "Type0" ? (yield* resolveArray(dictGet(fObj, "DescendantFonts"))) : undefined;
        const cidDictForTt = descArrForTt && descArrForTt.items[0] ? (yield* resolveDict(descArrForTt.items[0])) : undefined;
        const fDesc = fDescDirect ?? (cidDictForTt ? (yield* resolveDict(dictGet(cidDictForTt, "FontDescriptor"))) : undefined);
        let cidToGid: Uint16Array | undefined;
        let storedCidToGid: StoredCidMap | undefined;
        const cidMap = cidDictForTt ? (yield* resolve(dictGet(cidDictForTt, "CIDToGIDMap"))) : undefined;
        if (cidMap?.kind === "stream") {
            // PDF.js readCidToGidMap reads big-endian pairs; a trailing high byte
            // gets a zero low byte. Retain explicit zero entries and stream extent.
            const bytes = yield {kind:"decode",stream:cidMap,purpose:"cid-map"};
            if(bytes && "byteLength" in bytes && "storage" in bytes)storedCidToGid=bytes;
            else if(bytes instanceof Uint8Array){
            allocation.admit(Math.ceil(bytes.length / 2) * 2);
            cidToGid = new Uint16Array(Math.ceil(bytes.length / 2));
            for (let i = 0; i < bytes.length; i += 2)
                cidToGid[i / 2] = (bytes[i]! << 8) | (bytes[i + 1] ?? 0);
            }else throw new TypeError("Font decoder did not return CID map bytes");
        }
        if (fDesc) {
            const type1Program = (yield* resolve(dictGet(fDesc, "FontFile")));
            const program = (yield* resolve(dictGet(fDesc, "FontFile2"))) ?? (yield* resolve(dictGet(fDesc, "FontFile3"))) ?? type1Program;
            if (program?.kind === "stream") {
                const programType = (yield* resolve(dictGet(program.dict, "Subtype")));
                const baseEncoding = encNode?.kind === "dict" ? (yield* resolve(dictGet(encNode, "BaseEncoding"))) : encNode;
                if (program === type1Program) {
                    const length1 = (yield* resolve(dictGet(program.dict, "Length1")));
                    const length2 = (yield* resolve(dictGet(program.dict, "Length2")));
                    const flags = (yield* resolve(dictGet(fDesc, "Flags")));
                    const type1Properties: Type1Properties = {
                        length1: length1?.kind === "number" ? length1.value : 0,
                        length2: length2?.kind === "number" ? length2.value : 0,
                        flags: flags?.kind === "number" ? flags.value : 0,
                        fontMatrix: [0.001, 0, 0, 0.001, 0, 0], bbox: [0, 0, 0, 0],
                        baseEncodingName: baseEncoding?.kind === "name" ? baseEncoding.decoded : undefined,
                        differences: glyphNames, overridableEncoding: true, widths: widths instanceof FontWidths ? widths.createType1View() : {},
                        composite: subtype === "Type0", cMap: { charCodeOf: (cid: number) => cid },
                    };
                    const decoded=yield {kind:"decode",stream:program,purpose:"type1",type1Properties,...(storedEncoding?{storedEncoding}:{})};
                    if(decoded && "storedCff" in decoded)embeddedCff=decoded;
                    else if(decoded instanceof Uint8Array)embeddedCff=parseEmbeddedType1Font(decoded,type1Properties,allocationOptions);
                    else throw new TypeError("Font decoder did not return a Type1 font");
                }
                else if (programType?.kind === "name" && (programType.decoded === "Type1C" || programType.decoded === "CIDFontType0C")) {
                    const encodingName=baseEncoding?.kind === "name" ? baseEncoding.decoded : undefined;
                    const decoded=yield {kind:"decode",stream:program,purpose:"cff",encodingName,differences:glyphNames,...(storedEncoding?{storedEncoding}:{})};
                    if(decoded && "storedCff" in decoded)embeddedCff=decoded;
                    else if(decoded instanceof Uint8Array)embeddedCff=parseEmbeddedCffFont(decoded,encodingName,glyphNames,allocationOptions);
                    else throw new TypeError("Font decoder did not return a CFF font");
                }
                else {
                    const decoded = yield {kind:"decode",stream:program,purpose:"truetype"};
                    if(decoded && "getGlyphId" in decoded) storedTrueType=decoded;
                    else if(decoded instanceof Uint8Array) embeddedTrueType=parseTrueTypeFont(decoded,allocationOptions);
                    else throw new TypeError("Font decoder did not return a TrueType font");
                    if(storedTrueType && subtype!=="Type0" && (storedTrueType.isSymbolicCmap || !storedTrueType.hasCmap)) {
                        simpleToGid=new Map();
                        const encoding=baseEncoding?.kind==="name"?getEncoding(baseEncoding.decoded):undefined;
                        for(let code=0;code<256;code++) {
                            let result:FontResolutionResult;
                            if(storedTrueType.isSymbolicCmap) {
                                result=yield {kind:"truetype-map",font:storedTrueType,code:0xf000+code};
                                if(result && "kind" in result && result.kind==="number" && result.value===0)result=yield {kind:"truetype-map",font:storedTrueType,code};
                            } else {
                                const name=(yield* glyphName(code))||encoding?.[code];if(!name)continue;
                                result=yield {kind:"truetype-map",font:storedTrueType,name};
                            }
                            if(!result || !("kind" in result) || result.kind!=="number")throw new TypeError("Expected TrueType glyph ID");
                            if(result.value>0)simpleToGid.set(code,result.value);
                        }
                    }
                    if (subtype !== "Type0" && embeddedTrueType?.isSymbolicCmap) {
                        // PDF.js maps Windows Symbol (3,0) entries by encoded byte,
                        // clearing the high byte only for the special F000–F0FF range.
                        simpleToGid = new Map();
                        for (let code = 0; code < 256; code++) {
                            const gid = embeddedTrueType.getGlyphId(0xf000 + code) || embeddedTrueType.getGlyphId(code);
                            if (gid > 0)
                                simpleToGid.set(code, gid);
                        }
                    }
                    else if (subtype !== "Type0" && embeddedTrueType && !embeddedTrueType.hasCmap) {
                        // PDF.js recovers missing mappings from BaseEncoding/Differences
                        // and post names. ToUnicode describes text, not glyph selection.
                        simpleToGid = new Map();
                        const encoding = baseEncoding?.kind === "name" ? getEncoding(baseEncoding.decoded) : undefined;
                        for (let code = 0; code < 256; code++) {
                            const name = (yield* glyphName(code)) || encoding?.[code];
                            const gid = name ? embeddedTrueType.glyphNames.indexOf(name) : -1;
                            if (gid > 0)
                                simpleToGid.set(code, gid);
                        }
                    }
                }
                for (const [code, unicode] of embeddedCff?.unicodeByCode ?? []) {
                    if (!differences.has(code))
                        differences.set(code, unicode);
                }
            }
        }
        const standardOutlines = !embeddedTrueType && !storedTrueType && !embeddedCff && subtype !== "Type3" ? getStandardFontOutlines(baseFont, options.onAllocation ? allocationOptions : {}) : undefined;
        for (const [code, unicode] of standardOutlines?.defaultUnicode ?? []) {
            if (!differences.has(code))
                differences.set(code, unicode);
        }
        let encodingCMap:CMap|undefined;
        let storedEncodingCMap:StoredCMap|undefined;
        if(subtype==="Type0"&&encNode?.kind==="stream"){
          const value=yield {kind:"decode",stream:encNode,purpose:"encoding-cmap"};
          if(value instanceof Uint8Array)encodingCMap=parseCharacterCMap(value,allocationOptions);
          else if(value&&"storedCMap" in value)storedEncodingCMap=value;
          else if(value&&"lookup" in value)encodingCMap=value;
          else throw new TypeError("Font decoder did not return an encoding CMap");
        }
        fonts.set(fName, {
            name: fName,
            baseFont,
            subtype,
            isTwoByteCid,
            cmap,
            encodingCMap,
            storedCMap,
            storedEncodingCMap,
            differences,
            glyphNames,
            widths,
            defaultWidth,
            fontMatrix,
            charProcs,
            fontResources,
            embeddedTrueType,
            storedTrueType,
            cidToGid,
            storedCidToGid,
            ...(storedEncoding?{storedEncoding}:{}),
            simpleToGid,
            embeddedCff,
            standardOutlines,
        });
    }
    }
    return fonts;
}

export function resolvePageFonts(doc: ParsedCosDocument | undefined, resourcesDict: PdfCosDict | undefined, selectedName?: string): Map<string, ResolvedPageFont> {
  if (!doc) return new Map();
  const steps = resolvePageFontsSteps(doc.rootRef, resourcesDict, selectedName);
  let step = steps.next();
  while (!step.done) {
    let value: FontResolutionResult;
    try { if(step.value.kind==="dictionary-entry" || step.value.kind==="font-encoding" || step.value.kind==="font-label" || step.value.kind==="array-item" || step.value.kind==="truetype-map" || step.value.kind==="font-width-set")throw new TypeError("Stored font requires asynchronous evaluation"); value = step.value.kind === "resolve" ? doc.resolve(step.value.node) : doc.decodeStream(step.value.stream); }
    catch (error) { step = steps.throw(error); continue; }
    step = steps.next(value);
  }
  return step.value;
}
