import type {PdfRawTextIndex} from '../extract/raw-text-index.js';
/** Preserve the existing text-only Cairo PostScript representation. The caller
 * owns the index and document header/trailer; no line string is collected. */
export async function* encodePostscriptPageChunks(index:Pick<PdfRawTextIndex,'blocks'>,pageNumber:number,options:{readonly signal?:AbortSignal}={}):AsyncGenerator<Uint8Array,void,void>{
 if(!Number.isSafeInteger(pageNumber)||pageNumber<1)throw new RangeError('Invalid PostScript page number');
 options.signal?.throwIfAborted();const encoder=new TextEncoder();let work=0;
 yield encoder.encode(`%%Page: ${pageNumber} ${pageNumber}\n/Helvetica findfont 12 scalefont setfont\n`);
 for await(const block of index.blocks())for await(const line of block.lines()){
  options.signal?.throwIfAborted();yield encoder.encode(`${Math.round(line.bbox[0])} ${Math.round(line.bbox[1])} moveto (`);let seen=false;
  for await(const word of line.words()){
   if(seen)yield new Uint8Array([32]);seen=true;
   for await(const part of word.text())for(let at=0;at<part.length;){
    if(++work%64===0)await new Promise<void>(resolve=>setTimeout(resolve,0));options.signal?.throwIfAborted();
    let end=Math.min(part.length,at+2048);if(end<part.length&&part.charCodeAt(end-1)>=0xd800&&part.charCodeAt(end-1)<=0xdbff)end--;
    yield encoder.encode(part.slice(at,end).replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)'));at=end;
   }
  }
  yield encoder.encode(') show\n');
 }
 options.signal?.throwIfAborted();yield encoder.encode('showpage\n');
}
