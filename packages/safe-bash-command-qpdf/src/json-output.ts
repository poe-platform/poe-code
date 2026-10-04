import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfNameIndex, decodePdfString, type PdfCosNode, type PdfIndexStorage } from "@poe-code/pdf-ast";

type Sequence<T> = Iterable<T> | AsyncIterable<T>;
export type JsonValue = { kind: "formatted"; chunks: AsyncIterable<Uint8Array> } | null | boolean | number | string | { kind: "object"; entries: Sequence<readonly [string, JsonValue]> } | { kind: "array"; values: Sequence<JsonValue> } | { kind: "text"; parts: Sequence<string> };
export function jsonRecord(record: Readonly<Record<string, JsonValue>>): JsonValue { return { kind: "object", entries: Object.entries(record) }; }

export function cosJson(node: PdfCosNode | undefined, storage: PdfIndexStorage, signal: AbortSignal): JsonValue {
  if (!node) return null;
  switch (node.kind) {
    case "null": return null;
    case "boolean": case "number": return node.value;
    case "name": return `/${node.decoded}`;
    case "string": return `u:${decodePdfString(node)}`;
    case "ref": return `${node.objectNumber} ${node.generationNumber} R`;
    case "array": return { kind: "array", values: (function* () { for (const item of node.items) yield cosJson(item, storage, signal); })() };
    case "dict": return { kind: "object", entries: (async function* () {
      if (node.entries.length > 64) {
        const names = new PdfNameIndex(storage, Infinity, signal), backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), latest = new IntegerTable(backing);
        let failed = false;
        try {
          for (let index = 0; index < node.entries.length; index++) {
            signal.throwIfAborted(); const name = await names.intern(node.entries[index]!.key.decoded);
            await latest.set(BigInt(name.index), BigInt(index));
          }
          for await (const [, index] of latest.entries()) { const entry = node.entries[Number(index)]!; yield [`/${entry.key.decoded}`, cosJson(entry.value, storage, signal)] as const; }
        } catch (error) { failed = true; throw error; }
        finally { const results = await Promise.allSettled([names.close(), backing.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
        return;
      }
      // Repeated keys overwrite their values without changing first position.
      // The already admitted COS dictionary is the index; no second tree/map.
      for (let i = 0; i < node.entries.length; i++) {
        const entry = node.entries[i]!, key = entry.key.decoded;
        if (node.entries.findIndex(pair => pair.key.decoded === key) !== i) continue;
        let value = entry.value;
        for (let j = node.entries.length - 1; j > i; j--) if (node.entries[j]!.key.decoded === key) { value = node.entries[j]!.value; break; }
        yield [`/${key}`, cosJson(value, storage, signal)] as const;
      }
    })() };
    case "stream": return jsonRecord({ dict: cosJson(node.dict, storage, signal), length: node.rawBytes.length });
  }
}

/** JSON.stringify(..., null, 2) formatting without collecting aggregate values. */
export async function* jsonChunks(value: JsonValue, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  async function* string(parts: Sequence<string>): AsyncGenerator<string> {
    yield '"';
    for await (const part of parts) for (let at = 0; at < part.length;) {
      signal.throwIfAborted(); let end = Math.min(part.length, at + 4096);
      const last = part.charCodeAt(end - 1), next = part.charCodeAt(end);
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
      yield JSON.stringify(part.slice(at, end)).slice(1, -1); at = end;
    }
    yield '"';
  }
  async function* parts(node: JsonValue, depth = 0): AsyncGenerator<string> {
    signal.throwIfAborted();
    if (typeof node === "string") { yield* string([node]); return; }
    if (node === null || typeof node !== "object") { yield JSON.stringify(node); return; }
    if (node.kind === "text") { yield* string(node.parts); return; }
    if (node.kind === "formatted") {
      const decoder = new TextDecoder(), chunks = node.chunks; let newline = false;
      async function* text(): AsyncGenerator<string> { for await (const bytes of chunks) yield decoder.decode(bytes, { stream: true }); yield decoder.decode(); }
      for await (const part of text()) {
        signal.throwIfAborted(); let at = 0;
        while (at < part.length) {
          if (newline) { yield "\n"; yield "  ".repeat(depth); newline = false; }
          const end = part.indexOf("\n", at);
          if (end < 0) { yield part.slice(at); break; }
          yield part.slice(at, end); newline = true; at = end + 1;
        }
      }
      return;
    }
    const object = node.kind === "object"; yield object ? "{" : "[";
    let first = true;
    if (node.kind === "object") for await (const [key, child] of node.entries) {
      yield first ? "\n" : ",\n"; first = false; yield "  ".repeat(depth + 1); yield* string([key]); yield ": "; yield* parts(child, depth + 1);
    }
    else for await (const child of node.values) { yield first ? "\n" : ",\n"; first = false; yield "  ".repeat(depth + 1); yield* parts(child, depth + 1); }
    if (!first) { yield "\n"; yield "  ".repeat(depth); }
    yield object ? "}" : "]";
  }
  const encoder = new TextEncoder(); let buffer = new Uint8Array(16384), used = 0, work = 0;
  for await (const part of parts(value)) {
    if (++work % 256 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
    for (let at = 0; at < part.length;) {
      const result = encoder.encodeInto(part.slice(at), buffer.subarray(used)); used += result.written; at += result.read;
      if (buffer.length - used < 4) { yield buffer.subarray(0, used); buffer = new Uint8Array(16384); used = 0; }
    }
  }
  if (used === buffer.length) { yield buffer; buffer = new Uint8Array(16384); used = 0; }
  buffer[used++] = 10; yield buffer.subarray(0, used);
}

export async function* base64Parts(bytes: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  let pending = 0, count = 0, output = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for await (const chunk of bytes) for (const byte of chunk) {
    pending = (pending << 8) | byte;
    if (++count === 3) { output += alphabet[(pending >>> 18) & 63]! + alphabet[(pending >>> 12) & 63]! + alphabet[(pending >>> 6) & 63]! + alphabet[pending & 63]!; pending = 0; count = 0; }
    if (output.length >= 4096) { signal.throwIfAborted(); yield output; output = ""; }
  }
  if (count) { pending <<= (3 - count) * 8; output += alphabet[(pending >>> 18) & 63]! + alphabet[(pending >>> 12) & 63]! + (count === 2 ? alphabet[(pending >>> 6) & 63]! : "=") + "="; }
  if (output) yield output;
}
