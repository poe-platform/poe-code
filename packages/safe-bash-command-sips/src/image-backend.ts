import {yieldTurn} from "safe-bash-contracts/yield";
import {decodeImage,encodeImage,readImageMetadata,parseColor,rotateImageSteps,flipImageSteps,flopImageSteps,resizeImageSteps,extractImageSteps,extendImageSteps,type RgbaImage,type ImageMetadata,type ImageFormat,type OutputEncodeOptions} from "@poe-code/image-ast/portable";
import {readProperties,writeProperties} from "./properties.js";

export class ImageStorageFailure extends Error {constructor(readonly reason:unknown){super("Caller image backing failed");}}

export type ImageOperation<T>=T|Promise<T>|Generator<void,T,void>;
export type ImageSteps<T>=Generator<void|Promise<void>,T,void>;
export interface SipsImageBackend<Bytes,Image>{
 decode(bytes:Bytes):ImageOperation<Image>;
 metadata(bytes:Bytes):ImageOperation<ImageMetadata>;
 readProperties(bytes:Bytes,format:ImageFormat):ImageOperation<Map<string,string|null>>;
 encode(image:Image,options:OutputEncodeOptions):ImageOperation<Bytes>;
 writeProperties(bytes:Bytes,format:ImageFormat,properties:ReadonlyMap<string,string|null>):ImageOperation<Bytes>;
 rotate(image:Image,degrees:number,background:ReturnType<typeof parseColor>):ImageOperation<Image>;
 flip(image:Image):ImageOperation<Image>;
 flop(image:Image):ImageOperation<Image>;
 resize(image:Image,options:Parameters<typeof resizeImageSteps>[1]):ImageOperation<Image>;
 extract(image:Image,options:Parameters<typeof extractImageSteps>[1]):ImageOperation<Image>;
 extend(image:Image,options:Parameters<typeof extendImageSteps>[1]):ImageOperation<Image>;
 oddCanvas(image:Image,width:number,height:number,destinationWidth:number,destinationHeight:number,background:Parameters<typeof applySipsOddCanvasCropOrPadSteps>[5]):ImageOperation<Image>;
}

/** Preserve cooperative generators while also suspending for retained I/O. */
export function* performImage<T>(operation:ImageOperation<T>):ImageSteps<T>{
 if(typeof operation==="object"&&operation!==null&&"next" in operation&&typeof operation.next==="function")return yield* operation as Generator<void,T,void>;
 if(typeof operation==="object"&&operation!==null&&"then" in operation&&typeof operation.then==="function"){
  let value:T;yield (operation as Promise<T>).then(result=>{value=result;});return value!;
 }
 return operation as T;
}

/** Keep the codec boundary: lossy formats must materialize between these operations. */
export function* roundtripImage<Bytes,Image>(backend:SipsImageBackend<Bytes,Image>,image:Image):ImageSteps<Image>{
 const encoded=yield* performImage(backend.encode(image,{}));
 return yield* performImage(backend.decode(encoded));
}

export function canvasSample(a:number,b:number,c:number,d:number,wx0:number,wx1:number,wy0:number,wy1:number):number{
 const value=a*wx0*wy0+b*wx1*wy0+c*wx0*wy1+d*wx1*wy1;
 return Math.max(0,Math.min(255,Math.round(value)));
}

function* applySipsOddCanvasCropOrPadSteps(image: RgbaImage, curW: number, curH: number, dstW: number, dstH: number, padColorInput: {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly alpha?: number;
} | string): Generator<void, RgbaImage, void> {
    let work = 0;
    const rawObj = encodeImage(image.channels === 2 ? { ...image, space: "srgb", channels: 4 } : image, { format: "raw" });
    const ch = rawObj.channels as 1 | 2 | 3 | 4;
    const src = rawObj.data;
    const pad = parseColor(padColorInput, ch === 4 || ch === 2 ? 0 : 255);
    const bg = [pad.r, pad.g, pad.b, pad.a];
    const offsetX = (dstW - curW) / 2;
    const offsetY = (dstH - curH) / 2;
    const out = new Uint8Array(dstW * dstH * ch);
    const sampleCh = (ix: number, iy: number, c: number): number => {
        if (ix < 0 || ix >= curW || iy < 0 || iy >= curH) {
            return bg[c] ?? 0;
        }
        return src[(iy * curW + ix) * ch + c]!;
    };
    for (let y = 0; y < dstH; y++) {
        if (++work % 16384 === 0)
            yield;
        const sy = y - offsetY;
        const iy0 = Math.floor(sy);
        const wy1 = sy - iy0;
        const wy0 = 1 - wy1;
        const iy1 = iy0 + 1;
        for (let x = 0; x < dstW; x++) {
            if (++work % 16384 === 0)
                yield;
            const sx = x - offsetX;
            const ix0 = Math.floor(sx);
            const wx1 = sx - ix0;
            const wx0 = 1 - wx1;
            const ix1 = ix0 + 1;
            const dIdx = (y * dstW + x) * ch;
            for (let c = 0; c < ch; c++) {
                if (++work % 16384 === 0)
                    yield;
                out[dIdx+c]=canvasSample(sampleCh(ix0,iy0,c),sampleCh(ix1,iy0,c),sampleCh(ix0,iy1,c),sampleCh(ix1,iy1,c),wx0,wx1,wy0,wy1);
            }
        }
    }
    return decodeImage(out, { raw: { width: dstW, height: dstH, channels: ch } });
}

export const bufferedImageBackend:SipsImageBackend<Uint8Array,RgbaImage>={
 decode:decodeImage,metadata:readImageMetadata,readProperties,
 encode:(image,options)=>encodeImage(image,options).data,writeProperties,
 rotate:rotateImageSteps,flip:flipImageSteps,flop:flopImageSteps,
 resize:resizeImageSteps,extract:extractImageSteps,extend:extendImageSteps,
 oddCanvas:applySipsOddCanvasCropOrPadSteps
};

export async function runImageSteps<T>(steps:ImageSteps<T>,signal:AbortSignal):Promise<T>{
 try{
  let next=steps.next();
  while(!next.done){
   try{await(next.value??yieldTurn(signal));signal.throwIfAborted();next=steps.next();}
   catch(error){signal.throwIfAborted();next=steps.throw(error);}
  }
  return next.value;
 }finally{steps.return(undefined as T);}
}
