import { qpdfJsonEncryption } from "./json-encryption.js";
import { qpdfJsonPage } from "./json-pages.js";
import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfError, PdfFileSource, PdfMutableObjectStore, PdfStagedOutputs, cosArray, cosString, decodePdfString, dictGet, type PdfIndexStorage, type PdfRetainedDocument } from "@poe-code/pdf-ast";
import { retainedAttachments } from "./attachments.js";
import { qpdfObjectOrder } from "./object-order.js";
import { base64Parts, cosJson, jsonChunks, jsonRecord, type JsonValue } from "./json-output.js";

export interface QpdfJsonOptions {
  jsonVersion: number | undefined;
  jsonKeys: readonly string[];
  jsonObjectSelectors: readonly ({ kind: "trailer" } | { kind: "obj"; objNum: number; genNum: number })[];
  jsonStreamDataMode: "none" | "inline" | "file";
  jsonStreamPrefix: string | undefined;
  outputFile: string | undefined;
}

/** Produce both JSON and auxiliary decoded streams before publishing any byte. */
export async function createQpdfJson(sourceDocument: PdfRetainedDocument, document: PdfRetainedDocument, source: PdfFileSource, storage: PdfIndexStorage,
  options: QpdfJsonOptions, inputNames: Iterable<string>, maxOutputBytes: number, signal: AbortSignal): Promise<{ json: PdfFileSource; files: PdfStagedOutputs; close(): Promise<void> }> {
  const pages = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const pageBase = pages.allocate(0);
  let objectJson: PdfFileSource | undefined;
  const summaries: PdfFileSource[] = [];
  let hasFields = false;
  let count = 0, maximum = 0, originalMaximum = 0, json: PdfFileSource | undefined, files: PdfStagedOutputs | undefined, closing: Promise<void> | undefined;
  const prefix = options.jsonStreamPrefix ?? `${options.outputFile}-`;
  function close() {
    return closing ??= (async () => {
      const results = await Promise.allSettled([...summaries.map(source => source.close()), objectJson?.close(), json?.close(), files?.close(), pages.close()]);
      for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
    })();
  }
  const include = (key: string) => !options.jsonKeys.length || options.jsonKeys.includes(key);
  const includeObjects = include(options.jsonVersion === 1 ? "objects" : "qpdf");
  const selected = (number: number, generation: number) => !options.jsonObjectSelectors.length || options.jsonObjectSelectors.some(item => item.kind === "obj" && item.objNum === number && item.genNum === generation);
  async function* objects() {
    for await (const number of qpdfObjectOrder(sourceDocument, source, storage, signal)) {
      const entry = await sourceDocument.crossReference.index.get(number, signal);
      const object = await document.objects.get(number, entry?.generationNumber ?? 0); if (object) yield object;
    }
    for await (const entry of document.crossReference.index.entries(signal)) if (entry.objectNumber > originalMaximum) {
      const object = await document.objects.get(entry.objectNumber, entry.generationNumber ?? 0); if (object) yield object;
    }
  }
  async function* objectEntries(): AsyncGenerator<readonly [string, JsonValue]> {
    for await (const object of objects()) {
      signal.throwIfAborted(); if (!selected(object.objectNumber, object.generationNumber)) continue;
      let value: JsonValue;
      if (object.stream) {
        const stream: Record<string, JsonValue> = { dict: cosJson(object.value, storage, signal) };
        if (options.jsonStreamDataMode === "inline") stream.data = { kind: "text", parts: base64Parts(document.objects.decodeStream(object.objectNumber, object.generationNumber), signal) };
        else if (options.jsonStreamDataMode === "file") stream.datafile = `${prefix}${object.objectNumber}`;
        value = jsonRecord({ stream: jsonRecord(stream) });
      } else value = jsonRecord({ value: cosJson(object.value, storage, signal) });
      yield [`obj:${object.objectNumber} ${object.generationNumber} R`, value];
    }
    if (!options.jsonObjectSelectors.length || options.jsonObjectSelectors.some(item => item.kind === "trailer")) yield ["trailer", jsonRecord({ value: jsonRecord({
      "/Root": cosJson(document.crossReference.rootRef, storage, signal),
      ...(document.crossReference.infoRef ? { "/Info": cosJson(document.crossReference.infoRef, storage, signal) } : {}),
      "/Size": maximum + 1,
      ...(document.crossReference.idArray ? { "/ID": { kind: "array" as const, values: document.crossReference.idArray.items.map(item => item.kind === "string" ? `b:${Array.from(item.bytes, byte => byte.toString(16).padStart(2, "0")).join("")}` : cosJson(item, storage, signal)) } } : {})
    }) })];
  }
  async function* objectInfoEntries(): AsyncGenerator<readonly [string, JsonValue]> {
    for await (const object of objects()) {
      if (!selected(object.objectNumber, object.generationNumber)) continue;
      const dict = object.stream && object.value.kind === "dict" ? object.value : undefined;
      const filter = dict && (await document.lookup(dictGet(dict, "Filter")))?.value, length = dict && (await document.lookup(dictGet(dict, "Length")))?.value;
      yield [`${object.objectNumber} ${object.generationNumber} R`, jsonRecord({ stream: jsonRecord({
        filter: filter ? cosJson(filter, storage, signal) : null, is: Boolean(dict),
        length: length ? cosJson(length, storage, signal) : null
      }) })];
    }
  }
  async function pageObject(index: number) {
    if (!count) return "obj:0 0 R";
    if (index >= count) throw new PdfError("E_CAPABILITY", `Page index out of bounds: ${index}`);
    const bytes = await pages.read(pageBase + index * 16, 16), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return `obj:${view.getFloat64(0)} ${view.getFloat64(8)} R`;
  }
  async function* pageValues(): AsyncGenerator<JsonValue> {
    const root = (await document.lookup(document.crossReference.rootRef))?.value;
    let index = 0;
    for await (const page of document.pages()) {
      const steps = qpdfJsonPage(page.dict, page.reference!, index++, root?.kind === "dict" ? root : undefined, options.jsonVersion ?? 2);
      let step = steps.next();
      while (!step.done) { signal.throwIfAborted(); step = steps.next((await document.lookup(step.value))?.value); }
      yield step.value;
    }
  }
  async function* outlines(): AsyncGenerator<JsonValue> {
    for await (const outline of document.outlines()) {
      const reference = await pageObject(outline.pageIndex);
      if (outline.title) yield jsonRecord({ title: outline.title, destpagepos: outline.pageIndex + 1, destpageobject: reference });
    }
  }
  async function* labels(): AsyncGenerator<JsonValue> {
    for await (const { index, start, prefix, style } of document.pageLabels()) yield jsonRecord({
      index,
      label: jsonRecord({
        "/St": start,
        ...(prefix === undefined ? {} : { "/P": `${options.jsonVersion === 1 ? "" : "u:"}${prefix}` }),
        ...(style === undefined ? {} : { "/S": `/${style}` })
      })
    });
  }
  async function* fields(): AsyncGenerator<JsonValue> { for await (const field of document.formFields()) { hasFields = true; yield jsonRecord({ name: field.name, type: field.type, value: Array.isArray(field.value) ? { kind: "array", values: field.value } : field.value }); } }
  async function* attachments(): AsyncGenerator<readonly [string, JsonValue]> {
    const values = new PdfMutableObjectStore(storage, { signal }), backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), numeric = new IntegerTable(backing);
    let failed = false;
    const integerKey = (key: string) => { const value = Number(key); return Number.isInteger(value) && value >= 0 && value < 4294967295 && String(value) === key ? value : undefined; };
    async function row(number: number): Promise<readonly [string, JsonValue]> {
      const node = (await values.get(number))!.value;
      if (node.kind !== "array" || node.items[0]?.kind !== "string" || node.items[1]?.kind !== "string") throw new Error("Invalid JSON attachment record");
      return [decodePdfString(node.items[0]), jsonRecord({ filename: decodePdfString(node.items[1]) })];
    }
    try {
      for await (const attachment of retainedAttachments(document, storage, signal)) {
        for await (const ignored of document.objects.decodeStream(attachment.reference.objectNumber, attachment.reference.generationNumber)) void ignored;
        // Assignment to this key on the compatibility object's prototype setter
        // creates no enumerable property.
        if (attachment.key === "__proto__") continue;
        const ref = await values.allocate(cosArray([cosString(attachment.key), cosString(attachment.filename)])), key = integerKey(attachment.key);
        if (key !== undefined) await numeric.set(BigInt(key), BigInt(ref.objectNumber));
      }
      for await (const [, number] of numeric.entries()) yield await row(Number(number));
      for await (const object of values.objects()) { const entry = await row(object.objectNumber); if (integerKey(entry[0]) === undefined) yield entry; }
    } catch (error) { failed = true; throw error; }
    finally { const results = await Promise.allSettled([values.close(), backing.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
  }
  try {
    for await (const entry of sourceDocument.crossReference.index.entries(signal)) if (entry.type !== "free") originalMaximum = Math.max(originalMaximum, entry.objectNumber);
    for await (const entry of document.crossReference.index.entries(signal)) maximum = Math.max(maximum, entry.objectNumber);
    for await (const page of document.pages()) {
      const bytes = new Uint8Array(16), view = new DataView(bytes.buffer); view.setFloat64(0, page.reference!.objectNumber); view.setFloat64(8, page.reference!.generationNumber);
      await pages.write(pages.allocate(16), bytes); count++;
    }
    async function* fileEntries() {
      for (const name of inputNames) {
        if (name === options.outputFile && name !== "-") { yield { name, chunks: [] }; continue; }
        if (!includeObjects || options.jsonStreamDataMode !== "file" || !name.startsWith(prefix)) continue;
        const number = Number(name.slice(prefix.length));
        if (!Number.isSafeInteger(number) || number < 1 || String(number) !== name.slice(prefix.length)) continue;
        const entry = await document.crossReference.index.get(number, signal);
        if (!entry || !selected(number, entry.generationNumber ?? 0)) continue;
        if ((await document.objects.get(number, entry.generationNumber ?? 0))?.stream) yield { name, chunks: [] };
      }
      if (!includeObjects || options.jsonStreamDataMode !== "file") return;
      for await (const object of objects()) if (object.stream && selected(object.objectNumber, object.generationNumber)) {
        async function* admitted() {
          let size = 0;
          for await (const bytes of document.objects.decodeStream(object.objectNumber, object.generationNumber)) {
            if (bytes.length > maxOutputBytes - size) throw new RangeError("Output byte limit exceeded"); size += bytes.length; yield bytes;
          }
        }
        yield { name: `${prefix}${object.objectNumber}`, chunks: admitted() };
      }
    }
    files = await PdfStagedOutputs.create(storage, fileEntries(), { signal, maxNameChars: Infinity });
    // Buffered JSON visits/decode-validates objects before summaries. Retain
    // formatted object bytes so later metadata can precede them in the output.
    if (includeObjects) objectJson = await PdfFileSource.fromStream(storage.fs, storage.directory, jsonChunks({ kind: "object", entries: objectEntries() }, signal), { signal, maxInputBytes: maxOutputBytes });
    const objectValue: JsonValue = objectJson ? { kind: "formatted", chunks: objectJson.stream(0, objectJson.size, signal) } : jsonRecord({});
    async function summary(value: JsonValue): Promise<JsonValue> {
      const source = await PdfFileSource.fromStream(storage.fs, storage.directory, jsonChunks(value, signal), { signal, maxInputBytes: maxOutputBytes });
      summaries.push(source); return { kind: "formatted", chunks: source.stream(0, source.size, signal) };
    }
    const attachmentValue = include("attachments") ? await summary({ kind: "object", entries: attachments() }) : jsonRecord({});
    const root = (await document.lookup(document.crossReference.rootRef))?.value;
    const form = root?.kind === "dict" ? (await document.lookup(dictGet(root, "AcroForm")))?.value : undefined;
    const appearances = form?.kind === "dict" ? (await document.lookup(dictGet(form, "NeedAppearances")))?.value : undefined;
    const fieldValue = await summary({ kind: "array", values: include("acroform") ? fields() : [] });
    const outlineValue = await summary({ kind: "array", values: include("outlines") ? outlines() : [] });
    const labelValue = await summary({ kind: "array", values: include("pagelabels") ? labels() : [] });
    const encryption = qpdfJsonEncryption(sourceDocument.encryption, options.jsonVersion ?? 2);
    const metadata: Record<string, JsonValue> = {
      pages: include("pages") ? { kind: "array", values: pageValues() } : count,
      pagelabels: labelValue, outlines: outlineValue,
      acroform: jsonRecord({ hasacroform: form?.kind === "dict" && hasFields, needappearances: appearances?.kind === "boolean" ? appearances.value : false, fields: fieldValue }),
      encrypt: jsonRecord({ ...encryption, capabilities: jsonRecord(encryption.capabilities), parameters: jsonRecord(encryption.parameters) }), attachments: attachmentValue,
    };
    const sections: Record<string, JsonValue> = { ...metadata, objects: objectValue,
      objectinfo: { kind: "object", entries: objectInfoEntries() },
      qpdf: { kind: "array", values: [jsonRecord({ jsonversion: 2, pdfversion: document.crossReference.version, pushedinheritedpageresources: false,
        calledgetallpages: ["pages", "pagelabels", "acroform", "outlines"].some(include), maxobjectid: maximum }), objectValue] }
    };
    const selectedPayload: Record<string, JsonValue> = { version: options.jsonVersion ?? 2, parameters: jsonRecord({ decodelevel: "generalized" }) };
    for (const key of options.jsonKeys.length ? options.jsonKeys : ["pages", "pagelabels", "acroform", "attachments", "encrypt", "outlines", ...(options.jsonVersion === 1 ? ["objects", "objectinfo"] : ["qpdf"])]) selectedPayload[key] = sections[key]!;
    json = await PdfFileSource.fromStream(storage.fs, storage.directory, jsonChunks(jsonRecord(selectedPayload), signal), { signal, maxInputBytes: maxOutputBytes });
    let total = json.size;
    for await (const entry of files.entries()) {
      if (entry.name === options.outputFile && options.outputFile !== "-") continue;
      if (entry.size > maxOutputBytes - total) throw new RangeError("Output byte limit exceeded"); total += entry.size;
    }
    return { json, files, close };
  } catch (error) {
    await close().catch(() => {});
    if (error instanceof PdfError && error.message.startsWith("Unsupported streaming PDF filter: ")) throw new PdfError(error.code, `Unsupported PDF filter: ${error.message.slice("Unsupported streaming PDF filter: ".length)}`);
    throw error;
  }
}
