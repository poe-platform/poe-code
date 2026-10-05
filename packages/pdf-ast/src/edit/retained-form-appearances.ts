import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosArray, cosBool, cosDict, cosName, cosNumber, cosString, decodePdfString, dictGet, dictSet, type PdfCosNode, type PdfCosRef } from "../ast.js";
import { appendStoredRecord, readStoredRecord } from "../content/stored-record.js";
import type { PdfMutableObjectStore } from "../cos/mutable-object-store.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { parseDefaultAppearanceString } from "./default-appearance.js";
import { serializeFormAppearanceChunks } from "./form-appearance-chunks.js";

type Location = { reference: PdfCosRef; path: (string | number)[] };
type Frame = { location: Location; named: string; ft: string; ff: number; q: number; maxLen?: number; depth: number } | { exit: number };

export interface RetainedFormUpdate { readonly name: string; readonly value: string | boolean }

/** Field traversal and generated streams live on caller storage. Locations keep
 * direct fields attached to their indirect owner without retaining the tree. */
export async function generateRetainedFormAppearances(document: PdfRetainedDocument, store: PdfMutableObjectStore, storage: PdfIndexStorage, signal: AbortSignal, update?: RetainedFormUpdate): Promise<void> {
  if (!document.crossReference.rootRef) return;
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), active = new IntegerTable(backing);
  let head = -1, failed = false, work = 0;
  let matched = false;
  let defaultAppearance: PdfCosNode | undefined;
  async function checkpoint(depth = 0) {
    signal.throwIfAborted(); if (depth > document.depthLimit) throw new PdfError("E_LIMIT", "PDF form field depth limit exceeded");
    if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
  }
  async function push(frame: Frame) { head = await appendStoredRecord(backing, { frame, previous: head }, -1, signal); }
  async function locate(location: Location) {
    let owner = await store.get(location.reference.objectNumber); if (!owner || owner.generationNumber !== location.reference.generationNumber || owner.stream) return;
    let value: PdfCosNode | undefined = owner.value, path: (string | number)[] = [], reference = location.reference, refs = 0;
    for (let i = 0; i <= location.path.length; i++) {
      while (value?.kind === "ref") {
        await checkpoint(++refs); reference = value; owner = await store.get(value.objectNumber);
        if (!owner || owner.generationNumber !== reference.generationNumber || owner.stream) return;
        value = owner.value; path = [];
      }
      if (!value) return;
      if (i === location.path.length) return { value, owner, location: { reference, path } };
      const key = location.path[i]!; path.push(key);
      value = typeof key === "number" ? value.kind === "array" ? value.items[key] : undefined : value.kind === "dict" ? dictGet(value, key) : undefined;
    }
  }
  const child = (location: Location, key: string | number): Location => ({ reference: location.reference, path: [...location.path, key] });
  const itemLocation = (location: Location, index: number, node: PdfCosNode): Location => node.kind === "ref" ? { reference: node, path: [] } : child(location, index);
  async function resolve(node: PdfCosNode | undefined) { const found = await document.lookup(node); return found?.stream ? undefined : found?.value; }
  async function number(node: PdfCosNode | undefined, fallback: number) { const found = await resolve(node); return found?.kind === "number" ? found.value : fallback; }
  async function stream(dict: PdfCosNode, chunks: Iterable<Uint8Array>) {
    const source = await PdfFileSource.fromStream(storage.fs, storage.directory, chunks, { signal }); let failed = false;
    try {
      const ref = await store.allocate(); await store.set({ objectNumber: ref.objectNumber, generationNumber: 0, value: dict, stream: { length: source.size, chunks: source.stream(0, source.size, signal), decoded: true } }); return ref;
    } catch (error) { failed = true; throw error; }
    finally { await source.close().catch(error => { if (!failed) throw error; }); }
  }
  const root: Location = { reference: document.crossReference.rootRef!, path: [] };
  const formLocation = child(root, "AcroForm");
  async function synthesize(location: Location, text: string, frame: Exclude<Frame, { exit: number }>) {
    const target = await locate(location); if (target?.value.kind !== "dict") return;
    const rect = await resolve(dictGet(target.value, "Rect")); let width = 120, height = 20;
    if (rect?.kind === "array" && rect.items.length >= 4) {
      const values = await Promise.all(rect.items.slice(0, 4).map(item => resolve(item)));
      if (values.every(value => value?.kind === "number")) {
        width = Math.max(10, Math.abs((values[2] as { value: number }).value - (values[0] as { value: number }).value));
        height = Math.max(10, Math.abs((values[3] as { value: number }).value - (values[1] as { value: number }).value));
      }
    }
    let daValue = dictGet(target.value, "DA");
    if (daValue === undefined) {
      const parent = await resolve(dictGet(target.value, "Parent"));
      daValue = (parent?.kind === "dict" ? dictGet(parent, "DA") : undefined) ?? defaultAppearance;
    }
    const daNode = await resolve(daValue);
    const da = daNode?.kind === "string" ? parseDefaultAppearanceString(decodePdfString(daNode), height) : { baseFont: "Helvetica", fontSize: 11, colorOp: undefined };
    const font = await store.allocate(cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName(da.baseFont) }));
    const ap = await stream(cosDict({ Type: cosName("XObject"), Subtype: cosName("Form"), FormType: cosNumber(1), BBox: cosArray([0, 0, width, height].map(v => cosNumber(v))), Resources: cosDict({ Font: cosDict({ F1: font }) }) }),
      serializeFormAppearanceChunks(text, { width, height, fontSize: da.fontSize, ...(da.colorOp ? { colorOp: da.colorOp } : {}), alignment: frame.q, ...(frame.maxLen === undefined ? {} : { maxLength: frame.maxLen }), comb: !!(frame.ff & (1 << 24)), password: !!(frame.ff & (1 << 13)), signal }));
    dictSet(target.value, "AP", cosDict({ N: ap })); await store.set(target.owner);
  }
  async function onValue(location: Location): Promise<string> {
    const direct = await locate(child(child(location, "AP"), "N"));
    if (direct?.value.kind === "dict") for (const entry of direct.value.entries) if (entry.key.decoded !== "Off") return entry.key.decoded;
    const kids = await locate(child(location, "Kids"));
    if (kids?.value.kind === "array") for (let i = 0; i < kids.value.items.length; i++) {
      await checkpoint(); const normal = await locate(child(child(itemLocation(kids.location, i, kids.value.items[i]!), "AP"), "N"));
      if (normal?.value.kind === "dict") for (const entry of normal.value.entries) if (entry.key.decoded !== "Off") return entry.key.decoded;
    }
    return "Yes";
  }
  try {
    let form = await locate(formLocation);
    if (update && form?.value.kind !== "dict") {
      const catalog = await locate(root); if (catalog?.value.kind !== "dict") return;
      dictSet(catalog.value, "AcroForm", await store.allocate(cosDict({ Fields: cosArray([]), NeedAppearances: cosBool(true) })));
      await store.set(catalog.owner); form = await locate(formLocation);
    }
    if (form?.value.kind !== "dict") return;
    if (update) {
      dictSet(form.value, "NeedAppearances", cosBool(true)); await store.set(form.owner);
      const fields = await locate(child(form.location, "Fields"));
      if (fields?.value.kind !== "array") { dictSet(form.value, "Fields", cosArray([])); await store.set(form.owner); }
    }
    defaultAppearance = dictGet(form.value, "DA");
    const need = await resolve(dictGet(form.value, "NeedAppearances")), force = need?.kind === "boolean" && need.value;
    const fields = await locate(child(form.location, "Fields"));
    if (fields?.value.kind === "array") for (let i = fields.value.items.length - 1; i >= 0; i--) { await checkpoint(); await push({ location: itemLocation(fields.location, i, fields.value.items[i]!), named: "", ft: "", ff: 0, q: 0, depth: 0 }); }
    while (head !== -1) {
      const record = await readStoredRecord<{ frame: Frame; previous: number }>(backing, head, signal); head = record.value.previous; const frame = record.value.frame;
      if ("exit" in frame) { await active.set(BigInt(frame.exit), 0n); continue; }
      await checkpoint(frame.depth);
      const field = await locate(frame.location); if (field?.value.kind !== "dict") continue;
      if (!field.location.path.length) {
        const id = field.location.reference.objectNumber; if (await active.get(BigInt(id)) === 1n) continue;
        await active.set(BigInt(id), 1n); await push({ exit: id });
      }
      const name = await resolve(dictGet(field.value, "T")), ft = await resolve(dictGet(field.value, "FT"));
      const partial = name?.kind === "name" ? name.decoded : name?.kind === "string" ? decodePdfString(name) : "";
      const named = update ? (frame.named && partial ? `${frame.named}.${partial}` : partial || frame.named) : (frame.named || partial ? "1" : "");
      const inherited = { ...frame, named, ft: ft?.kind === "name" ? ft.decoded : frame.ft, ff: await number(dictGet(field.value, "Ff"), frame.ff), q: await number(dictGet(field.value, "Q"), frame.q) };
      const maxLen = await resolve(dictGet(field.value, "MaxLen")); if (maxLen?.kind === "number") inherited.maxLen = maxLen.value;
      const kids = await locate(child(field.location, "Kids"));
      if (kids?.value.kind === "array" && kids.value.items.length) {
        let namedKids = false;
        for (let i = 0; i < kids.value.items.length; i++) { await checkpoint(); const kid = await locate(itemLocation(kids.location, i, kids.value.items[i]!)); if (kid?.value.kind === "dict" && dictGet(kid.value, "T")) { namedKids = true; break; } }
        if (namedKids || !inherited.ft || !named) {
          for (let i = kids.value.items.length - 1; i >= 0; i--) { await checkpoint(); await push({ ...inherited, location: itemLocation(kids.location, i, kids.value.items[i]!), depth: frame.depth + 1 }); }
          continue;
        }
      }
      if (!named) continue;
      if (update) {
        if (named !== update.name) continue;
        matched = true;
        const value = update.value;
        if (typeof value === "boolean" || inherited.ft === "Btn") {
          const on = await onValue(field.location);
          const checked = typeof value === "boolean" ? value : value !== "Off" && value !== "false" && value !== "0" && value !== "";
          const chosen = typeof value === "string" && value !== "true" && value !== "false" && value !== "Off" ? value : on;
          const state = cosName(checked ? chosen : "Off");
          dictSet(field.value, "FT", cosName("Btn")); dictSet(field.value, "V", state); dictSet(field.value, "AS", state); await store.set(field.owner);
          if (kids?.value.kind === "array") for (let i = 0; i < kids.value.items.length; i++) {
            await checkpoint(); const kid = await locate(itemLocation(kids.location, i, kids.value.items[i]!)); if (kid?.value.kind !== "dict") continue;
            const normal = await locate(child(child(kid.location, "AP"), "N"));
            const selected = normal?.value.kind === "dict" && normal.value.entries.length ? cosName(checked && dictGet(normal.value, chosen) !== undefined ? chosen : "Off") : state;
            dictSet(kid.value, "AS", selected); await store.set(kid.owner);
          }
          continue;
        }
        if (!inherited.ft) dictSet(field.value, "FT", cosName("Tx"));
        let text = String(value);
        const multi = inherited.ft === "Ch" && !!(inherited.ff & (1 << 21)) && text.includes(",");
        const selected = multi ? text.split(",").map(value => value.trim()).filter(Boolean) : [text];
        dictSet(field.value, "V", multi ? cosArray(selected.map(value => cosString(value))) : cosString(text));
        if (inherited.ft === "Ch") {
          const choices = await resolve(dictGet(field.value, "Opt")), indices: number[] = [];
          if (choices?.kind === "array") for (let i = 0; i < choices.items.length; i++) {
            await checkpoint(); const option = await resolve(choices.items[i]);
            let exported = "", label = "", valid = false;
            if (option?.kind === "string") { exported = decodePdfString(option); label = exported; valid = true; }
            else if (option?.kind === "array" && option.items.length >= 2) {
              const first = await resolve(option.items[0]), second = await resolve(option.items[1]);
              exported = first?.kind === "string" ? decodePdfString(first) : ""; label = second?.kind === "string" ? decodePdfString(second) : ""; valid = true;
            }
            if (valid && (selected.includes(exported) || selected.includes(label))) { indices.push(i); if (!multi) { if (label) text = label; break; } }
          }
          if (indices.length) dictSet(field.value, "I", cosArray(indices.map(value => cosNumber(value))));
        }
        await store.set(field.owner);
        await synthesize(field.location, text, inherited);
        if (kids?.value.kind === "array") for (let i = 0; i < kids.value.items.length; i++) {
          await checkpoint(); const kid = await locate(itemLocation(kids.location, i, kids.value.items[i]!));
          if (kid?.value.kind === "dict" && !dictGet(kid.value, "T")) await synthesize(kid.location, text, inherited);
        }
        continue;
      }
      const value = await resolve(dictGet(field.value, "V")); if (!value) continue;
      const appearance = await resolve(dictGet(field.value, "AP")), hasNormal = appearance?.kind === "dict" && dictGet(appearance, "N") !== undefined;
      if (!force && hasNormal) continue;
      if (inherited.ft === "Btn") {
        dictSet(field.value, "AS", cosName(value.kind === "name" ? value.decoded : value.kind === "string" ? decodePdfString(value) : "Off"));
        if (!hasNormal) {
          const name = await onValue(field.location), dict = cosDict({ Type: cosName("XObject"), Subtype: cosName("Form"), BBox: cosArray([0, 0, 12, 12].map(v => cosNumber(v))) });
          const on = await stream(dict, [new TextEncoder().encode("q 0 0 0 rg 2 2 8 8 re f Q\n")]);
          const off = await stream(dict, [new TextEncoder().encode("q Q\n")]);
          dictSet(field.value, "AP", cosDict({ N: cosDict({ [name]: on, Off: off }) }));
        }
        await store.set(field.owner); continue;
      }
      let text = value.kind === "string" ? decodePdfString(value) : value.kind === "name" ? value.decoded : "";
      if (inherited.ft === "Ch") {
        const choices = await resolve(dictGet(field.value, "Opt"));
        if (choices?.kind === "array") for (const choice of choices.items) {
          await checkpoint(); const pair = await resolve(choice); if (pair?.kind !== "array" || pair.items.length < 2) continue;
          const exportValue = await resolve(pair.items[0]), display = await resolve(pair.items[1]);
          const exported = exportValue?.kind === "string" ? decodePdfString(exportValue) : "", label = display?.kind === "string" ? decodePdfString(display) : "";
          if (exported === text && label) { text = label; break; }
        }
      }
      await synthesize(field.location, text, inherited);
      if (kids?.value.kind === "array") for (let i = 0; i < kids.value.items.length; i++) {
        await checkpoint(); const kid = await locate(itemLocation(kids.location, i, kids.value.items[i]!));
        if (kid?.value.kind === "dict" && !dictGet(kid.value, "T")) await synthesize(kid.location, text, inherited);
      }
    }
    if (update && !matched) {
      const fields = await locate(child(formLocation, "Fields"));
      if (fields?.value.kind === "array") {
        const value = update.value;
        const field = typeof value === "boolean" ? cosDict({ FT: cosName("Btn"), T: cosString(update.name), V: cosName(value ? "Yes" : "Off"), AS: cosName(value ? "Yes" : "Off") }) : cosDict({ FT: cosName("Tx"), T: cosString(update.name), V: cosString(value) });
        fields.value.items.push(await store.allocate(field)); await store.set(fields.owner);
      }
    }
    const latest = await locate(formLocation);
    if (latest?.value.kind === "dict") { dictSet(latest.value, "NeedAppearances", cosBool(!!update)); await store.set(latest.owner); }
  } catch (error) { failed = true; throw error; }
  finally { await backing.close().catch(error => { if (!failed) throw error; }); }
}
