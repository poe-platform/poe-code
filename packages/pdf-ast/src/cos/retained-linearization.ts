import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosName, cosNumber, dictGet, type PdfCosNumber } from "../ast.js";
import { encodeFlate } from "./filters.js";
import type { PdfMutableObjectStore } from "./mutable-object-store.js";
import type { PdfIndexStorage } from "./object-index.js";
import { serializeCosNodeChunks } from "./writer.js";
import { serializeRetainedCosDocumentChunks, type PdfRetainedOutputObject, type PdfSerializedOutputObject, type SerializeRetainedCosOptions } from "./retained-writer.js";

type OutputObject = PdfRetainedOutputObject | PdfSerializedOutputObject;

/** Preserve ordinary writer linearization layout without collecting object
 * bodies or output bytes. Only the small fixed-width dictionary is patched. */
export async function* serializeLinearizedRetainedChunks(store: PdfMutableObjectStore, storage: PdfIndexStorage,
  options: Omit<SerializeRetainedCosOptions, "objects"> & { readonly linearize?: boolean },
  objects: () => AsyncIterable<OutputObject>, getObject: (number: number) => Promise<OutputObject | undefined>, knownStructural: readonly number[] = []): AsyncGenerator<Uint8Array, void, void> {
  const signal = options.signal ?? new AbortController().signal;
  let linearized: PdfRetainedOutputObject | undefined, hint: PdfRetainedOutputObject | undefined, maximum = 0, addedHint = false, pageCount = 0, firstPage = options.rootRef.objectNumber;
  for await (const identity of store.identities()) {
    signal.throwIfAborted(); maximum = Math.max(maximum, identity.objectNumber);
    if (knownStructural.includes(identity.objectNumber)) continue;
    const object = (await store.get(identity.objectNumber))!;
    if (object.value.kind !== "dict") continue;
    const type = dictGet(object.value, "Type");
    if (!object.stream && !linearized && dictGet(object.value, "Linearized") !== undefined) linearized = object;
    if (object.stream && !hint && type?.kind === "name" && type.decoded === "Hint") hint = object;
    if (!object.stream && type?.kind === "name" && type.decoded === "Page") { if (!pageCount) firstPage = object.objectNumber; pageCount++; }
  }
  if (!linearized && !options.linearize) { yield* serializeRetainedCosDocumentChunks({ ...options, objects: objects() }, storage); return; }
  if (!linearized) {
    const value = cosDict({ Linearized: cosNumber(1) });
    linearized = { objectNumber: ++maximum, generationNumber: 0, value };
  }
  if (!hint) {
    const bytes = encodeFlate(new Uint8Array(64)), value = cosDict({ Type: cosName("Hint"), S: cosNumber(32), Filter: cosName("FlateDecode"), Length: cosNumber(bytes.length) });
    addedHint = true;
    hint = { objectNumber: ++maximum, generationNumber: 0, value, stream: { length: bytes.length, chunks: [bytes] } };
  }
  const linNumber = linearized.objectNumber, linGeneration = linearized.generationNumber, hintNumber = hint.objectNumber;
  const priorities = [linNumber, hintNumber, options.rootRef.objectNumber, firstPage].filter((number, index, all) => all.indexOf(number) === index);
  function fixed(value: number): PdfCosNumber { return { kind: "number", value, isInteger: true, raw: String(value).padStart(10, "0") }; }
  function dictionary(length: number, hintStart: number, hintLength: number, firstEnd: number, xref: number) {
    return cosDict({ Linearized: cosNumber(1), L: fixed(length), H: cosArray([fixed(hintStart), fixed(hintLength)]), O: cosNumber(firstPage), E: fixed(firstEnd), N: cosNumber(pageCount || 1), T: fixed(xref) });
  }
  const placeholder = { objectNumber: linNumber, generationNumber: linGeneration, value: dictionary(0, 0, 0, 0, 0) };
  async function* ordered() {
    for (const number of priorities) {
      // The linearization dictionary replaces even an aliased page-tree body.
      const object = number === linNumber ? placeholder : number === hintNumber && addedHint ? hint : await getObject(number);
      if (object) yield object;
    }
    for await (const object of objects()) if (!priorities.includes(object.objectNumber)) yield object;
  }
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const base = backing.allocate(0), chunkBytes = Math.min(options.chunkBytes ?? 65536, 16384);
  let failed = false, total = 0, linStart = 0, hintStart = 0, hintLength = 120, firstEnd = 0;
  try {
    const output = serializeRetainedCosDocumentChunks({ ...options, objects: ordered(), objectOrder: "provided", signal,
      onObjectWritten(number, start, end) { if (number === linNumber) linStart = start; if (number === hintNumber) { hintStart = start; hintLength = end - start; } if (number === firstPage) firstEnd = end; },
      async onComplete(length, xref) {
        let at = base + linStart + new TextEncoder().encode(`${linNumber} ${linGeneration} obj\n`).length;
        for (const bytes of serializeCosNodeChunks(dictionary(length, hintStart, hintLength, firstEnd || xref, xref), { chunkBytes: options.chunkBytes ?? 16384, maxRecursionDepth: options.maxRecursionDepth ?? Infinity, signal })) {
          await backing.write(at, bytes); at += bytes.length;
        }
      },
    }, storage);
    for await (const bytes of output) { signal.throwIfAborted(); await backing.write(backing.allocate(bytes.length), bytes); total += bytes.length; }
    for (let at = 0; at < total; at += chunkBytes) { signal.throwIfAborted(); yield await backing.read(base + at, Math.min(chunkBytes, total - at)); }
  } catch (error) { failed = true; throw error; }
  finally { await backing.close().catch(error => { if (!failed) throw error; }); }
}
