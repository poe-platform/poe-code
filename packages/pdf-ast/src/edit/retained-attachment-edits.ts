import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosDict, cosName, cosNumber, cosString, decodePdfString, dictDelete, dictGet, dictSet, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfNameIndex } from "../cos/name-index.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import { serializeCosNodeChunks } from "../cos/writer.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfError } from "../errors.js";

export interface RetainedAttachmentInput {
  readonly key: string;
  readonly filename: string;
  readonly description?: string;
  readonly replace?: boolean;
  readonly length: number;
  readonly chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}
export class PdfDuplicateAttachment extends PdfError {
  constructor(readonly key: string) { super("E_CAPABILITY", `Duplicate attachment key: ${key}`); }
}

/** Flatten the edited name tree without collecting its pairs or new payloads. */
export async function editRetainedAttachments(document: PdfRetainedDocument, target: PdfMutableObjectStore, storage: PdfIndexStorage,
  remove: Iterable<string> | AsyncIterable<string>, additions: Iterable<RetainedAttachmentInput> | AsyncIterable<RetainedAttachmentInput>, signal: AbortSignal): Promise<void> {
  const pairs = new PdfMutableObjectStore(storage, { signal }), frames = new PdfMutableObjectStore(storage, { signal });
  const names = new PdfNameIndex(storage, Infinity, signal), removed = new PdfNameIndex(storage, Infinity, signal), visited = new PdfReferenceSet(storage, Infinity, signal);
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), first = new IntegerTable(backing), removals = new IntegerTable(backing);
  let failed = false, pending = 0, count = 0, work = 0;
  async function checkpoint() { signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
  async function resolve(node: PdfCosNode | undefined) { const result = await document.lookup(node); return result?.stream ? undefined : result; }
  async function save(reference: PdfCosRef, value: PdfCosNode) { await target.set({ objectNumber: reference.objectNumber, generationNumber: reference.generationNumber, value }); }
  try {
    const root = await resolve(document.crossReference.rootRef); if (root?.value.kind !== "dict" || !root.reference) return;
    let owner = root;
    let namesValue = await resolve(dictGet(root.value, "Names"));
    if (namesValue?.value.kind !== "dict") {
      const value = cosDict({}), reference = await target.allocate(value); namesValue = { value, reference };
      dictSet(root.value, "Names", reference); await save(root.reference, root.value);
    }
    if (namesValue.value.kind !== "dict") throw new PdfError("E_PARSE", "Invalid attachment names");
    if (namesValue.reference) owner = namesValue;
    let tree = await resolve(dictGet(namesValue.value, "EmbeddedFiles"));
    if (tree?.value.kind !== "dict") {
      const value = cosDict({ Names: cosArray([]) }), reference = await target.allocate(value); tree = { value, reference };
      dictSet(namesValue.value, "EmbeddedFiles", reference); await save(owner.reference!, owner.value);
    }
    if (tree.value.kind !== "dict") throw new PdfError("E_PARSE", "Invalid attachment tree");
    if (tree.reference) owner = tree;
    for await (const key of remove) { await checkpoint(); await removals.set(BigInt((await removed.intern(key)).index), 1n); }
    async function* tokens(): AsyncGenerator<PdfCosNode> {
      let node: PdfCosNode | undefined = tree!.value;
      for (;;) {
        await checkpoint(); const value = (await resolve(node))?.value;
        if (value?.kind === "dict") {
          const entries = (await resolve(dictGet(value, "Names")))?.value;
          if (entries?.kind === "array") for (const item of entries.items) { await checkpoint(); yield item; }
          const kids = (await resolve(dictGet(value, "Kids")))?.value;
          if (kids?.kind === "array") for (let i = kids.items.length - 1; i >= 0; i--) await frames.set({ objectNumber: ++pending, generationNumber: 0, value: kids.items[i]! });
        }
        node = undefined;
        while (pending) {
          await checkpoint(); const child = (await frames.get(pending--))!.value;
          if (child.kind === "ref" && !await visited.add(child.objectNumber)) continue;
          node = child; break;
        }
        if (!node) return;
      }
    }
    let keyNode: PdfCosNode | undefined;
    for await (const node of tokens()) {
      if (!keyNode) { keyNode = node; continue; }
      const keyValue = (await resolve(keyNode))?.value, key = keyValue?.kind === "string" ? decodePdfString(keyValue) : "";
      if (await removals.get(BigInt((await removed.intern(key)).index)) === undefined) {
        await pairs.set({ objectNumber: ++count, generationNumber: 0, value: cosArray([keyNode, node]) });
        if (keyValue?.kind === "string") { const name = await names.intern(key); if (name.added) await first.set(BigInt(name.index), BigInt(count)); }
      }
      keyNode = undefined;
    }
    // With additions alone the compatibility tree retains an unmatched tail;
    // a removal pass discards it. Retain it separately from indexed pairs.
    let hasRemovals = false; for await (const ignored of removals.entries()) { void ignored; hasRemovals = true; break; }
    if (hasRemovals) keyNode = undefined;
    for await (const attachment of additions) {
      await checkpoint();
      if (!Number.isSafeInteger(attachment.length) || attachment.length < 0) throw new RangeError("Invalid attachment byte length");
      const name = await names.intern(attachment.key), existing = await first.get(BigInt(name.index));
      if (existing !== undefined && !attachment.replace) throw new PdfDuplicateAttachment(attachment.key);
      async function* admitted() {
        let length = 0;
        for await (const bytes of attachment.chunks) { signal.throwIfAborted(); if (bytes.length > attachment.length - length) throw new PdfError("E_PARSE", "Excess attachment bytes"); length += bytes.length; yield bytes; }
        if (length !== attachment.length) throw new PdfError("E_PARSE", "Incomplete attachment bytes");
      }
      {
        const embedded = await target.allocate();
        await target.set({ objectNumber: embedded.objectNumber, generationNumber: 0, value: cosDict({ Type: cosName("EmbeddedFile"), Params: cosDict({ Size: cosNumber(attachment.length) }) }), stream: { length: attachment.length, chunks: admitted() } });
        const spec = cosDict({ Type: cosName("Filespec"), F: cosString(attachment.filename), UF: cosString(attachment.filename), EF: cosDict({ F: embedded, UF: embedded }) });
        if (attachment.description) dictSet(spec, "Desc", cosString(attachment.description));
        const reference = await target.allocate(spec);
        if (existing !== undefined) {
          const pair = (await pairs.get(Number(existing)))!.value;
          if (pair.kind !== "array") throw new PdfError("E_PARSE", "Invalid attachment pair");
          pair.items[1] = reference; await pairs.set({ objectNumber: Number(existing), generationNumber: 0, value: pair });
        } else {
          const key = keyNode ?? cosString(attachment.key), value = keyNode ? cosString(attachment.key) : reference;
          keyNode = keyNode ? reference : undefined;
          await pairs.set({ objectNumber: ++count, generationNumber: 0, value: cosArray([key, value]) });
          const resolved = (await resolve(key))?.value;
          if (resolved?.kind === "string") { const entry = await names.intern(decodePdfString(resolved)); if (await first.get(BigInt(entry.index)) === undefined) await first.set(BigInt(entry.index), BigInt(count)); }
        }
      }
    }
    const sentinel = cosArray([]); dictDelete(tree.value, "Kids"); dictSet(tree.value, "Names", sentinel);
    const encoder = new TextEncoder();
    async function* serialized(node: PdfCosNode): AsyncGenerator<Uint8Array> {
      await checkpoint();
      if (node === sentinel) {
        yield encoder.encode("[ ");
        for await (const pair of pairs.objects()) {
          const array = pair.value; if (array.kind !== "array") throw new PdfError("E_PARSE", "Invalid attachment pair");
          for (const item of array.items) { yield* serializeCosNodeChunks(item, { chunkBytes: 16384, signal }); yield encoder.encode(" "); }
        }
        if (keyNode) { yield* serializeCosNodeChunks(keyNode, { chunkBytes: 16384, signal }); yield encoder.encode(" "); }
        yield encoder.encode("]");
      } else if (node.kind === "dict") {
        yield encoder.encode("<<\n");
        for (const entry of node.entries) { yield* serializeCosNodeChunks(entry.key, { chunkBytes: 16384, signal }); yield encoder.encode(" "); yield* serialized(entry.value); yield encoder.encode("\n"); }
        yield encoder.encode(">>");
      } else if (node.kind === "array") {
        yield encoder.encode("[ "); for (const item of node.items) { yield* serialized(item); yield encoder.encode(" "); } yield encoder.encode("]");
      } else yield* serializeCosNodeChunks(node, { chunkBytes: 16384, signal });
    }
    let length = 0; for await (const bytes of serialized(owner.value)) length += bytes.length;
    await target.setSerializedValue({ objectNumber: owner.reference!.objectNumber, generationNumber: owner.reference!.generationNumber, body: { length, chunks: serialized(owner.value) } });
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([pairs.close(), frames.close(), names.close(), removed.close(), visited.close(), backing.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
