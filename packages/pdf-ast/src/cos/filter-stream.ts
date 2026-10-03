import { readBytes } from "@poe-code/safe-fs/contracts";
import { dictGet, type PdfCosDict } from "../ast.js";
import { PdfError } from "../errors.js";
import { decodePdfByteFilter } from "./byte-filter-stream.js";
import { extractDecodeParms } from "./filters.js";
import { inflatePdfChunks, type PdfInflateOptions } from "./flate-stream.js";
import { decodePredictorChunks, type PdfPredictorOptions } from "./predictor-stream.js";

export interface PdfStreamDecodeOptions extends PdfInflateOptions, PdfPredictorOptions {}

/** Stream direct filter dictionaries. Flate and its predictors use bounded codec
 * and row state. ASCII, run-length and LZW codecs use bounded scalar/dictionary
 * state. Image codecs and Crypt retain encoded bytes as in decodeStreamObject.
 * Other codecs must be supplied by the caller until their streaming adapters exist. */
export async function* decodePdfStreamChunks(dict: PdfCosDict, input: AsyncIterable<Uint8Array>, options: PdfStreamDecodeOptions = {}): AsyncGenerator<Uint8Array> {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const maximum = options.maxDecodedBytes ?? Infinity;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new RangeError("Invalid chunkBytes");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid maxDecodedBytes");
  options.signal?.throwIfAborted();
  const filter = dictGet(dict, "Filter") ?? dictGet(dict, "F");
  const parameters = dictGet(dict, "DecodeParms") ?? dictGet(dict, "DP");
  let current = input;
  let filterIndex = 0;
  const filters = filter?.kind === "array" ? filter.items : filter ? [filter] : [];
  for (const node of filters) {
    if (node.kind !== "name") continue;
    const parms = parameters?.kind === "array" ? parameters.items[filterIndex] : parameters;
    filterIndex++;
    if (node.decoded === "FlateDecode" || node.decoded === "Fl") {
      current = decodePredictorChunks(inflatePdfChunks(current, options), parms?.kind === "dict" ? extractDecodeParms(parms) : undefined, options);
    } else if (node.decoded === "LZWDecode" || node.decoded === "LZW") {
      const decodedParms = parms?.kind === "dict" ? extractDecodeParms(parms) : undefined;
      current = decodePredictorChunks(decodePdfByteFilter(current, "lzw", decodedParms, options), decodedParms, options);
    } else if (node.decoded === "ASCIIHexDecode" || node.decoded === "AHx") {
      current = decodePdfByteFilter(current, "hex", undefined, options);
    } else if (node.decoded === "ASCII85Decode" || node.decoded === "A85") {
      current = decodePdfByteFilter(current, "ascii85", undefined, options);
    } else if (node.decoded === "RunLengthDecode" || node.decoded === "RL") {
      current = decodePdfByteFilter(current, "runlength", undefined, options);
    } else if (!["DCTDecode", "DCT", "JPXDecode", "JBIG2Decode", "Identity", "Crypt"].includes(node.decoded)) {
      throw new PdfError("E_CAPABILITY", `Unsupported streaming PDF filter: ${node.decoded}`);
    }
  }
  let total = 0;
  for await (const chunk of readBytes(current, options.signal)) {
    if (chunk.length > Math.min(maximum, Number.MAX_SAFE_INTEGER) - total) throw new PdfError("E_LIMIT", "PDF stream decoded byte limit exceeded");
    total += chunk.length;
    for (let offset = 0; offset < chunk.length; offset += chunkBytes) {
      options.signal?.throwIfAborted();
      yield chunk.slice(offset, offset + chunkBytes);
    }
  }
}
