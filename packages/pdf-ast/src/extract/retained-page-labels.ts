import { decodePdfString, dictGet, type PdfCosNode } from "../ast.js";
import { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import { PdfReferenceSet } from "../cos/reference-set.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfRetainedDocument } from "../retained-document.js";

export interface PdfRetainedPageLabel {
  readonly index: number;
  readonly start: number;
  readonly prefix?: string;
  readonly style?: string;
}

/** Visit number-tree entries in source order, including duplicate indices.
 * Pending children and visited identities use caller storage. A single COS
 * dictionary/array is still subject to the reader's structural admission. */
export async function* walkRetainedPageLabels(document: PdfRetainedDocument, storage: PdfIndexStorage, options: {
  maxStagingBytes?: number; signal?: AbortSignal;
} = {}): AsyncGenerator<PdfRetainedPageLabel, void, void> {
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const frames = new PdfMutableObjectStore(storage, { signal, ...(options.maxStagingBytes === undefined ? {} : { maxStagingBytes: options.maxStagingBytes }) });
  const visited = new PdfReferenceSet(storage, options.maxStagingBytes, signal);
  let pending = 0, failed = false, work = 0;
  async function resolve(node: PdfCosNode | undefined) {
    const found = await document.lookup(node); return found?.stream ? undefined : found?.value;
  }
  async function checkpoint() {
    signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
  }
  try {
    const root = await resolve(document.crossReference.rootRef);
    let node = root?.kind === "dict" ? dictGet(root, "PageLabels") : undefined;
    for (;;) {
      await checkpoint();
      const dict = await resolve(node);
      if (dict?.kind === "dict") {
        const nums = await resolve(dictGet(dict, "Nums"));
        if (nums?.kind === "array") for (let i = 0; i + 1 < nums.items.length; i += 2) {
          await checkpoint();
          const index = await resolve(nums.items[i]), label = await resolve(nums.items[i + 1]);
          if (index?.kind !== "number" || label?.kind !== "dict") continue;
          const start = await resolve(dictGet(label, "St")), prefix = await resolve(dictGet(label, "P")), style = await resolve(dictGet(label, "S"));
          yield { index: index.value, start: start?.kind === "number" ? start.value : 1,
            ...(prefix?.kind === "string" ? { prefix: decodePdfString(prefix) } : {}),
            ...(style?.kind === "name" ? { style: style.decoded } : {}),
          };
        }
        const kids = await resolve(dictGet(dict, "Kids"));
        if (kids?.kind === "array") for (let i = kids.items.length - 1; i >= 0; i--) {
          await checkpoint();
          await frames.set({ objectNumber: ++pending, generationNumber: 0, value: kids.items[i]! });
        }
      }
      node = undefined;
      while (pending) {
        await checkpoint();
        const child = (await frames.get(pending--))!.value;
        if (child.kind === "ref" && !await visited.add(child.objectNumber)) continue;
        node = child; break;
      }
      if (!node) return;
    }
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([frames.close(), visited.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
