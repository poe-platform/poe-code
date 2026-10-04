import {rejectUnknownImage} from "./unsupported-storage.js";
import {isSvgBytes,isPdfBytes} from "./svg-pdf.js";
import {decodeSvgSourceToStorage} from "./svg-storage.js";
import {detectHeifFormatFromSource} from "./heif-format.js";
import type {ImageByteSource} from "./png-storage.js";
import {decodeHeifToStorage} from "./heif-storage.js";
import {isWebpBytes} from "./webp.js";
import {decodeWebpToStorage} from "./webp-input-storage.js";
import {isJpegBytes} from "./jpeg.js";
import {decodeJpegToStorage} from "./jpeg-input-storage.js";
import {isGifBytes} from "./gif.js";
import {decodeGifToStorage} from "./gif-input-storage.js";
import {isBmpBytes,isNetpbmBytes,isTiffBytes} from "./netpbm.js";
import {isPngBytes} from "./png.js";
import {decodePngToStorage} from "./png-storage.js";
import {decodeNetpbmToStorage} from "./netpbm-storage.js";
import {decodeBmpToStorage} from "./bmp-storage.js";
import {decodeTiffToStorage} from "./tiff-input-storage.js";
/** Shared format admission for primary files and secondary resources. */
export async function storedImageDecoder(source:ImageByteSource,signal:AbortSignal):Promise<typeof decodePngToStorage|undefined> {
 signal.throwIfAborted();const length=Math.min(54,source.size),prefix=await source.read(0,length,{signal});signal.throwIfAborted();
 if(!(prefix instanceof Uint8Array)||prefix.length!==length)throw new Error("Truncated image source");
 const decoder=await detectHeifFormatFromSource(source,signal)?decodeHeifToStorage:isWebpBytes(prefix)?decodeWebpToStorage:isJpegBytes(prefix)?decodeJpegToStorage:isPngBytes(prefix)?decodePngToStorage:isNetpbmBytes(prefix)?decodeNetpbmToStorage:isBmpBytes(prefix)?decodeBmpToStorage:isTiffBytes(prefix)?decodeTiffToStorage:isGifBytes(prefix)?decodeGifToStorage:undefined;
 if(decoder)return decoder;
 const size=Math.min(1029,source.size),header=await source.read(0,size,{signal});signal.throwIfAborted();
 if(!(header instanceof Uint8Array)||header.length!==size)throw new Error("Truncated image source");
 if(isSvgBytes(header))return decodeSvgSourceToStorage;
 if(isPdfBytes(header))return undefined;
 return rejectUnknownImage(source,signal);
}
