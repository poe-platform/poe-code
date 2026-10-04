import type {PdfPixelStorage} from "../ast.js";
import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { JpegImage, type JpegReadRequest, type JpegReadResult } from "../vendor/pdfjs-image-decoders.mjs";
import type { JpegDecodeOptions } from "./images.js";

export interface PdfRetainedJpegOptions extends JpegDecodeOptions {
  /** Caller-owned block backing, kept open until rows finish. */
  readonly coefficientStorage?: PdfPixelStorage;
  /** Conservative input-cache and decoder allocation admission, plus one
   * output row. The caller-owned source cache is additional memory. */
  readonly maxWorkingBytes?: number;
  /** Admit input-cache and intrinsic decoder allocations to a containing owner before
   * allocation. Row scratch is separate; the owner releases admitted state. */
  readonly onDecoderAllocation?: (bytes: number) => void;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}
function limit(value: number | undefined, name: string) {
  if (value === undefined || value === Infinity) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return value;
}
/** JPEG reads encoded ranges and optionally backs DCT blocks in caller storage; it converts
 * pixels one row at a time. The source stays caller-owned and may close after
 * open() completes. close() releases the owner's decoder references. */
export class PdfRetainedJpeg {
  private constructor(private readRow: ((y: number) => Promise<Uint8Array>) | undefined,
    readonly width: number, readonly height: number, readonly components: number,
    /** Conservative admitted parse allocation, before output row scratch. */
    readonly decoderBytes: number, private readonly signal: AbortSignal, private readonly controller: AbortController) {}

  static async open(source: PdfFileSource, options: PdfRetainedJpegOptions = {}): Promise<PdfRetainedJpeg> {
    const controller=new AbortController();
    options={...options,signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal};
    const maximum = limit(options.maxWorkingBytes, "maxWorkingBytes");
    const outputMaximum = limit(options.maxOutputBytes, "maxOutputBytes");
    let allocated = 0;
    let parsing = true;
    function charge(bytes: number) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximum - allocated) throw new PdfError("E_LIMIT", "JPEG working byte limit exceeded");
      if (parsing) options.onDecoderAllocation?.(bytes);
      allocated += bytes;
    }
    options.signal?.throwIfAborted();
    const chunkBytes=Math.min(source.size,source.chunkBytes);
    // Previous cache, live backend result, and detached replacement can overlap.
    charge(chunkBytes*3);
    let cache=new Uint8Array(),cacheStart=-1,metadataBytes=0;
    async function refill(position:number){
      options.signal?.throwIfAborted();cacheStart=Math.floor(position/source.chunkBytes)*source.chunkBytes;
      const length=Math.min(source.chunkBytes,source.size-cacheStart),bytes=await source.read(cacheStart,length,options.signal);
      if(bytes.length!==length)throw new PdfError("E_PARSE","Incomplete JPEG source read");
      cache=new Uint8Array(bytes);options.signal?.throwIfAborted();
    }
    async function byteAt(position:number):Promise<number|undefined>{
      if(position<0||position>=source.size)return undefined;
      if(position<cacheStart||position>=cacheStart+cache.length)await refill(position);
      return cache[position-cacheStart];
    }
    let decodeTransform: Int32Array | undefined;
    if (options.decode) {
      charge(options.decode.length * 8); decodeTransform = new Int32Array(options.decode.length * 2);
      for (let i = 0; i < options.decode.length; i++) {
        const [low, high] = options.decode[i]!; decodeTransform[i * 2] = (high - low) * 256; decodeTransform[i * 2 + 1] = low * 255;
      }
    }
    if(options.coefficientStorage){charge(4096);charge(256);}
    const decoder = new JpegImage({ storedBlocks:!!options.coefficientStorage, colorTransform: options.colorTransform, decodeTransform, onAllocation: charge,
      onImageDimensions(width, height) {
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new PdfError("E_PARSE", "Invalid JPEG dimensions");
        if (!Number.isSafeInteger(width * height) || width * height > Math.floor(outputMaximum / 4)) throw new PdfError("E_LIMIT", "JPEG output byte limit exceeded");
      },
    });
    let start=0;
    while(start+1<source.size&&!((await byteAt(start))===255&&(await byteAt(start+1))===216)){
      if(start>0&&start%65536===0){await new Promise<void>(resolve=>setTimeout(resolve,0));options.signal?.throwIfAborted();}
      start++;
    }
    const length=source.size-start;
    let samplePosition=-1,sampleBlock:Int16Array|undefined;
    async function drive<T>(program:Generator<JpegReadRequest,T,JpegReadResult>):Promise<T>{
    let step=program.next(),requests=0;
    try{while(!step.done){options.signal?.throwIfAborted();if(++requests%65536===0){await new Promise<void>(resolve=>setTimeout(resolve,0));options.signal?.throwIfAborted();}
      const request=step.value;
      if(typeof request==="number"){
        const position=start+request;
        if(request<0||request>=length)step=program.next(undefined);
        else{if(position<cacheStart||position>=cacheStart+cache.length)await refill(position);step=program.next(cache[position-cacheStart]);}
      }else if("kind" in request){
        const backing=options.coefficientStorage;if(!backing)throw new PdfError("E_CAPABILITY","JPEG coefficient storage is required");
        const selected=options.signal?{signal:options.signal}:undefined;
        if(request.kind==="block-allocate"){
          if(!Number.isSafeInteger(request.length)||request.length<0)throw new PdfError("E_LIMIT","Invalid JPEG coefficient storage size");
          const position=backing.allocate(request.length),zeros=new Uint8Array(Math.min(4096,request.length));
          for(let offset=0;offset<request.length;offset+=zeros.length){options.signal?.throwIfAborted();await backing.write(position+offset,zeros.subarray(0,Math.min(zeros.length,request.length-offset)),selected);if(offset%65536===0)await new Promise<void>(resolve=>setTimeout(resolve,0));}
          step=program.next(position);
        }else if(request.kind==="block-write"){
          await backing.write(request.position,new Uint8Array(request.values.buffer,request.values.byteOffset,request.values.byteLength),selected);samplePosition=-1;step=program.next();
        }else{
          const position=request.kind==="sample"?request.position+Math.floor(request.index/64)*128:request.position;
          let block=sampleBlock;
          if(request.kind==="block-read"||samplePosition!==position){
            const bytes=await backing.read(position,128,selected);if(bytes.length!==128)throw new PdfError("E_PARSE","Incomplete JPEG coefficient read");
            block=new Int16Array(64);new Uint8Array(block.buffer).set(bytes);
            if(request.kind==="sample"){samplePosition=position;sampleBlock=block;}
          }
          step=program.next(request.kind==="sample"?block![request.index%64]:block);
        }
      }else{
        const low=request.start<0?Math.max(length+request.start,0):Math.min(request.start,length),high=request.end<0?Math.max(length+request.end,0):Math.min(request.end,length),count=Math.max(0,high-low);
        if(count>metadataBytes){charge((count-metadataBytes)*2);metadataBytes=count;}
        const bytes=new Uint8Array(count);let copied=0;
        while(copied<count){const position=start+low+copied;if(position<cacheStart||position>=cacheStart+cache.length)await refill(position);const take=Math.min(count-copied,cacheStart+cache.length-position);bytes.set(cache.subarray(position-cacheStart,position-cacheStart+take),copied);copied+=take;}
        step=program.next(bytes);
      }
    }return step.value;}finally{program.return(undefined as never);}
    }
    await drive(decoder.parseSteps({length}));
    const { width, height, numComponents: components } = decoder;
    if (![1, 3, 4].includes(components)) throw new PdfError("E_CAPABILITY", "Unsupported JPEG component count");
    const base = allocated; parsing = false;
    async function readRow(y: number) {
      allocated = base;
      const rgb = await drive(decoder.getDataSteps({ width, height, forceRGB: true, isSourcePDF: options.isSourcePdf ?? false, rowStart: y, rowCount: 1 }));
      if (rgb.length !== width * 3) throw new PdfError("E_PARSE", "Invalid JPEG row sample count");
      charge(width * 4);
      const row = new Uint8Array(width * 4);
      for (let x = 0; x < width; x++) { row[x * 4] = rgb[x * 3]!; row[x * 4 + 1] = rgb[x * 3 + 1]!; row[x * 4 + 2] = rgb[x * 3 + 2]!; row[x * 4 + 3] = 255; }
      return row;
    }
    return new PdfRetainedJpeg(readRow, width, height, components, base, options.signal!,controller);
  }

  async *rows(): AsyncGenerator<Uint8Array, void, void> {
    for (let y = 0; y < this.height; y++) {
      this.signal?.throwIfAborted();
      if (!this.readRow) throw new PdfError("E_CAPABILITY", "Retained JPEG decoder is closed");
      yield await this.readRow(y);
    }
  }
  close(): void { this.readRow = undefined;this.controller.abort(new PdfError("E_CAPABILITY","Retained JPEG decoder is closed")); }
}
