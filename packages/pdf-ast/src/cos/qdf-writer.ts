import { cosDict, cosName, cosNumber, cosRef, dictGet, type PdfCosNode } from "../ast.js";
import { PdfError } from "../errors.js";
import type { LinearizationObject } from "./linearized-writer.js";
import { serializeCosNodeChunks, type SerializeCosStreamOptions } from "./writer.js";

type Work<T> = Generator<Uint8Array | { object: number } | { stream: number } | void, T, LinearizationObject>;

/** QDF requires consecutive objects and a separate length immediately after each
 * stream so fix-qdf can repair lengths and offsets after a text edit. */
export function* qdfOutput(ids: readonly number[], options: Omit<SerializeCosStreamOptions, "objects">): Work<void> {
  const numbers = new Map<number, number>(), comments = new Map<number, string>();
  const read = function* (id: number): Work<LinearizationObject> { return yield { object: id }; };
  let next = 1;
  for (const id of ids) {
    const object = yield* read(id);
    if (object.value.kind === "dict") {
      const type = dictGet(object.value, "Type");
      if (dictGet(object.value, "Linearized") || (object.streamLength !== undefined && type?.kind === "name" && ["XRef", "ObjStm", "Hint"].includes(type.decoded))) continue;
    }
    numbers.set(id, next++);
    if (object.streamLength !== undefined) next++;
  }
  if (next - 1 > (options.maxObjects ?? Infinity)) throw new PdfError("E_LIMIT", "PDF object limit exceeded");
  const seen = new Set<number>();
  let page = 0;
  function* visit(node: PdfCosNode | undefined, content = false, depth = 0): Work<void> {
    if (depth > (options.maxRecursionDepth ?? Infinity)) throw new PdfError("E_LIMIT", "PDF object graph nesting depth exceeded");
    const id = node?.kind === "ref" ? node.objectNumber : undefined;
    if (id !== undefined) {
      if (seen.has(id)) return;
      seen.add(id);
      const object = yield* read(id);
      if (content && object.streamLength !== undefined) { comments.set(id, `%% Contents for page ${page}\n`); return; }
      node = object.value;
    }
    if (node?.kind === "array") for (const item of node.items) yield* visit(item, content, depth + 1);
    else if (node?.kind === "dict") {
      const type = dictGet(node, "Type");
      if (type?.kind === "name" && type.decoded === "Page") {
        page++;
        if (id !== undefined) comments.set(id, `%% Page ${page}\n`);
        yield* visit(dictGet(node, "Contents"), true, depth + 1);
      } else yield* visit(dictGet(node, "Kids"), false, depth + 1);
    }
  }
  const root = (yield* read(options.rootRef.objectNumber)).value;
  if (root.kind === "dict") yield* visit(dictGet(root, "Pages"));
  function remap(node: PdfCosNode, depth = 0): PdfCosNode {
    if (depth > (options.maxRecursionDepth ?? Infinity)) throw new PdfError("E_LIMIT", "PDF object graph nesting depth exceeded");
    if (node.kind === "ref") return numbers.has(node.objectNumber) ? cosRef(numbers.get(node.objectNumber)!) : { kind: "null" };
    if (node.kind === "array") return { ...node, items: node.items.map(item => remap(item, depth + 1)) };
    if (node.kind === "dict") return { ...node, entries: node.entries.map(entry => ({ ...entry, value: remap(entry.value, depth + 1) })) };
    return node;
  }
  const encoder = new TextEncoder(), offsets: number[] = [0];
  let offset = 0;
  function account(length: number) {
    if (length > (options.maxOutputBytes ?? Infinity) - offset) throw new PdfError("E_LIMIT", "PDF output byte limit exceeded");
    offset += length;
  }
  function* text(value: string): Work<void> {
    const bytes = encoder.encode(value); account(bytes.length);
    const size = options.chunkBytes ?? 65536;
    for (let start = 0; start < bytes.length; start += size) yield bytes.slice(start, start + size);
  }
  function* node(value: PdfCosNode, depth = 0): Work<void> {
    if (depth > (options.maxRecursionDepth ?? Infinity)) throw new PdfError("E_LIMIT", "PDF object graph nesting depth exceeded");
    if (value.kind === "dict") {
      yield* text("<<\n");
      for (const entry of value.entries) {
        yield* text("  ".repeat(depth + 1));
        yield* node(entry.key, depth + 1);
        yield* text(" ");
        yield* node(entry.value, depth + 1);
        yield* text("\n");
      }
      yield* text("  ".repeat(depth) + ">>");
      return;
    }
    if (value.kind === "array") {
      yield* text("[\n");
      for (const item of value.items) {
        yield* text("  ".repeat(depth + 1));
        yield* node(item, depth + 1);
        yield* text("\n");
      }
      yield* text("  ".repeat(depth) + "]");
      return;
    }
    for (const bytes of serializeCosNodeChunks(value, { chunkBytes: options.chunkBytes ?? 65536, maxOutputBytes: (options.maxOutputBytes ?? Infinity) - offset, maxRecursionDepth: options.maxRecursionDepth ?? Infinity })) {
      account(bytes.length); yield bytes;
    }
  }
  yield* text(`%PDF-${options.version ?? "1.7"}\n%\x81\x81\x81\x81\n%QDF-1.0\n\n`);
  for (const [id, number] of numbers) {
    const object = yield* read(id);
    yield* text(`${comments.get(id) ?? ""}%% Original object ID: ${id} ${object.generationNumber ?? 0}\n`);
    offsets[number] = offset;
    yield* text(`${number} 0 obj\n`);
    let value = remap(object.value);
    if (object.streamLength !== undefined && value.kind === "dict") {
      value = { ...value, entries: [...value.entries.filter(entry => entry.key.decoded !== "Length"), { key: cosName("Length"), value: cosRef(number + 1) }] };
      yield* node(value);
      yield* text("\nstream\n");
      account(object.streamLength);
      yield { stream: id };
      yield* text("\nendstream\nendobj\n\n%QDF: ignore_newline\n");
      offsets[number + 1] = offset;
      yield* text(`${number + 1} 0 obj\n${object.streamLength}\nendobj\n\n`);
    } else {
      yield* node(value);
      yield* text("\nendobj\n\n");
    }
  }
  const xref = offset;
  yield* text(`xref\n0 ${next}\n0000000000 65535 f \n`);
  for (let i = 1; i < next; i++) yield* text(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  yield* text("trailer ");
  yield* node(cosDict({ Size: cosNumber(next), Root: remap(options.rootRef), Info: options.infoRef ? remap(options.infoRef) : undefined, ID: options.idArray }));
  yield* text(`\nstartxref\n${xref}\n%%EOF\n`);
}
