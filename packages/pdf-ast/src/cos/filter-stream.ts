import { readBytes } from "@poe-code/safe-fs/contracts";
import { dictGet, type PdfCosDict } from "../ast.js";
import { PdfError } from "../errors.js";
import { decodeCcittFaxChunks } from "./ccitt.js";
import { decodePdfByteFilter } from "./byte-filter-stream.js";
import { extractDecodeParms } from "./filters.js";
import { inflatePdfChunks, type PdfInflateOptions } from "./flate-stream.js";
import { decodePredictorChunks, type PdfPredictorOptions } from "./predictor-stream.js";

export interface PdfStreamDecodeOptions extends PdfInflateOptions, PdfPredictorOptions {
  /** Decode transport wrappers but preserve the first native image codec payload. */
  stopBeforeImageCodec?: boolean;
  /** Preserve encoded bytes after required decryption, for buffered recovery parity. */
  raw?: boolean;
}

export function pdfImageCodec(filter: string): "jpeg" | "ccitt" | "jbig2" | "jpx" | undefined {
  switch (filter) {
    case "DCTDecode": case "DCT": return "jpeg";
    case "CCITTFaxDecode": case "CCF": return "ccitt";
    case "JBIG2Decode": return "jbig2";
    case "JPXDecode": return "jpx";
    default: return undefined;
  }
}
/** Factories must replay the same bytes; retained PDF ranges satisfy this contract. */
export type PdfStreamInput = AsyncIterable<Uint8Array> | (() => AsyncIterable<Uint8Array>);

/** Stream direct filter dictionaries. Flate and its predictors use bounded codec
 * and row state. ASCII, run-length and LZW codecs use bounded scalar/dictionary
 * state. Image codecs and Crypt retain encoded bytes as in decodeStreamObject.
 * CCITT requires a replayable factory to preserve its original-byte fallback. */
export async function* decodePdfStreamChunks(dict: PdfCosDict, input: PdfStreamInput, options: PdfStreamDecodeOptions = {}): AsyncGenerator<Uint8Array> {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const maximum = options.maxDecodedBytes ?? Infinity;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new RangeError("Invalid chunkBytes");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid maxDecodedBytes");
  options.signal?.throwIfAborted();
  const filter = dictGet(dict, "Filter") ?? dictGet(dict, "F");
  const parameters = dictGet(dict, "DecodeParms") ?? dictGet(dict, "DP");
  let current: () => AsyncIterable<Uint8Array> = typeof input === "function" ? input : () => input;
  let filterIndex = 0;
  const filters = options.raw ? [] : filter?.kind === "array" ? filter.items : filter ? [filter] : [];
  for (const node of filters) {
    if (node.kind !== "name") continue;
    if (options.stopBeforeImageCodec && pdfImageCodec(node.decoded)) break;
    const parms = parameters?.kind === "array" ? parameters.items[filterIndex] : parameters;
    filterIndex++;
    const upstream = current;
    if (node.decoded === "FlateDecode" || node.decoded === "Fl") {
      current = () => decodePredictorChunks(inflatePdfChunks(upstream(), options), parms?.kind === "dict" ? extractDecodeParms(parms) : undefined, options);
    } else if (node.decoded === "LZWDecode" || node.decoded === "LZW") {
      const decodedParms = parms?.kind === "dict" ? extractDecodeParms(parms) : undefined;
      current = () => decodePredictorChunks(decodePdfByteFilter(upstream(), "lzw", decodedParms, options), decodedParms, options);
    } else if (node.decoded === "ASCIIHexDecode" || node.decoded === "AHx") {
      current = () => decodePdfByteFilter(upstream(), "hex", undefined, options);
    } else if (node.decoded === "ASCII85Decode" || node.decoded === "A85") {
      current = () => decodePdfByteFilter(upstream(), "ascii85", undefined, options);
    } else if (node.decoded === "RunLengthDecode" || node.decoded === "RL") {
      current = () => decodePdfByteFilter(upstream(), "runlength", undefined, options);
    } else if (node.decoded === "CCITTFaxDecode" || node.decoded === "CCF") {
      if (typeof input !== "function") throw new PdfError("E_CAPABILITY", "CCITT streaming requires replayable input");
      current = () => decodeCcittFaxChunks(upstream, parms?.kind === "dict" ? extractDecodeParms(parms) : undefined, options);
    } else if (!["DCTDecode", "DCT", "JPXDecode", "JBIG2Decode", "Identity", "Crypt"].includes(node.decoded)) {
      throw new PdfError("E_CAPABILITY", `Unsupported streaming PDF filter: ${node.decoded}`);
    }
  }
  let total = 0;
  for await (const chunk of readBytes(current(), options.signal)) {
    if (chunk.length > Math.min(maximum, Number.MAX_SAFE_INTEGER) - total) throw new PdfError("E_LIMIT", "PDF stream decoded byte limit exceeded");
    total += chunk.length;
    for (let offset = 0; offset < chunk.length; offset += chunkBytes) {
      options.signal?.throwIfAborted();
      yield chunk.slice(offset, offset + chunkBytes);
    }
  }
}
