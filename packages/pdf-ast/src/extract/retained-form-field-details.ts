import { decodePdfString, dictGet, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfFormFieldInfo } from "../edit/forms.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { inheritedRetainedFieldEntry, walkRetainedFieldEntries, type RetainedFieldOptions } from "./retained-form-fields.js";

/** Borrowed field metadata. Consume values/options before advancing the field
 * iterator. Both iterators close when their field or document is released. */
export interface PdfRetainedFormFieldDetails {
  readonly name: string;
  readonly type: PdfFormFieldInfo["type"];
  readonly flags: number;
  readonly justification: "Left" | "Centered" | "Right";
  readonly maxLength: number | undefined;
  readonly altName: string | undefined;
  readonly defaultValue: string | undefined;
  readonly stateValue: string | undefined;
  readonly checked: boolean | undefined;
  values(): AsyncGenerator<string, void, void>;
  options(): AsyncGenerator<string, void, void>;
}

export async function* walkRetainedFormFieldDetails(document: PdfRetainedDocument, storage: PdfIndexStorage, options: RetainedFieldOptions = {}): AsyncGenerator<PdfRetainedFormFieldDetails, void, void> {
  let work = 0;
  async function checkpoint() { options.signal?.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); options.signal?.throwIfAborted(); }
  async function resolve(node: PdfCosNode | undefined) { await checkpoint(); const found = await document.lookup(node); return found?.stream ? undefined : found?.value; }
  const text = (node: PdfCosNode | undefined) => node?.kind === "string" ? decodePdfString(node) : node?.kind === "name" ? node.decoded : undefined;
  for await (const entry of walkRetainedFieldEntries(document, storage, options)) {
    const { dict, ft } = entry;
    let active = true;
    const readers = new Set<AsyncGenerator<string, void, void>>();
    const assertActive = () => { options.signal?.throwIfAborted(); if (!active) throw new PdfError("E_CAPABILITY", "Retained form field is no longer active"); };
    function owned(producer: () => AsyncGenerator<string, void, void>): AsyncGenerator<string, void, void> {
      async function* visit(): AsyncGenerator<string, void, void> {
        assertActive(); readers.add(reader);
        try { for await (const value of producer()) { assertActive(); yield value; } }
        finally { readers.delete(reader); }
      }
      const reader = visit();
      return reader;
    }
    async function* stateOptions(): AsyncGenerator<string, void, void> {
      const seen = new PdfNameIndex(storage, options.maxStagingBytes, options.signal);
      let count = 0, failed = false;
      async function* unique(value: string | undefined) { assertActive(); if (value && (await seen.intern(value)).added) { count++; yield value; } }
      async function* appearances(field: PdfCosDict) {
        const appearance = await resolve(dictGet(field, "AP"));
        const normal = appearance?.kind === "dict" ? await resolve(dictGet(appearance, "N")) : undefined;
        if (normal?.kind === "dict") for (const pair of normal.entries) { await checkpoint(); yield* unique(pair.key.decoded); }
      }
      try {
        if (ft === "Btn") {
          yield* unique("Off"); yield* appearances(dict);
          const kids = await resolve(dictGet(dict, "Kids"));
          if (kids?.kind === "array") for (const kid of kids.items) { const field = await resolve(kid); if (field?.kind === "dict") yield* appearances(field); }
          if (count === 1) yield* unique("Yes");
        }
        const choices = await inheritedRetainedFieldEntry(document, storage, dict, "Opt", options);
        if (choices?.kind === "array") for (const item of choices.items) {
          let value = await resolve(item);
          if (value?.kind === "array" && value.items.length) value = await resolve(value.items[value.items.length - 1]);
          yield* unique(text(value));
        }
      } catch (error) { failed = true; throw error; }
      finally { await seen.close().catch(error => { if (!failed) throw error; }); }
    }
    const value = await inheritedRetainedFieldEntry(document, storage, dict, "V", options);
    const defaultValue = text(await inheritedRetainedFieldEntry(document, storage, dict, "DV", options));
    const altName = text(await inheritedRetainedFieldEntry(document, storage, dict, "TU", options));
    const checked = ft === "Btn" ? value?.kind === "name" ? value.decoded !== "Off" : value?.kind === "boolean" ? value.value : false : undefined;
    let stateValue: string | undefined;
    if (ft === "Btn") {
      stateValue = value?.kind === "name" ? value.decoded : checked ? "Yes" : "Off";
      if (checked && value?.kind !== "name") for await (const option of stateOptions()) if (option !== "Off") { stateValue = option; break; }
    }
    async function* values() {
      if (stateValue !== undefined) { yield stateValue; return; }
      if (value?.kind !== "array") { yield text(value) ?? ""; return; }
      let any = false;
      for (const item of value.items) { const selected = text(await resolve(item)); if (selected !== undefined) { any = true; yield selected; } }
      if (!any) yield "";
    }
    let failed = false;
    try {
      yield { name: entry.name, type: ft === "Btn" ? "checkbox" : ft === "Ch" ? "choice" : ft === "Tx" ? "text" : "unknown", flags: entry.flags,
        justification: entry.justification === 1 ? "Centered" : entry.justification === 2 ? "Right" : "Left", maxLength: entry.maxLength,
        altName, defaultValue, checked, stateValue, values: () => owned(values), options: () => owned(stateOptions) };
    } catch (error) { failed = true; throw error; }
    finally {
      active = false;
      const results = await Promise.allSettled([...readers].map(reader => reader.return()));
      if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
    }
  }
}
