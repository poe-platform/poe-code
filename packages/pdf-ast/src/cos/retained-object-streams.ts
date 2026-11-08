import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosDict, cosName, cosNumber, dictGet } from "../ast.js";
import { PdfError } from "../errors.js";
import { stageDeflatedPdf } from "./deflate-staging.js";
import type { PdfMutableObjectStore } from "./mutable-object-store.js";
import type { PdfIndexStorage } from "./object-index.js";
import { serializeRetainedCosDocumentChunks, type PdfSerializedOutputObject, type SerializeRetainedCosOptions } from "./retained-writer.js";

/** Pack ordinary objects into the same single object stream as buffered saving,
 * keeping membership, serialized bodies and compressed results on caller storage. */
export async function* serializeRetainedObjectStreams(store: PdfMutableObjectStore, storage: PdfIndexStorage,
  options: Omit<SerializeRetainedCosOptions, "objects">, objects: () => AsyncIterable<PdfSerializedOutputObject>, fallback: () => AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const signal = options.signal ?? new AbortController().signal;
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), packed = new IntegerTable(backing);
  let count = 0, highest = 0, failed = false, compressed: Awaited<ReturnType<typeof stageDeflatedPdf>> | undefined;
  try {
    for await (const identity of store.identities()) {
      signal.throwIfAborted(); highest = Math.max(highest, identity.objectNumber);
      if (identity.generationNumber !== 0) continue;
      const object = (await store.get(identity.objectNumber))!;
      if (object.stream || (object.value.kind === "dict" && dictGet(object.value, "Linearized") !== undefined)) continue;
      await packed.set(BigInt(identity.objectNumber), BigInt(++count));
    }
    if (!count) { yield* fallback(); return; }
    const objectStreamNumber = highest + 1, xrefObjectNumber = highest + 2;
    if (!Number.isSafeInteger(xrefObjectNumber) || xrefObjectNumber > (options.maxObjects ?? Infinity)) throw new PdfError("E_LIMIT", "PDF largest object number exceeds limit");
    let first = 0;
    async function* contents() {
      const encoder = new TextEncoder(); let offset = 0, emitted = 0, work = 0;
      for await (const object of objects()) {
        if (await packed.get(BigInt(object.objectNumber)) === undefined) continue;
        const bytes = encoder.encode(`${emitted++ ? " " : ""}${object.objectNumber} ${offset}`); first += bytes.length; yield bytes;
        offset += object.body.length + 1;
        if (!Number.isSafeInteger(offset)) throw new PdfError("E_LIMIT", "PDF object stream size exceeds limit");
      }
      first++; yield encoder.encode("\n");
      for await (const object of objects()) {
        if (await packed.get(BigInt(object.objectNumber)) === undefined) continue;
        for await (const bytes of object.body.chunks) { signal.throwIfAborted(); yield bytes; if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); }
        yield encoder.encode("\n");
      }
    }
    compressed = await stageDeflatedPdf(contents(), storage, signal, options.maxOutputBytes);
    const payload = compressed;
    async function* direct() {
      for await (const object of objects()) if (await packed.get(BigInt(object.objectNumber)) === undefined) yield object;
      yield { objectNumber: objectStreamNumber, generationNumber: 0,
        value: cosDict({ Type: cosName("ObjStm"), N: cosNumber(count), First: cosNumber(first), Filter: cosName("FlateDecode"), Length: cosNumber(payload.size) }),
        stream: { length: payload.size, chunks: payload.stream(0, payload.size, signal) } };
    }
    async function* entries() { for await (const [number, index] of packed.entries()) yield { objectNumber: Number(number), objectStreamNumber, index: Number(index) - 1 }; }
    yield* serializeRetainedCosDocumentChunks({ ...options, objects: direct(), compressedObjects: { xrefObjectNumber, entries: entries() } }, storage);
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([compressed?.close(), backing.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
