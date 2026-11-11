import { encodePsdFromStorage } from "./codecs/psd-output.js";
import { encodeQoiFromStorage } from "./codecs/qoi-output.js";
import { encodeXbmFromStorage } from "./codecs/xbm-output.js";
import { encodeXwdFromStorage } from "./codecs/xwd-output.js";
import { encodeXpmFromStorage } from "./codecs/xpm-output.js";
import { encodeHdrFromStorage } from "./codecs/hdr-output.js";
import { encodeExrFromStorage } from "./codecs/exr-output.js";
import { encodePfmFromStorage } from "./codecs/pfm-output.js";
import {encodeTgaFromStorage} from "./codecs/tga-output.js";
import {encodeIcoFromStorage} from "./codecs/ico-output.js";
import {encodeMngFromStorage} from "./codecs/mng.js";
import {encodeApngFromStorage} from "./codecs/apng-output.js";
import {storedNetpbmFormat} from "./codecs/netpbm-format.js";
import { encodeMiffFromStorage, miffChannels } from "./codecs/miff.js";
import {tiffChannels} from "./codecs/tiff-layout.js";
import {imageOutputFormat} from "./output-format.js";
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
 return ["psd","qoi","xbm","xpm","xwd","hdr","exr","phm","pfm","tga","ico","cur","mng","apng","miff","pdf","heic","heif","avif","raw","png","pnm","pam","ppm","pgm","pbm","bmp","tiff","gif","jpeg","webp"].includes(format);
}

/** Shared bounded encoder and exact final output information. */
export async function* encodeStoredImage(image:StoredRgbaImage,backing:ImageByteStorage,signal:AbortSignal,encoding:OutputEncodeOptions):AsyncGenerator<Uint8Array,OutputInfo|undefined> {
 const requested=imageOutputFormat(image.format,encoding.format);
 const format=requested==="pnm"?await storedNetpbmFormat(image,backing,signal):requested;if(!isStoredOutputFormat(format))throw new UnsupportedStoredResource();
 const pfmChannels = (format === "pfm" || format === "phm") ? (image.storedDataFloat ? image.channels === 1 ? 1 : 3 : await storedNetpbmFormat(image,backing,signal) === "ppm" ? 3 : 1) : undefined;
 let size=0;
 for await(const bytes of format==="psd"?encodePsdFromStorage(image,backing,signal):format==="qoi"?encodeQoiFromStorage(image,backing,signal):format==="xbm"?encodeXbmFromStorage(image,backing,signal):format==="xwd"?encodeXwdFromStorage(image,backing,signal):format==="xpm"?encodeXpmFromStorage(image,backing,signal):format==="hdr"?encodeHdrFromStorage(image,backing,signal):format==="exr"?encodeExrFromStorage(image,backing,signal):(format==="pfm"||format==="phm")?encodePfmFromStorage(image,backing,signal,pfmChannels!,format,encoding.endian):format==="tga"?encodeTgaFromStorage(image,backing,signal,encoding):format==="ico"||format==="cur"?encodeIcoFromStorage(image,backing,signal):format==="mng"?encodeMngFromStorage(image,backing,signal,encoding):format==="apng"?encodeApngFromStorage(image,backing,signal,encoding):format==="miff"?encodeMiffFromStorage(image,backing,signal,encoding.miffDepth,encoding.miffCompression,encoding.loop):format==="pdf"?encodePdfFromStorage(image,backing,signal):["heic","heif","avif"].includes(format)?encodeHeifFromStorage(image,backing,signal,{...encoding,format}):format==="raw"?encodeRawFromStorage(image,backing,signal,encoding):format==="png"?encodePngFromStorage(image,backing,signal,encoding):format==="webp"?encodeWebpFromStorage(image,backing,signal,encoding):format==="jpeg"?encodeJpegFromStorage(image,backing,signal,encoding):format==="gif"?encodeGifFromStorage(image,backing,signal,encoding):format==="tiff"?encodeTiffFromStorage(image,backing,signal,encoding):format==="bmp"?encodeBmpFromStorage(image,backing,signal,encoding):encodeNetpbmFromStorage(image,backing,signal,format as "ppm"|"pgm"|"pbm"|"pam",encoding.netpbmDepth,encoding.netpbmAscii)) {size+=bytes.length;yield bytes;}
    const pngCoder = format === "png" && encoding.pngCoder !== "png00" ? encoding.pngCoder : undefined;
    const pngColorType = format === "png" && !pngCoder ? encoding.pngColorType : undefined;
    const hasAlpha = pngColorType === 4 || pngColorType === 6 || (pngColorType !== 0 && pngColorType !== 2 && pngColorType !== 3 && (pngCoder === "png32" || pngCoder === "png64" || (!(format === "png" && encoding.forceOpaque) && pngCoder !== "png24" && pngCoder !== "png48" && image.hasAlpha)));
    const gray=!pngCoder && pngColorType !== 2 && pngColorType !== 3 && pngColorType !== 6 && (image.space==="b-w" || image.channels===1 || image.channels===2);
    return {...(image.textAutofitDpi===undefined?{}:{textAutofitDpi:image.textAutofitDpi}),format,width:image.width,height:image.height,...(format==="raw"?{depth:encoding.rawDepth??image.depth}:{}),channels:pfmChannels??(format==="hdr"||format==="xwd"?3:format==="ico"||format==="cur"||format==="mng"||format==="apng"?4:format==="miff"?miffChannels(image):format==="raw"?image.channels:format==="psd"||format==="qoi"||format==="xpm"||format==="exr"||format==="tga"||format==="pam"||format==="webp"||format==="pdf"?(image.hasAlpha?4:3):format==="tiff"?(encoding.tiffCompression==="jpeg"?3:tiffChannels(image)):format==="gif"?4:format==="jpeg"?(image.space==="b-w"||image.space==="grey16"?1:image.space==="cmyk"?4:3):format==="ppm"||format==="bmp"?3:format==="xbm"||format==="pgm"||format==="pbm"?1:gray ? hasAlpha ? 2 : 1 : hasAlpha ? 4 : 3),premultiplied:Boolean(image.wasPremultiplied),...(image.pageHeight===undefined?{}:{pageHeight:image.pageHeight}),...(image.pageHeight!==undefined&&(image.sourcePages??image.pages)!==undefined?{pages:image.sourcePages??image.pages}:{}),...(image.trimOffsetLeft===undefined?{}:{trimOffsetLeft:image.trimOffsetLeft}),...(image.trimOffsetTop===undefined?{}:{trimOffsetTop:image.trimOffsetTop}),size};
}
