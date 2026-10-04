import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosNumber, cosString, decodePdfString, dictGet, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfFormFieldInfo } from "../edit/forms.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";

export type PdfRetainedFormField = Pick<PdfFormFieldInfo, "name" | "type" | "value">;

/** Summarize fields one at a time. Traversal frames and active-path membership
 * live on caller storage, preserving repeated fields while stopping cycles. */
export async function* walkRetainedFormFields(document: PdfRetainedDocument, storage: PdfIndexStorage, options: {
  maxDepth?: number; maxStagingBytes?: number; signal?: AbortSignal;
} = {}): AsyncGenerator<PdfRetainedFormField, void, void> {
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
  async function push(node: PdfCosNode, prefix: string, ft: string, depth: number) {
    await frames.set({ objectNumber: ++pending, generationNumber: 0, value: cosArray([node, cosString(prefix), cosString(ft), cosNumber(depth)]) });
  }
  async function inheritedValue(dict: PdfCosDict): Promise<PdfCosNode | undefined> {
    const seen = new PdfReferenceSet(storage, options.maxStagingBytes, signal); let current: PdfCosDict | undefined = dict, depth = 0, failed = false;
    try {
      while (current) {
        await checkpoint(++depth); const value = dictGet(current, "V"); if (value !== undefined) return await resolve(value);
        const parent = dictGet(current, "Parent"); if (parent?.kind === "ref" && !await seen.add(parent.objectNumber)) return;
        const found = await resolve(parent); current = found?.kind === "dict" ? found : undefined;
      }
    } catch (error) { failed = true; throw error; }
    finally { await seen.close().catch(error => { if (!failed) throw error; }); }
  }
  try {
    const root = await resolve(document.crossReference.rootRef), form = root?.kind === "dict" ? await resolve(dictGet(root, "AcroForm")) : undefined;
    const fields = form?.kind === "dict" ? await resolve(dictGet(form, "Fields")) : undefined;
    if (fields?.kind !== "array") return;
    for (let i = fields.items.length - 1; i >= 0; i--) { await checkpoint(); await push(fields.items[i]!, "", "", 0); }
    while (pending) {
      const frame = (await frames.get(pending--))!.value;
      if (frame.kind !== "array") throw new PdfError("E_PARSE", "Invalid form traversal frame");
      const [node, prefixNode, ftNode, depthNode] = frame.items;
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
      const kids = await resolve(dictGet(dict, "Kids"));
      if (kids?.kind === "array" && kids.items.length) {
        let namedKids = false;
        for (const kid of kids.items) { await checkpoint(); const value = await resolve(kid); if (value?.kind === "dict" && dictGet(value, "T")) { namedKids = true; break; } }
        if (namedKids || !ft || !name) {
          for (let i = kids.items.length - 1; i >= 0; i--) { await checkpoint(); await push(kids.items[i]!, name, ft, depthNode.value + 1); }
          continue;
        }
      }
      if (!name) continue;
      const value = await inheritedValue(dict);
      if (ft === "Btn") { yield { name, type: "checkbox", value: value?.kind === "name" ? value.decoded !== "Off" : value?.kind === "boolean" ? value.value : false }; continue; }
      let text = value?.kind === "string" ? decodePdfString(value) : value?.kind === "name" ? value.decoded : "";
      if (value?.kind === "array") {
        let first = true;
        for (const item of value.items) { await checkpoint(); const found = await resolve(item); if (found?.kind === "string" || found?.kind === "name") { text += `${first ? "" : ", "}${found.kind === "string" ? decodePdfString(found) : found.decoded}`; first = false; } }
      }
      yield { name, type: ft === "Tx" ? "text" : ft === "Ch" ? "choice" : "unknown", value: text };
    }
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([frames.close(), backing.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
}
