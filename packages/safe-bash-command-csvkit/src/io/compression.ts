import type { ByteSource, CompressionProvider, CsvkitLimits } from "../contracts.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { defaultLimits } from "../engine.js";

/** Structural host binding compatible with office-package's compression codec.
 * The codec must bound output chunks and cooperate with signal cancellation.
 */
export interface GzipCodec {
  readonly memberAdmission: true;
  readonly CodecReader: new (source: ByteSource, signal: AbortSignal) => {
    chunk(): Promise<Uint8Array | undefined>;
    restore(bytes: Uint8Array): void;
    close(): Promise<void>;
  };
  codec(input: { chunk(): Promise<Uint8Array | undefined>; restore(bytes: Uint8Array): void },
    options: { readonly mode: "gunzip"; readonly padding: "members"; readonly chunkSize: number; readonly onMember: () => void }, signal: AbortSignal): ByteSource;
}

/** Explicit office codec injection; no ambient files, processes or codec discovery.
 * Runtime bounds compressed/inflated bytes around this provider. Exact corrupt
 * stream diagnostics remain unqualified rather than masquerading as native errors.
 */
export function createGzipCompressionProvider(codec: GzipCodec): CompressionProvider {
  if (codec.memberAdmission !== true) throw new TypeError("gzip codec requires member admission");
  return Object.freeze({ extensions: Object.freeze([".gz"]),
    async *decode(source: ByteSource, signal: AbortSignal, limits: Pick<CsvkitLimits, "maxArchiveMembers"> = defaultLimits): ByteSource {
      signal.throwIfAborted();
      if ((limits.maxArchiveMembers !== Infinity && !Number.isSafeInteger(limits.maxArchiveMembers)) || limits.maxArchiveMembers < 0)
        throw new RangeError("invalid gzip member limit");
      let members = 0;
      let sourceFailed = false, sourceFailure: unknown;
      const observed = (async function* () {
        try { yield* source; }
        catch (failure) { sourceFailed = true; sourceFailure = failure; throw failure; }
      })();
      const reader = new codec.CodecReader(observed, signal);
      let failed = false;
      try {
        // Python GzipFile accepts an empty source, unlike a bare inflate codec.
        const first = await reader.chunk();
        if (first === undefined) return;
        reader.restore(first);
        yield* codec.codec(reader, { mode: "gunzip", padding: "members", chunkSize: 64 * 1024, onMember() {
          signal.throwIfAborted();
          if (++members > limits.maxArchiveMembers) throw new CsvkitBlocked("gzip member budget exceeded");
        } }, signal);
      } catch (failure) {
        failed = true;
        signal.throwIfAborted();
        if (sourceFailed) throw sourceFailure;
        if (failure instanceof CsvkitDiagnostic) throw failure;
        throw new CsvkitBlocked("gzip codec diagnostic (corrupt or truncated stream)");
      } finally {
        if (failed || signal.aborted) await reader.close().catch(() => {});
        else await reader.close();
      }
    }
  });
}
