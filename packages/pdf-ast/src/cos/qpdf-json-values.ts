import { BackedJson, indexJsonObjects, readJsonNumber } from "@poe-code/json-ast";
import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { cosNumber, cosRef, cosString, type PdfCosRef } from "../ast.js";
import type { PdfIndexStorage } from "./object-index.js";
import { serializeCosNodeBytes } from "./writer.js";

/** A caller-backed view of QPDF JSON values. The caller owns the parsed tree;
 * this view owns only dictionary ordering/collision indexes. COS syntax streams
 * without resident arrays, dictionaries, strings, or depth-dependent stacks. */
export class QpdfJsonValues {
  private readonly scratch: PagedStorage;
  private readonly first: IntegerTable;
  private readonly next: IntegerTable;
  private closed = false;
  private work = 0;
  private constructor(private readonly tree: BackedJson, storage: PdfIndexStorage, private readonly signal: AbortSignal) {
    this.scratch = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
    this.first = new IntegerTable(this.scratch, 64); this.next = new IntegerTable(this.scratch, 64);
  }
  private async cooperate(units = 1): Promise<void> {
    this.signal.throwIfAborted(); if (this.closed) throw new Error("QPDF JSON view is closed");
    this.work += units;
    if (this.work >= 4096) { this.work = 0; await new Promise<void>(resolve => setTimeout(resolve, 0)); this.signal.throwIfAborted(); }
  }
  private async *text(position: number, skip = 0): AsyncGenerator<string> {
    for await (const text of this.tree.scalarChunks(position)) {
      await this.cooperate(text.length);
      const count = Math.min(skip, text.length); skip -= count;
      if (count < text.length) yield text.slice(count);
    }
  }
  private async prefix(position: number, length: number): Promise<string> {
    let prefix = "";
    for await (const text of this.text(position)) { prefix += text.slice(0, length - prefix.length); if (prefix.length === length) break; }
    return prefix;
  }
  private async nameSkip(position: number): Promise<number> {
    const prefix = await this.prefix(position, 3); return prefix.startsWith("n:/") ? 3 : prefix.startsWith("/") ? 1 : 0;
  }
  private async *name(position: number): AsyncGenerator<string> { yield* this.text(position, await this.nameSkip(position)); }
  private async sameName(left: number, right: number): Promise<boolean> {
    const a = this.name(left), b = this.name(right); let x = "", y = "", aDone = false, bDone = false;
    try {
      for (;;) {
        if (!x && !aDone) { const next = await a.next(); aDone = !!next.done; x = next.value ?? ""; }
        if (!y && !bDone) { const next = await b.next(); bDone = !!next.done; y = next.value ?? ""; }
        if (aDone || bDone) return aDone && bDone;
        const length = Math.min(x.length, y.length);
        if (x.slice(0, length) !== y.slice(0, length)) return false;
        x = x.slice(length); y = y.slice(length);
      }
    } finally { await a.return(undefined); await b.return(undefined); }
  }
  static async open(tree: BackedJson, storage: PdfIndexStorage, options: { signal?: AbortSignal } = {}): Promise<QpdfJsonValues> {
    const view = new QpdfJsonValues(tree, storage, options.signal ?? new AbortController().signal);
    try { await view.index(); return view; } catch (error) { try { await view.close(); } catch { /* Preserve the original error. */ } throw error; }
  }
  private async index(): Promise<void> {
    const order = await indexJsonObjects(this.tree, this.scratch, units => this.cooperate(units));
    const pointer = async (at: number) => { const bytes = await this.scratch.read(at, 8); return new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getFloat64(0, true); };
    const put = async (at: number, value: number) => { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); await this.scratch.write(at, bytes); };
    const end = (await this.tree.describe(this.tree.rootPosition)).end;
    for (let position = this.tree.rootPosition; position < end;) {
      await this.cooperate(); const header = await this.tree.describe(position);
      if (header.kind === "object") {
        const hashes = new IntegerTable(this.scratch, 64); let head = 0, tail = 0;
        for await (const { key } of order.entries(position)) {
          let hash = 0;
          for await (const text of this.name(key)) for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
          const collision = Number(await hashes.get(BigInt(hash)) ?? 0n); let existing = 0;
          for (let record = collision; record; record = await pointer(record + 16)) {
            await this.cooperate(); if (await this.sameName(await pointer(record), key)) { existing = record; break; }
          }
          if (existing) await put(existing, key);
          else {
            const record = this.scratch.allocate(24); await put(record, key); await put(record + 16, collision);
            if (tail) await put(tail + 8, record); else head = record;
            tail = record; await hashes.set(BigInt(hash), BigInt(record));
          }
        }
        let previous = 0;
        for (let record = head; record; record = await pointer(record + 8)) {
          await this.cooperate(); const key = await pointer(record);
          if (previous) await this.next.set(BigInt(previous), BigInt(key)); else await this.first.set(BigInt(position), BigInt(key));
          previous = (await this.tree.describe(key)).end;
        }
        if (previous) await this.next.set(BigInt(previous), 0n);
      }
      position = header.kind === "array" || header.kind === "object" ? position + 32 : header.end;
    }
  }
  /** Match the legacy reference grammar without collecting long zero padding. */
  async reference(position: number): Promise<PdfCosRef | undefined> {
    if (!["string", "key"].includes((await this.tree.describe(position)).kind)) return undefined;
    const skip = (await this.prefix(position, 4)) === "obj:" ? 4 : 0;
    let token = 0, leading = true, trailing = false, digits = false, object = 0, generation = 0, suffix = "";
    for await (const text of this.text(position, skip)) for (const char of text) {
      const whitespace = char.trim() === "";
      if (leading && whitespace) continue;
      leading = false;
      if (trailing) { if (!whitespace) return undefined; continue; }
      if (token < 2) {
        if (char >= "0" && char <= "9") {
          digits = true;
          if (token === 0) { object = object * 10 + Number(char); if (object > 2147483647) return undefined; }
          else { generation = generation * 10 + Number(char); if (generation > 65535) return undefined; }
        } else if (char === " ") { if (digits) { token++; digits = false; } }
        else return undefined;
      } else if (!suffix && char === " ") continue;
      else if (whitespace) { if (!suffix) return undefined; trailing = true; }
      else { suffix += char; if (suffix !== "R" && !"obj".startsWith(suffix)) return undefined; }
    }
    return token === 2 && object > 0 && (suffix === "R" || suffix === "obj") ? cosRef(object, generation) : undefined;
  }
  private async *scalar(position: number, key = false): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder(), header = await this.tree.describe(position);
    if (header.kind === "literal") {
      const token = await this.tree.smallText(position, 5);
      yield token === "null" || token === "true" || token === "false" ? encoder.encode(token) : serializeCosNodeBytes(cosNumber(await readJsonNumber(this.text(position), units => this.cooperate(units), false))); return;
    }
    const prefix = await this.prefix(position, 3);
    const isName = key || prefix.startsWith("n:") || prefix.startsWith("/");
    const skip = key ? await this.nameSkip(position) : prefix.startsWith("n:/") ? 3 : prefix.startsWith("n:") || prefix.startsWith("u:") || prefix.startsWith("b:") ? 2 : prefix.startsWith("/") ? 1 : 0;
    if (isName) {
      yield encoder.encode("/");
      for await (const text of this.text(position, skip)) {
        let part = "";
        for (let i = 0; i < text.length; i++) {
          const code = text.charCodeAt(i); part += code <= 32 || code > 126 || "#()<>[]{}/%".includes(text[i]!) ? `#${code.toString(16).padStart(2, "0").toUpperCase()}` : text[i];
          if (part.length >= 4096) { yield encoder.encode(part); part = ""; }
        }
        if (part) yield encoder.encode(part);
      }
      return;
    }
    if (prefix.startsWith("b:")) {
      let offset = 0, first = -1, end = 0;
      for await (const text of this.text(position, 2)) for (const char of text) { if (char.trim() !== "") { if (first < 0) first = offset; end = offset + char.length; } offset += char.length; }
      yield encoder.encode("<"); offset = 0; let pair = "", output = "";
      for await (const text of this.text(position, 2)) for (let i = 0; i < text.length; i++, offset++) {
        if (offset < first || offset >= end) continue;
        pair += text[i]; if (pair.length === 2) { const value = Number.parseInt(pair, 16); output += ((Number.isNaN(value) ? 0 : value) & 255).toString(16).padStart(2, "0").toUpperCase(); pair = ""; }
        if (output.length >= 4096) { yield encoder.encode(output); output = ""; }
      }
      if (output) yield encoder.encode(output); yield encoder.encode(">"); return;
    }
    if (!prefix.startsWith("u:")) { const reference = await this.reference(position); if (reference) { yield serializeCosNodeBytes(reference); return; } }
    let utf16 = false;
    for await (const text of this.text(position, skip)) if (cosString(text).format === "hex") { utf16 = true; break; }
    yield encoder.encode(utf16 ? "<FEFF" : "(");
    for await (const text of this.text(position, skip)) {
      if (utf16) {
        for (let start = 0; start < text.length; start += 1024) {
          let hex = ""; for (let i = start; i < Math.min(text.length, start + 1024); i++) hex += text.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
          yield encoder.encode(hex);
        }
      } else { const bytes = serializeCosNodeBytes(cosString(text)); yield bytes.subarray(1, bytes.length - 1); }
    }
    yield encoder.encode(utf16 ? ">" : ")");
  }
  async *chunks(root: number): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder(); let position = root, closing = false;
    while (position) {
      await this.cooperate(); const header = await this.tree.describe(position);
      if (!closing) {
        if (header.kind === "array" || header.kind === "object") {
          yield encoder.encode(header.kind === "array" ? "[ " : "<<\n");
          const child = header.kind === "object" ? Number(await this.first.get(BigInt(position)) ?? 0n) : header.children ? position + 32 : 0;
          if (child) { position = child; continue; }
          yield encoder.encode(header.kind === "array" ? "]" : ">>");
        } else yield* this.scalar(position, header.kind === "key");
      }
      if (position === root) break;
      const parent = await this.tree.describe(header.parent);
      yield encoder.encode(parent.kind === "array" || header.kind === "key" ? " " : "\n");
      const next = parent.kind === "object" && header.kind !== "key" ? Number(await this.next.get(BigInt(position)) ?? 0n) : header.end < parent.end ? header.end : 0;
      if (next) { position = next; closing = false; }
      else { yield encoder.encode(parent.kind === "array" ? "]" : ">>"); position = header.parent; closing = true; }
    }
  }
  async close(): Promise<void> { this.closed = true; await this.scratch.close(); }
}
