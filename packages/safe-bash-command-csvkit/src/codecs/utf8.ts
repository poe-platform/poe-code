import type { CodecProvider } from "../contracts.js";
import { PythonException } from "../diagnostics/exception.js";
import type { ByteSource } from "../contracts.js";
import { decodeFrames } from "./frames.js";
import { CsvkitBlocked } from "../errors.js";

export const utf8Codec: CodecProvider = Object.freeze({
  names: Object.freeze(["utf-8", "utf8", "utf-8-sig"]),
  async *decodeStream(source: ByteSource, encoding: string, signal: AbortSignal) {
    const signature = encoding.toLowerCase().replaceAll("_", "-") === "utf-8-sig";
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: !signature });
    const decode = (bytes?: Uint8Array): string => {
      try { return decoder.decode(bytes, { stream: bytes !== undefined }); }
      catch { throw new PythonException("UnicodeDecodeError", `${encoding} decoding failed`); }
    };
    let initialBytes = 0;
    let signaturePrefix = true;
    for await (const bytes of decodeFrames(source, signal)) {
      for (let index = 0; index < bytes.length && initialBytes < 3; index++) {
        if (bytes[index] !== [0xef, 0xbb, 0xbf][initialBytes]) signaturePrefix = false;
        initialBytes++;
      }
      yield decode(bytes);
    }
    signal.throwIfAborted();
    // Python's incremental utf-8-sig decoder retains a possible BOM prefix
    // even at final EOF; this differs from plain UTF-8's truncated-byte error.
    if (signature && initialBytes > 0 && initialBytes < 3 && signaturePrefix) return;
    yield decode();
  },
  async decode(bytes: Uint8Array, encoding: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: encoding.toLowerCase().replaceAll("_", "-") !== "utf-8-sig" }).decode(bytes); }
    catch { throw new PythonException("UnicodeDecodeError", `${encoding} decoding failed`); }
  },
  async encode(text: string, encoding: string, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted();
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) throw new CsvkitBlocked("UTF-8 unpaired surrogate encoding profile");
    }
    const bytes = new TextEncoder().encode(text);
    if (encoding.toLowerCase().replaceAll("_", "-") !== "utf-8-sig") return bytes;
    const signed = new Uint8Array(bytes.length + 3);
    signed.set([0xef, 0xbb, 0xbf]);
    signed.set(bytes, 3);
    return signed;
  }
});
