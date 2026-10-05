import { readPdfDictionaryValue } from "../content/stored-dictionary.js";
import { cosDict, decodePdfString, dictGet, type PdfCosDict, type PdfCosNode } from "../ast.js";
import { PdfOperandStack } from "../content/operand-stack.js";
import type { PdfContentOperator } from "../content/operator-parser.js";
import { parseContentRangeOperators } from "../content/range-operator-parser.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import { PdfError } from "../errors.js";
import type { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { PdfStagedOutputs, type PdfOutputEntry } from "../staged-outputs.js";

export type PdfRetainedStructureItem =
  | { readonly kind: "element"; readonly depth: number; readonly role: string; readonly mappedRole?: string }
  | { readonly kind: "text"; readonly depth: number; /** Consume before advancing the structure iterator. */ contents(): AsyncGenerator<Uint8Array, void, void> };
export interface PdfStructureSelection { readonly includeText?: boolean }
interface Options extends PdfStructureSelection { maxDepth: number; maxStagingBytes?: number; chunkBytes?: number; signal?: AbortSignal }

async function* utf8(text: string, chunkBytes: number, signal?: AbortSignal): AsyncGenerator<Uint8Array, void, void> {
  const encoder = new TextEncoder(); let turns = 0;
  for (let at = 0; at < text.length;) {
    signal?.throwIfAborted();
    if (++turns % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
    let end = Math.min(text.length, at + Math.floor(chunkBytes / 3));
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield encoder.encode(text.slice(at, end)); at = end;
  }
}

/** Back text-object segments so nested BT can replace pending text, while
 * graphics/marked-content boundaries preserve the buffered parser's grouping. */
async function markedText(document: PdfRetainedDocument, page: PdfCosDict, mcid: number, storage: PdfIndexStorage, options: Options) {
  const chunkBytes = Math.max(32, options.chunkBytes ?? 4096), maximum = options.maxStagingBytes ?? Infinity, signal = options.signal;
  let source: PdfFileSource | undefined, outputs: PdfStagedOutputs | undefined, closed = false;
  const marks = new PdfOperandStack(storage, { chunkBytes, maxStagingBytes: maximum, maxNodes: 1, maxDepth: 1, maxTokenBytes: 8, ...(signal ? { signal } : {}) });
  async function close() {
    if (closed) return; closed = true;
    const results = await Promise.allSettled([outputs?.close(), source?.close(), marks.close()]);
    for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
  async function* input() {
    const value = await document.lookup(dictGet(page, "Contents"));
    if (value?.stream && value.reference) yield* document.objects.decodeStream(value.reference.objectNumber, value.reference.generationNumber);
    else if (value?.value.kind === "array") for (const item of value.value.items) {
      const stream = await document.lookup(item);
      if (stream?.stream && stream.reference) yield* document.objects.decodeStream(stream.reference.objectNumber, stream.reference.generationNumber);
    }
  }
  try {
    source = await PdfFileSource.fromStream(storage.fs, storage.directory, input(), { chunkBytes, cacheBytes: chunkBytes, maxInputBytes: maximum, ...(signal ? { signal } : {}) });
    const resources = (await document.lookup(dictGet(page, "Resources"), undefined, ["Resources"]))?.value;
    const properties = resources?.kind === "dict" ? (await document.lookup(dictGet(resources, "Properties"), undefined, ["Properties"]))?.value : undefined;
    const operators = parseContentRangeOperators(source, storage, { chunkBytes, maxStagingBytes: maximum - source.size, ...(signal ? { signal } : {}) });
    let pending: PdfContentOperator | undefined, matching = false, inText = false, part = 0, recorded = false;
    function boundary(command: PdfContentOperator) { return command.inlineImage !== undefined || ["BT", "ET", "q", "Q", "BMC", "BDC", "EMC"].includes(command.operator); }
    async function* fragments(command: PdfContentOperator): AsyncGenerator<Uint8Array> {
      const { operator, operands } = command;
      const nodes = operator === "TJ" && operands[0]?.kind === "array" ? operands[0].items : operator === "Tj" || operator === "'" ? [operands[0]] : operator === '"' ? [operands[2]] : [];
      for (const node of nodes) {
        if (node?.kind === "string") yield* utf8(decodePdfString(node), chunkBytes, signal);
        else if (operator === "TJ" && node?.kind === "number" && node.value < -120) yield new Uint8Array([32]);
      }
    }
    async function* entries(): AsyncGenerator<PdfOutputEntry> {
      try {
        while (true) {
          const command = pending ?? (await operators.next()).value; pending = undefined;
          if (!command) break;
          const { operator, operands } = command;
          if (operator === "BT") {
            if (inText && recorded) yield { name: String(part), chunks: [] };
            inText = true; continue;
          }
          if (boundary(command)) {
            if (operator === "ET") inText = false;
            else if (operator === "q" || operator === "BMC" || operator === "BDC") {
              await marks.push({ kind: "boolean", value: matching });
              if (operator !== "q") {
                const property = operands[1];
                const dict = property?.kind === "name" && properties?.kind === "dict" ? (await document.lookup(await readPdfDictionaryValue(properties, property.decoded, signal)))?.value : property;
                const number = dict?.kind === "dict" ? (await document.lookup(dictGet(dict, "MCID")))?.value : undefined;
                if (number?.kind === "number") matching = number.value === mcid;
              }
            } else if (operator === "Q" || operator === "EMC") {
              const previous = await marks.pop(); if (previous?.kind === "boolean") matching = previous.value;
            }
            part++; recorded = false; continue;
          }
          if (!inText || !matching) continue;
          recorded = true;
          async function* segment() {
            yield* fragments(command!);
            while (true) {
              const next = (await operators.next()).value; if (!next) return;
              if (boundary(next)) { pending = next; return; }
              yield* fragments(next);
            }
          }
          yield { name: String(part), chunks: segment() };
        }
      } finally { await operators.return(); }
    }
    outputs = await PdfStagedOutputs.create(storage, entries(), { chunkBytes, maxStagingBytes: maximum - source.size, ...(signal ? { signal } : {}) });
    async function* joined() {
      let first = true, turns = 0;
      async function checkpoint() {
        signal?.throwIfAborted();
        if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        signal?.throwIfAborted();
      }
      for await (const entry of outputs!.entries()) {
        await checkpoint();
        if (!entry.size) continue;
        if (!first) yield new Uint8Array([32]); first = false;
        for await (const bytes of entry.contents()) { await checkpoint(); yield bytes; }
      }
    }
    // Scan trim boundaries without retaining a potentially huge whitespace tail.
    let offset = 0, start: number | undefined, end = 0;
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    function scan(text: string) {
      for (const char of text) {
        const point = char.codePointAt(0)!; const bytes = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
        if (char.trim().length) { start ??= offset; end = offset + bytes; } offset += bytes;
      }
    }
    for await (const bytes of joined()) { signal?.throwIfAborted(); scan(decoder.decode(bytes, { stream: true })); }
    scan(decoder.decode());
    return { close, async *contents(): AsyncGenerator<Uint8Array, void, void> {
      signal?.throwIfAborted(); if (closed) throw new PdfError("E_CAPABILITY", "Retained structure text is closed");
      if (start === undefined) return;
      let at = 0;
      for await (const bytes of joined()) {
        signal?.throwIfAborted(); if (closed) throw new PdfError("E_CAPABILITY", "Retained structure text is closed");
        const low = Math.max(0, start - at), high = Math.min(bytes.length, end - at);
        if (high > low) yield bytes.slice(low, high); at += bytes.length; if (at >= end) break;
      }
    } };
  } catch (error) { try { await close(); } catch { /* Preserve the primary failure. */ } throw error; }
}

export async function* walkRetainedStructure(document: PdfRetainedDocument, storage: PdfIndexStorage, options: Options): AsyncGenerator<PdfRetainedStructureItem, void, void> {
  const chunkBytes = Math.max(32, options.chunkBytes ?? 4096), active = new Set<number>(); let work = 0;
  async function resolve(node: PdfCosNode | undefined) { return (await document.lookup(node))?.value; }
  async function* text(page: PdfCosDict, mcid: number, depth: number): AsyncGenerator<PdfRetainedStructureItem> {
    const owner = await markedText(document, page, mcid, storage, options); let failed = false;
    try { yield { kind: "text", depth, contents: owner.contents }; }
    catch (error) { failed = true; throw error; }
    finally { await owner.close().catch(error => { if (!failed) throw error; }); }
  }
  async function* walk(node: PdfCosNode | undefined, depth: number, recursion: number, roles?: PdfCosDict, inheritedPage?: PdfCosDict): AsyncGenerator<PdfRetainedStructureItem> {
    options.signal?.throwIfAborted();
    if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (recursion > options.maxDepth) throw new PdfError("E_LIMIT", "PDF structure depth limit exceeded");
    const found = await document.lookup(node); if (!found || found.stream) return;
    const ref = found.reference?.objectNumber;
    if (ref !== undefined) { if (active.has(ref)) return; active.add(ref); }
    try {
      const value = found.value;
      if (value.kind === "array") { for (const child of value.items) yield* walk(child, depth, recursion + 1, roles, inheritedPage); return; }
      if (value.kind !== "dict") return;
      const roleMap = roles ?? await resolve(dictGet(value, "RoleMap"));
      const mapping = roleMap?.kind === "dict" ? roleMap : cosDict({});
      const type = await resolve(dictGet(value, "Type")), pageValue = await resolve(dictGet(value, "Pg"));
      const page = pageValue?.kind === "dict" ? pageValue : inheritedPage;
      if (type?.kind === "name" && type.decoded === "MCR") {
        const mcid = await resolve(dictGet(value, "MCID"));
        if (options.includeText && page && mcid?.kind === "number") yield* text(page, mcid.value, depth);
        return;
      }
      const name = await resolve(dictGet(value, "S")), role = name?.kind === "name" ? name.decoded : "StructTreeRoot";
      const mapped = await resolve(dictGet(mapping, role));
      yield { kind: "element", depth, role, ...(mapped?.kind === "name" ? { mappedRole: mapped.decoded } : {}) };
      if (options.includeText) {
        const actual = await resolve(dictGet(value, "ActualText") ?? dictGet(value, "Alt"));
        if (actual?.kind === "string") {
          const value = decodePdfString(actual); let alive = true;
          try { yield { kind: "text", depth: depth + 1, async *contents() {
            if (!alive) throw new PdfError("E_CAPABILITY", "Retained structure text is closed");
            for await (const bytes of utf8(value, chunkBytes, options.signal)) { if (!alive) throw new PdfError("E_CAPABILITY", "Retained structure text is closed"); yield bytes; }
          } }; } finally { alive = false; }
        }
      }
      const kids = dictGet(value, "K");
      if (kids) {
        const resolved = await resolve(kids);
        if (resolved?.kind === "number") { if (options.includeText && page) yield* text(page, resolved.value, depth + 1); }
        else yield* walk(kids, depth + 1, recursion + 1, mapping, page);
      }
    } finally { if (ref !== undefined) active.delete(ref); }
  }
  const root = await resolve(document.crossReference.rootRef);
  if (root?.kind === "dict") yield* walk(dictGet(root, "StructTreeRoot"), 0, 0);
}
