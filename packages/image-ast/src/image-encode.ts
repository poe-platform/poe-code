import {encodePdfFromStorage} from "./codecs/pdf-storage.js";
import {encodeHeifFromStorage} from "./codecs/heif-storage.js";
import {encodeRawFromStorage} from "./codecs/raw-storage.js";
import {encodeWebpFromStorage} from "./codecs/webp-storage.js";
import {encodeJpegFromStorage} from "./codecs/jpeg-storage.js";
import {encodeGifFromStorage} from "./codecs/gif-storage.js";
import {encodeTiffFromStorage} from "./codecs/tiff-storage.js";
import {encodeNetpbmFromStorage} from "./codecs/netpbm-storage.js";
import {encodeBmpFromStorage} from "./codecs/bmp-storage.js";
import {encodePngFromStorage,type StoredRgbaImage,type ImageByteStorage} from "./codecs/png-storage.js";
import type {OutputEncodeOptions,OutputInfo,ImageFormat} from "./ast.js";
import {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";

export function isStoredOutputFormat(format:ImageFormat):boolean {
 return ["pdf","heic","heif","avif","raw","png","ppm","pgm","pbm","bmp","tiff","gif","jpeg","webp"].includes(format);
}

/** Shared bounded encoder and exact final output information. */
export async function* encodeStoredImage(image:StoredRgbaImage,backing:ImageByteStorage,signal:AbortSignal,encoding:OutputEncodeOptions):AsyncGenerator<Uint8Array,OutputInfo|undefined> {
 const format=encoding.format??image.format;if(!isStoredOutputFormat(format))throw new UnsupportedStoredResource();
 let size=0;
 for await(const bytes of format==="pdf"?encodePdfFromStorage(image,backing,signal):["heic","heif","avif"].includes(format)?encodeHeifFromStorage(image,backing,signal,{...encoding,format}):format==="raw"?encodeRawFromStorage(image,backing,signal,encoding):format==="png"?encodePngFromStorage(image,backing,signal,encoding):format==="webp"?encodeWebpFromStorage(image,backing,signal,encoding):format==="jpeg"?encodeJpegFromStorage(image,backing,signal,encoding):format==="gif"?encodeGifFromStorage(image,backing,signal,encoding):format==="tiff"?encodeTiffFromStorage(image,backing,signal,encoding):format==="bmp"?encodeBmpFromStorage(image,backing,signal):encodeNetpbmFromStorage(image,backing,signal,format as "ppm"|"pgm"|"pbm")) {size+=bytes.length;yield bytes;}
    const gray=image.space==="b-w" || image.channels===1 || image.channels===2;
    return {...(image.textAutofitDpi===undefined?{}:{textAutofitDpi:image.textAutofitDpi}),format,width:image.width,height:image.height,...(format==="raw"?{depth:encoding.rawDepth??image.depth}:{}),channels:format==="raw"?image.channels:format==="webp"||format==="pdf"?(image.hasAlpha?4:3):format==="tiff"||format==="gif"?4:format==="ppm"||format==="bmp"||format==="jpeg"?3:format==="pgm"||format==="pbm"?1:gray ? image.hasAlpha ? 2 : 1 : image.hasAlpha ? 4 : 3,premultiplied:Boolean(image.wasPremultiplied),...(image.pageHeight===undefined?{}:{pageHeight:image.pageHeight}),...(image.pageHeight!==undefined&&(image.sourcePages??image.pages)!==undefined?{pages:image.sourcePages??image.pages}:{}),...(image.trimOffsetLeft===undefined?{}:{trimOffsetLeft:image.trimOffsetLeft}),...(image.trimOffsetTop===undefined?{}:{trimOffsetTop:image.trimOffsetTop}),size};
}
