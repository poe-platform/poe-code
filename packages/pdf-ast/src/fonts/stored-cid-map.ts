import type { PdfPixelStorage } from "../ast.js";

export interface StoredCidMap {
  readonly storage: PdfPixelStorage;
  readonly position: number;
  readonly byteLength: number;
}

/** CID maps contain big-endian pairs; a final unpaired high byte has a zero low byte. */
export async function readStoredCidGlyph(map:StoredCidMap,code:number,signal?:AbortSignal):Promise<number>{
  signal?.throwIfAborted();
  if(!Number.isSafeInteger(code)||code<0||code*2>=map.byteLength)return 0;
  const bytes=await map.storage.read(map.position+code*2,Math.min(2,map.byteLength-code*2),signal?{signal}:undefined);
  signal?.throwIfAborted();return ((bytes[0]??0)<<8)|(bytes[1]??0);
}
