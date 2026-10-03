import {isGifBytes} from "./gif.js";
import {decodeGifToStorage} from "./gif-input-storage.js";
import {isBmpBytes,isNetpbmBytes,isTiffBytes} from "./netpbm.js";
import {isPngBytes} from "./png.js";
import {decodePngToStorage} from "./png-storage.js";
import {decodeNetpbmToStorage} from "./netpbm-storage.js";
import {decodeBmpToStorage} from "./bmp-storage.js";
import {decodeTiffToStorage} from "./tiff-input-storage.js";
/** Shared format admission for primary files and secondary resources. */
export function storedImageDecoder(prefix:Uint8Array):typeof decodePngToStorage|undefined {
 return isPngBytes(prefix)?decodePngToStorage:isNetpbmBytes(prefix)?decodeNetpbmToStorage:isBmpBytes(prefix)?decodeBmpToStorage:isTiffBytes(prefix)?decodeTiffToStorage:isGifBytes(prefix)?decodeGifToStorage:undefined;
}
