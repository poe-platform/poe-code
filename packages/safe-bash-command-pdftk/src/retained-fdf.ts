import { PdfError, PdfFileSource, PdfMutableObjectStore, PdfNameIndex, cosArray, cosDict, cosNumber, cosString, decodePdfString, dictGet, type PdfCosNode, type PdfRetainedDocument, type PdfRetainedFormFieldDetails } from "@poe-code/pdf-ast";

type Storage = ConstructorParameters<typeof PdfMutableObjectStore>[0];

/** Preserve FDF hierarchy and last-field-name-wins semantics with caller-backed
 * field values and traversal records. Individual source COS values remain resident. */
export async function* retainedFdf(document: PdfRetainedDocument, storage: Storage, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const names = new PdfNameIndex(storage, Infinity, signal);
  const values = new PdfMutableObjectStore(storage, { signal });
  const tree = new PdfMutableObjectStore(storage, { signal });
  const encoder = new TextEncoder();
  let work = 0, failed = false;
  async function checkpoint() { signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
  async function resolve(node: PdfCosNode | undefined) { await checkpoint(); const found = await document.lookup(node); return found?.stream ? undefined : found?.value; }
  async function* text(value: string, escape = false): AsyncGenerator<Uint8Array> {
    let chunk = "";
    for (const char of value) {
      chunk += escape ? char === "\\" || char === "(" || char === ")" ? `\\${char}` : char === "\r" ? "\\r" : char === "\n" ? "\\n" : char : char;
      if (chunk.length >= 4096) { await checkpoint(); yield encoder.encode(chunk); chunk = ""; }
    }
    if (chunk) { signal.throwIfAborted(); yield encoder.encode(chunk); }
  }
  async function* fieldValue(field: PdfRetainedFormFieldDetails) {
    if (field.checked !== undefined) { yield* text(`/${field.checked ? field.stateValue ?? "Yes" : "Off"}`); return; }
    let count = 0;
    for await (const ignored of field.values()) { void ignored; if (++count > 1) break; }
    if (count > 1) yield* text("[ ");
    let first = true;
    for await (const value of field.values()) {
      if (!first) yield* text(" "); first = false;
      yield* text("("); yield* text(value, true); yield* text(")");
    }
    if (count > 1) yield* text(" ]");
  }
  // Each record contains a source node, full/partial names, child cursor,
  // first/last child, next sibling, parent and depth. No resident tree or stack.
  async function record(id: number) {
    const node = (await tree.get(id))?.value;
    if (node?.kind !== "array") throw new PdfError("E_PARSE", "Invalid FDF traversal record");
    return node.items;
  }
  const number = (items: PdfCosNode[], at: number) => { const node = items[at]; if (node?.kind !== "number") throw new PdfError("E_PARSE", "Invalid FDF traversal number"); return node.value; };
  const string = (items: PdfCosNode[], at: number) => { const node = items[at]; if (node?.kind !== "string") throw new PdfError("E_PARSE", "Invalid FDF traversal name"); return decodePdfString(node); };
  const save = async (id: number, items: PdfCosNode[]) => tree.set({ objectNumber: id, generationNumber: 0, value: cosArray(items) });
  try {
    for await (const field of document.formFieldDetails()) {
      for await (const ignored of field.options()) void ignored;
      const name = await names.intern(field.name);
      const staged = await PdfFileSource.fromStream(storage.fs, storage.directory, fieldValue(field), { signal });
      let valueFailed = false;
      try { await values.set({ objectNumber: name.index + 1, generationNumber: 0, value: cosDict({}), stream: { length: staged.size, chunks: staged.stream(0, staged.size, signal) } }); }
      catch (error) { valueFailed = true; throw error; }
      finally { await staged.close().catch(error => { if (!valueFailed) throw error; }); }
    }
    const catalog = await resolve(document.crossReference.rootRef);
    const form = catalog?.kind === "dict" ? await resolve(dictGet(catalog, "AcroForm")) : undefined;
    const roots = form?.kind === "dict" ? await resolve(dictGet(form, "Fields")) : undefined;
    await save(1, [cosDict({}), cosString(""), cosString(""), ...Array.from({ length: 6 }, () => cosNumber(0))]);
    let top = 1, next = 1;
    while (top) {
      await checkpoint();
      const frame = await record(top), node = await resolve(frame[0]);
      const kids = top === 1 ? roots : node?.kind === "dict" ? await resolve(dictGet(node, "Kids")) : undefined;
      let descended = false, cursor = number(frame, 3);
      while (kids?.kind === "array" && cursor < kids.items.length) {
        const childNode = kids.items[cursor++]!, child = await resolve(childNode);
        if (child?.kind !== "dict" || (top !== 1 && !dictGet(child, "T"))) continue;
        const name = await resolve(dictGet(child, "T")), partial = name?.kind === "string" ? decodePdfString(name) : "";
        const prefix = string(frame, 1), full = prefix && partial ? `${prefix}.${partial}` : partial || prefix;
        const depth = number(frame, 8) + 1;
        if (depth > document.depthLimit) throw new PdfError("E_LIMIT", "PDF FDF field depth limit exceeded");
        frame[3] = cosNumber(cursor); await save(top, frame);
        await save(++next, [childNode, cosString(full), cosString(partial), cosNumber(0), cosNumber(0), cosNumber(0), cosNumber(0), cosNumber(top), cosNumber(depth)]);
        top = next; descended = true; break;
      }
      if (descended) continue;
      const parent = number(frame, 7);
      if (parent && (number(frame, 4) || string(frame, 1) || string(frame, 2))) {
        const owner = await record(parent), last = number(owner, 5);
        if (last) { const sibling = await record(last); sibling[6] = cosNumber(top); await save(last, sibling); }
        else owner[4] = cosNumber(top);
        owner[5] = cosNumber(top); await save(parent, owner);
      }
      top = parent;
    }
    yield* text("%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [\n");
    let current = number(await record(1), 4);
    if (current) yield* text("  ");
    while (current) {
      await checkpoint();
      const frame = await record(current), child = number(frame, 4);
      yield* text("<< /T ("); yield* text(string(frame, 2) || string(frame, 1), true); yield* text(")");
      if (child) { yield* text(" /Kids [ "); current = child; continue; }
      yield* text(" /V ");
      const name = await names.intern(string(frame, 1)), value = name.added ? undefined : await values.get(name.index + 1);
      if (value?.stream) yield* value.stream.chunks;
      else {
        const dict = await resolve(frame[0]), raw = dict?.kind === "dict" ? await resolve(dictGet(dict, "V")) : undefined;
        if (raw?.kind === "name") yield* text(`/${raw.decoded}`);
        else { yield* text("("); if (raw?.kind === "string") yield* text(decodePdfString(raw), true); yield* text(")"); }
      }
      yield* text(" >>");
      while (current) {
        const done = await record(current), sibling = number(done, 6), parent = number(done, 7);
        if (sibling) { yield* text(parent === 1 ? "\n  " : " "); current = sibling; break; }
        current = parent === 1 ? 0 : parent;
        if (current) yield* text(" ] >>");
      }
    }
    yield* text("\n] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([names.close(), values.close(), tree.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
