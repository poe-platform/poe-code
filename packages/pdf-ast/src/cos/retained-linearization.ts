import { dictGet } from "../ast.js";
import { PdfFileSource } from "../source.js";
import { linearizedOutput } from "./linearized-writer.js";
import { restoreStringFormats, type PdfMutableObjectStore } from "./mutable-object-store.js";
import type { PdfIndexStorage } from "./object-index.js";
import { parseCosRangeObject } from "./range-parser.js";
import { serializeRetainedCosDocumentChunks, type PdfRetainedOutputObject, type PdfSerializedOutputObject, type SerializeRetainedCosOptions } from "./retained-writer.js";

type OutputObject = PdfRetainedOutputObject | PdfSerializedOutputObject;

/** Stage serialized bodies once so generated page trees and encrypted streams
 * use the same layout as ordinary objects, without collecting stream bytes. */
export async function* serializeLinearizedRetainedChunks(store: PdfMutableObjectStore, storage: PdfIndexStorage,
  options: Omit<SerializeRetainedCosOptions, "objects"> & { readonly linearize?: boolean },
  objects: () => AsyncIterable<OutputObject>, knownStructural: readonly number[] = []): AsyncGenerator<Uint8Array, void, void> {
  const signal = options.signal ?? new AbortController().signal;
  let linearize = options.linearize;
  if (!linearize) for await (const identity of store.identities()) {
    if (knownStructural.includes(identity.objectNumber)) continue;
    const object = (await store.get(identity.objectNumber))!;
    if (!object.stream && object.value.kind === "dict" && dictGet(object.value, "Linearized")) { linearize = true; break; }
  }
  if (!linearize) { yield* serializeRetainedCosDocumentChunks({ ...options, objects: objects() }, storage); return; }
  const offsets = new Map<number, number>();
  const source = await PdfFileSource.fromStream(storage.fs, storage.directory,
    serializeRetainedCosDocumentChunks({ ...options, objects: objects(), onObjectWritten(number, start) { offsets.set(number, start); } }, storage),
    { signal, chunkBytes: Math.min(options.chunkBytes ?? 16384, 16384), maxInputBytes: options.maxOutputBytes ?? Infinity });
  let failed = false;
  try {
    const work = linearizedOutput([...offsets.keys()].sort((a, b) => a - b), options);
    let step = work.next(), turns = 0;
    while (!step.done) {
      signal.throwIfAborted();
      if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (step.value instanceof Uint8Array) { yield step.value; step = work.next(); }
      else if (!step.value) step = work.next();
      else {
        const request = step.value, id = "object" in request ? request.object : request.stream;
        const offset = offsets.get(id);
        if (offset === undefined) { step = work.next({ value: { kind: "null" } }); continue; }
        const object = await parseCosRangeObject(source, offset, { signal });
        if ("object" in request) step = work.next({ value: restoreStringFormats(object.value), ...(object.stream ? { streamLength: object.stream.end - object.stream.start } : {}) });
        else {
          if (object.stream) yield* source.stream(object.stream.start, object.stream.end - object.stream.start, signal);
          step = work.next();
        }
      }
    }
  } catch (error) { failed = true; throw error; }
  finally { await source.close().catch(error => { if (!failed) throw error; }); }
}
