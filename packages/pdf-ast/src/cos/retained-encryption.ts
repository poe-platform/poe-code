import { cosArray, cosHexString, cosNumber, dictGet, type PdfCosNode, type PdfEncryptionState } from "../ast.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { drainWorkAsync } from "../work.js";
import { PdfMutableObjectStore } from "./mutable-object-store.js";
import type { PdfIndexStorage } from "./object-index.js";
import { retainedCosObjects } from "./retained-objects.js";
import { retainedObjectOrder } from "./retained-object-order.js";
import { serializeLinearizedRetainedChunks } from "./retained-linearization.js";
import { aesCbcEncrypt, md5Bytes } from "./crypto-primitives.js";
import { createPdfEncryption, encryptPdfBuffer, rc4Transform, transformNodeStringsAndStreamsSteps, type EncryptPdfOptions } from "./security.js";

async function* encryptedChunks(state: PdfEncryptionState, number: number, generation: number, input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, signal: AbortSignal) {
  const aes = state.revision === 6;
  let iv = aes ? crypto.getRandomValues(new Uint8Array(16)) : new Uint8Array(0);
  const key = aes ? state.fileKey : md5Bytes([state.fileKey, Uint8Array.of(number & 255, (number >>> 8) & 255, (number >>> 16) & 255, generation & 255, (generation >>> 8) & 255)]).subarray(0, Math.min(16, state.fileKey.length + 5));
  const rc4 = {}, block = new Uint8Array(16384); let used = 0;
  if (aes) yield iv.slice();
  function* flush(final: boolean) {
    signal.throwIfAborted();
    const bytes = aes ? aesCbcEncrypt(key, iv, block.subarray(0, used), final) : rc4Transform(key, block.subarray(0, used), rc4);
    if (aes && bytes.length) iv = bytes.slice(-16);
    for (let offset = 0; offset < bytes.length; offset += 16384) yield bytes.slice(offset, offset + 16384);
    used = 0;
  }
  for await (const chunk of input) {
    for (let offset = 0; offset < chunk.length;) {
      signal.throwIfAborted();
      if (used === block.length) { yield* flush(false); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
      const size = Math.min(block.length - used, chunk.length - offset); block.set(chunk.subarray(offset, offset + size), used); used += size; offset += size;
    }
  }
  yield* flush(true);
}

/** Encrypt a retained PDF source. The caller owns the source; all temporary
 * objects and ciphertext use the supplied storage and are closed on return. */
export async function* encryptRetainedPdfChunks(source: PdfFileSource, storage: PdfIndexStorage, options: EncryptPdfOptions & { signal?: AbortSignal; maxOutputBytes?: number } = {}): AsyncGenerator<Uint8Array> {
  const signal = options.signal ?? new AbortController().signal;
  const document = await PdfRetainedDocument.open(source, storage, { signal }), objects = new PdfMutableObjectStore(storage, { signal });
  let failed = false;
  try {
    for await (const object of retainedCosObjects(document, storage, { signal })) await objects.set(object);
    const { state, encryptDict, idBytes, revision } = createPdfEncryption(options);
    for await (const number of retainedObjectOrder(document, source, storage, signal)) {
      const object = (await objects.get(number))!, type = object.value.kind === "dict" ? dictGet(object.value, "Type") : undefined;
      if (object.stream && type?.kind === "name" && type.decoded === "XRef") continue;
      const transform = (node: PdfCosNode) => drainWorkAsync(transformNodeStringsAndStreamsSteps(node, bytes => encryptPdfBuffer(state, number, object.generationNumber, bytes)), signal);
      if (!object.stream) { await objects.set({ ...object, value: await transform(object.value) }); continue; }
      const payload = await PdfFileSource.fromStream(storage.fs, storage.directory, encryptedChunks(state, number, object.generationNumber, object.stream.chunks, signal), { signal, ...(options.maxOutputBytes === undefined ? {} : { maxInputBytes: options.maxOutputBytes }) });
      let streamFailed = false;
      try {
        if (object.value.kind !== "dict") throw new Error("Expected stream dictionary");
        const entries = [];
        for (const entry of object.value.entries) entries.push({ key: entry.key, value: entry.key.decoded === "Length" ? cosNumber(payload.size) : await transform(entry.value) });
        await objects.set({ objectNumber: number, generationNumber: object.generationNumber, value: { kind: "dict", entries }, stream: { length: payload.size, chunks: payload.stream(0, payload.size, signal) } });
      } catch (error) { streamFailed = true; throw error; }
      finally { await payload.close().catch(error => { if (!streamFailed) throw error; }); }
    }
    const encryptRef = await objects.allocate(encryptDict), reference = document.crossReference;
    yield* serializeLinearizedRetainedChunks(objects, storage, { rootRef: reference.rootRef, infoRef: reference.infoRef, encryptRef, idArray: cosArray([cosHexString(idBytes), cosHexString(idBytes)]), version: revision === 6 ? "2.0" : Number.parseFloat(reference.version) < 1.4 ? "1.4" : reference.version, signal, maxOutputBytes: options.maxOutputBytes }, () => objects.outputObjects(), number => objects.get(number));
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([objects.close(), document.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
