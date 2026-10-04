import { PdfFontAllocation, type PdfFontAllocationOptions } from "./memory.js";
export type { PdfFontAllocationOptions } from "./memory.js";
import { CosByteLexer, type CosToken } from "../cos/lexer.js";
import { bytesToString } from "../bytes.js";
import { CMap } from "../vendor/pdfjs-fonts.mjs";

export interface ParsedToUnicodeCMap {
  readonly map: ReadonlyMap<number, string>;
  readonly isTwoByte: boolean;
  iterateBytes(bytes: Uint8Array): Generator<{ charCode: number; unicode: string }, void, void>;
  decodeBytes(bytes: Uint8Array): Array<{ charCode: number; unicode: string }>;
}

function bytesToBigEndianUint(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) value = ((value << 8) | byte) >>> 0;
  return value;
}

function isString(token: CosToken | undefined): token is Extract<CosToken, { kind: "string" | "hex-string" }> {
  return token?.kind === "string" || token?.kind === "hex-string";
}

// PDF.js readToUnicode accepts numeric CIDs and restores omitted leading zero
// bytes before decoding UTF-16BE. Build in chunks to avoid argument limits.
export function decodeCMapDestination(value: number | string): string {
  if (typeof value === "number") return String.fromCodePoint(value);
  if (value.length % 2) value = "\0" + value;
  let decoded = "";
  for (let index = 0; index < value.length; index += 2) {
    decoded += String.fromCharCode((value.charCodeAt(index) << 8) | value.charCodeAt(index + 1));
  }
  return decoded;
}

export function parseCharacterCMap(cmapBytes: Uint8Array, options: PdfFontAllocationOptions = {}): CMap {
  return parseCMap(cmapBytes, new PdfFontAllocation(options));
}

function parseCMap(cmapBytes:Uint8Array,allocation:PdfFontAllocation):CMap {
  allocation.admit(1024+cmapBytes.length*32);
  const lexer=new CosByteLexer(cmapBytes),work=parseCMapTokens(allocation);let step=work.next();
  while(!step.done)step=work.next(lexer.nextToken());return step.value;
}

export function* parseCharacterCMapSteps(options:PdfFontAllocationOptions={}):Generator<void,CMap,CosToken|undefined>{
  const allocation=new PdfFontAllocation(options);allocation.admit(1024);
  return yield* parseCMapTokens(allocation);
}

export function* parseToUnicodeCMapSteps(options:PdfFontAllocationOptions={}):Generator<void,ParsedToUnicodeCMap,CosToken|undefined>{
  const allocation=new PdfFontAllocation(options);allocation.admit(1024);
  return unicodeMap(yield* parseCMapTokens(allocation),allocation);
}

export type CMapAction = {kind:"token"} | {kind:"codespace";length:number;low:number;high:number}
  | {kind:"one";low:number;value:number|string}
  | {kind:"range";low:number;high:number;value:number|string;numeric:boolean}
  | {kind:"array-start";low:number;high:number} | {kind:"array-item";value:number|string} | {kind:"array-end"};

/** Shared syntax emits mutations so retained drivers can await caller storage. */
export function* parseCMapActions():Generator<CMapAction,void,CosToken|undefined>{
  let inferredLength=1,section="",codespaces=0;
  while(true){
    const source=yield {kind:"token"};if(!source)break;
    if(source.kind==="keyword"){if(source.value==="endcmap")break;section=source.value;continue;}
    if(!isString(source)||source.bytes.length<1||source.bytes.length>4)continue;
    if(!["begincodespacerange","beginbfchar","begincidchar","beginbfrange","begincidrange"].includes(section))continue;
    const low=bytesToBigEndianUint(source.bytes),next=yield {kind:"token"};
    if(section==="begincodespacerange"){
      if(isString(next)&&next.bytes.length===source.bytes.length){codespaces++;yield {kind:"codespace",length:source.bytes.length,low,high:bytesToBigEndianUint(next.bytes)};}
    }else if(section==="beginbfchar"||section==="begincidchar"){
      inferredLength=Math.max(inferredLength,source.bytes.length);
      if(isString(next))yield {kind:"one",low,value:bytesToString(next.bytes)};
      else if(next?.kind==="number"&&next.isInteger)yield {kind:"one",low,value:next.value};
    }else{
      inferredLength=Math.max(inferredLength,source.bytes.length);
      const destination=yield {kind:"token"};if(!isString(next)||!destination)continue;
      const high=bytesToBigEndianUint(next.bytes);
      if(destination.kind==="array-start"){
        yield {kind:"array-start",low,high};
        while(true){const item=yield {kind:"token"};if(!item||item.kind==="array-end")break;
          if(isString(item))yield {kind:"array-item",value:bytesToString(item.bytes)};
          else if(item.kind==="number"&&item.isInteger)yield {kind:"array-item",value:item.value};}
        yield {kind:"array-end"};
      }else if(isString(destination))yield {kind:"range",low,high,value:bytesToString(destination.bytes),numeric:false};
      else if(destination.kind==="number"&&destination.isInteger)yield {kind:"range",low,high,value:section==="begincidrange"?destination.value:String.fromCharCode(destination.value),numeric:section==="begincidrange"};
    }
  }
  if(!codespaces)yield {kind:"codespace",length:inferredLength,low:0,high:2**(8*inferredLength)-1};
}

function* parseCMapTokens(allocation:PdfFontAllocation):Generator<void,CMap,CosToken|undefined>{
  const cmap=new CMap(false,bytes=>allocation.admit(bytes)),actions=parseCMapActions();
  let step=actions.next(),array:Array<number|string>=[],low=0,high=0;
  while(!step.done){const action=step.value;
    if(action.kind==="token"){step=actions.next(yield);continue;}
    if(action.kind==="codespace")cmap.addCodespaceRange(action.length,action.low,action.high);
    else if(action.kind==="one")cmap.mapOne(action.low,action.value);
    else if(action.kind==="array-start"){array=[];low=action.low;high=action.high;}
    else if(action.kind==="array-item"){allocation.admit(8);array.push(action.value);}
    else try{
      if(action.kind==="array-end"){cmap.mapBfRangeToArray(low,high,array);array=[];}
      else if(action.numeric)cmap.mapCidRange(action.low,action.high,action.value as number);
      else cmap.mapBfRange(action.low,action.high,action.value as string);
    }catch(error){allocation.rethrowAllocationFailure(error);}
    step=actions.next();
  }
  return cmap;
}

export function* iterateCMapCharacters(cmap: CMap, bytes: Uint8Array): Generator<{ charCode: number; isSpace: boolean }, void, void> {
  // PDF.js only requires charCodeAt; avoid constructing a token-sized string.
  const input = { charCodeAt: (index: number) => bytes[index] ?? NaN };
  const result = { charcode: 0, length: 0 };
  for (let offset = 0; offset < bytes.length;) {
    cmap.readCharCode(input, offset, result);
    if (offset + result.length > bytes.length) break;
    yield { charCode: result.charcode, isSpace: result.length === 1 && bytes[offset] === 0x20 };
    offset += result.length;
  }
}

export function readCMapCharacters(cmap: CMap, bytes: Uint8Array): Array<{ charCode: number; isSpace: boolean }> {
  return [...iterateCMapCharacters(cmap, bytes)];
}

export function parseToUnicodeCMap(cmapBytes: Uint8Array, options: PdfFontAllocationOptions = {}): ParsedToUnicodeCMap {
  const allocation = new PdfFontAllocation(options);
  return unicodeMap(parseCMap(cmapBytes,allocation),allocation);
}

function unicodeMap(cmap:CMap,allocation:PdfFontAllocation):ParsedToUnicodeCMap{
  const map = new Map<number, string>();
  cmap.forEach((code, value) => {
    allocation.admit(68 + (typeof value === "string" ? value.length * 2 : 0));
    map.set(code, decodeCMapDestination(value));
  });
  const isTwoByte = cmap.codespaceRanges.slice(1).some(ranges => ranges.length > 0);
  function* iterateBytes(bytes: Uint8Array): Generator<{ charCode: number; unicode: string }, void, void> {
    for (const { charCode } of iterateCMapCharacters(cmap, bytes)) yield {
      charCode,
      unicode: map.get(charCode) ?? (charCode >= 0x20 && charCode <= 0x10ffff ? String.fromCodePoint(charCode) : ""),
    };
  }
  return { map, isTwoByte, iterateBytes, decodeBytes(bytes) { return [...iterateBytes(bytes)]; } };

}

export function generateToUnicodeCMap(cidToUnicode: ReadonlyMap<number, string>): Uint8Array {
  const entries = [...cidToUnicode.entries()].sort((a, b) => a[0] - b[0]);
  const lines: string[] = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /PoeCode-UTF16-H def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
  ];

  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [cid, uni] of chunk) {
      const cidHex = cid.toString(16).toUpperCase().padStart(4, "0");
      let uniHex = "";
      for (let j = 0; j < uni.length; j++) {
        uniHex += uni.charCodeAt(j).toString(16).toUpperCase().padStart(4, "0");
      }
      lines.push(`<${cidHex}> <${uniHex}>`);
    }
    lines.push("endbfchar");
  }

  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return new TextEncoder().encode(lines.join("\n"));
}
