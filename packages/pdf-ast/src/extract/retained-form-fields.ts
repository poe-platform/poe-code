import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosNumber, cosString, cosNull, decodePdfString, dictGet, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfFormFieldInfo } from "../edit/forms.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";

export type PdfRetainedFormField = Pick<PdfFormFieldInfo, "name" | "type" | "value">;

export interface RetainedFieldEntry {
  readonly name: string; readonly dict: PdfCosDict; readonly ft: string;
  readonly flags: number; readonly justification: number; readonly maxLength: number | undefined;
}
export interface RetainedFieldOptions { maxDepth?: number; maxStagingBytes?: number; signal?: AbortSignal }

export async function inheritedRetainedFieldEntry(document: PdfRetainedDocument, storage: PdfIndexStorage, dict: PdfCosDict, key: string, options: RetainedFieldOptions): Promise<PdfCosNode | undefined> {
  const seen = new PdfReferenceSet(storage, options.maxStagingBytes, options.signal);
  let current: PdfCosDict | undefined = dict, depth = 0, failed = false;
  try {
    while (current) {
      options.signal?.throwIfAborted();
      if (++depth > (options.maxDepth ?? document.depthLimit)) throw new PdfError("E_LIMIT", "PDF form field depth limit exceeded");
      if (depth % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const value = dictGet(current, key); if (value !== undefined) return (await document.lookup(value))?.value;
      const parent = dictGet(current, "Parent"); if (parent?.kind === "ref" && !await seen.add(parent.objectNumber)) return;
      const found = await document.lookup(parent); current = !found?.stream && found?.value.kind === "dict" ? found.value : undefined;
    }
  } catch (error) { failed = true; throw error; }
  finally { await seen.close().catch(error => { if (!failed) throw error; }); }
}

/** Summarize fields one at a time. Traversal frames and active-path membership
 * live on caller storage, preserving repeated fields while stopping cycles. */
export async function* walkRetainedFieldEntries(document: PdfRetainedDocument, storage: PdfIndexStorage, options: RetainedFieldOptions = {}): AsyncGenerator<RetainedFieldEntry, void, void> {
  const signal = options.signal ?? new AbortController().signal, maxDepth = options.maxDepth ?? document.depthLimit;
  signal.throwIfAborted();
  const frames = new PdfMutableObjectStore(storage, { signal, ...(options.maxStagingBytes === undefined ? {} : { maxStagingBytes: options.maxStagingBytes }) });
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), active = new IntegerTable(backing, 64);
  let pending = 0, work = 0, failed = false;
  async function checkpoint(depth = 0) {
    signal.throwIfAborted(); if (depth > maxDepth) throw new PdfError("E_LIMIT", "PDF form field depth limit exceeded");
    if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
  }
  async function resolve(node: PdfCosNode | undefined): Promise<PdfCosNode | undefined> {
    const found = await document.lookup(node); return found?.stream ? undefined : found?.value;
  }
  async function push(node: PdfCosNode, prefix: string, ft: string, depth: number, flags = 0, justification = 0, maxLength?: number) {
    await frames.set({ objectNumber: ++pending, generationNumber: 0, value: cosArray([node, cosString(prefix), cosString(ft), cosNumber(depth), cosNumber(flags), cosNumber(justification), maxLength === undefined ? cosNull() : cosNumber(maxLength)]) });
  }
  try {
    const root = await resolve(document.crossReference.rootRef), form = root?.kind === "dict" ? await resolve(dictGet(root, "AcroForm")) : undefined;
    const fields = form?.kind === "dict" ? await resolve(dictGet(form, "Fields")) : undefined;
    if (fields?.kind !== "array") return;
    for (let i = fields.items.length - 1; i >= 0; i--) { await checkpoint(); await push(fields.items[i]!, "", "", 0); }
    while (pending) {
      const frame = (await frames.get(pending--))!.value;
      if (frame.kind !== "array") throw new PdfError("E_PARSE", "Invalid form traversal frame");
      const [node, prefixNode, ftNode, depthNode, flagsNode, qNode, maxNode] = frame.items;
      if (frame.items.length === 1 && node?.kind === "number") { await active.set(BigInt(node.value), 0n); continue; }
      if (!node || prefixNode?.kind !== "string" || ftNode?.kind !== "string" || depthNode?.kind !== "number") throw new PdfError("E_PARSE", "Invalid form traversal frame");
      await checkpoint(depthNode.value);
      if (node.kind === "ref") {
        if (await active.get(BigInt(node.objectNumber)) === 1n) continue;
        await active.set(BigInt(node.objectNumber), 1n);
        await frames.set({ objectNumber: ++pending, generationNumber: 0, value: cosArray([cosNumber(node.objectNumber)]) });
      }
      const dict = await resolve(node); if (dict?.kind !== "dict") continue;
      const named = await resolve(dictGet(dict, "T")), ownFt = await resolve(dictGet(dict, "FT"));
      const partial = named?.kind === "string" ? decodePdfString(named) : named?.kind === "name" ? named.decoded : "", prefix = decodePdfString(prefixNode);
      const name = prefix && partial ? `${prefix}.${partial}` : partial || prefix, ft = ownFt?.kind === "name" ? ownFt.decoded : decodePdfString(ftNode);
      const ownFlags = await resolve(dictGet(dict, "Ff")), ownQ = await resolve(dictGet(dict, "Q")), ownMax = await resolve(dictGet(dict, "MaxLen"));
      const flags = ownFlags?.kind === "number" ? ownFlags.value : flagsNode?.kind === "number" ? flagsNode.value : 0;
      const justification = ownQ?.kind === "number" ? ownQ.value : qNode?.kind === "number" ? qNode.value : 0;
      const maxLength = ownMax?.kind === "number" ? ownMax.value : maxNode?.kind === "number" ? maxNode.value : undefined;
      const kids = await resolve(dictGet(dict, "Kids"));
      if (kids?.kind === "array" && kids.items.length) {
        let namedKids = false;
        for (const kid of kids.items) { await checkpoint(); const value = await resolve(kid); if (value?.kind === "dict" && dictGet(value, "T")) { namedKids = true; break; } }
        if (namedKids || !ft || !name) {
          for (let i = kids.items.length - 1; i >= 0; i--) { await checkpoint(); await push(kids.items[i]!, name, ft, depthNode.value + 1, flags, justification, maxLength); }
          continue;
        }
      }
      if (!name) continue;
      yield { name, dict, ft, flags, justification, maxLength };
    }
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([frames.close(), backing.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}

/** Compatibility summaries; detailed consumers can iterate values/options separately. */
export async function* walkRetainedFormFields(document: PdfRetainedDocument, storage: PdfIndexStorage, options: RetainedFieldOptions = {}): AsyncGenerator<PdfRetainedFormField, void, void> {
  let work = 0;
  async function resolve(node: PdfCosNode | undefined) { if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); const found = await document.lookup(node); return found?.stream ? undefined : found?.value; }
  for await (const { name, dict, ft } of walkRetainedFieldEntries(document, storage, options)) {
      const value = await inheritedRetainedFieldEntry(document, storage, dict, "V", options);
      if (ft === "Btn") { yield { name, type: "checkbox", value: value?.kind === "name" ? value.decoded !== "Off" : value?.kind === "boolean" ? value.value : false }; continue; }
      let text = value?.kind === "string" ? decodePdfString(value) : value?.kind === "name" ? value.decoded : "";
      if (value?.kind === "array") {
        let first = true;
        for (const item of value.items) { options.signal?.throwIfAborted(); const found = await resolve(item); if (found?.kind === "string" || found?.kind === "name") { text += `${first ? "" : ", "}${found.kind === "string" ? decodePdfString(found) : found.decoded}`; first = false; } }
      }
      yield { name, type: ft === "Tx" ? "text" : ft === "Ch" ? "choice" : "unknown", value: text };
  }
}
