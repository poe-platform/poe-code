import { type PdfCosNode } from "@poe-code/pdf-ast";

/** qpdf's human-readable object syntax with sorted dictionary keys. */
export function* displayNodeParts(node: PdfCosNode | undefined): Generator<string> {
  if (!node) { yield "null"; return; }
  switch (node.kind) {
    case "null": yield "null"; return;
    case "boolean": yield node.value ? "true" : "false"; return;
    case "number": yield String(node.value); return;
    case "name": yield "/"; yield node.decoded; return;
    case "string": {
      // qpdf uses literal syntax only for printable ASCII and named escapes.
      const hex = node.bytes.some(byte => (byte < 32 || byte > 126) && ![8, 9, 10, 12, 13].includes(byte));
      yield hex ? "<" : "(";
      let part = "";
      for (const byte of node.bytes) {
        if (hex) part += byte.toString(16).padStart(2, "0");
        else {
          switch (byte) {
            case 8: part += "\\b"; break;
            case 9: part += "\\t"; break;
            case 10: part += "\\n"; break;
            case 12: part += "\\f"; break;
            case 13: part += "\\r"; break;
            case 40: case 41: case 92: part += "\\" + String.fromCharCode(byte); break;
            default: part += String.fromCharCode(byte);
          }
        }
        if (part.length >= 4096) { yield part; part = ""; }
      }
      if (part) yield part;
      yield hex ? ">" : ")";
      return;
    }
    case "ref": yield `${node.objectNumber} ${node.generationNumber} R`; return;
    case "array":
      yield "[ ";
      for (let i = 0; i < node.items.length; i++) { if (i) yield " "; yield* displayNodeParts(node.items[i]); }
      yield " ]"; return;
    case "dict": {
      const entries = [...node.entries].sort((a, b) => a.key.decoded < b.key.decoded ? -1 : a.key.decoded > b.key.decoded ? 1 : 0);
      yield "<< ";
      for (let i = 0; i < entries.length; i++) { const entry = entries[i]!; if (i) yield " "; yield "/"; yield entry.key.decoded; yield " "; yield* displayNodeParts(entry.value); }
      yield " >>"; return;
    }
    case "stream":
      yield "Object is stream.  Dictionary:\n"; yield* displayNodeParts(node.dict); return;
  }
}

export function* encodeDisplayParts(parts: Iterable<string>, signal: AbortSignal): Generator<Uint8Array> {
  const encoder = new TextEncoder();
  let buffer = new Uint8Array(16384), used = 0;
  for (const part of parts) for (let offset = 0; offset < part.length;) {
    signal.throwIfAborted();
    let end = Math.min(part.length, offset + 4096);
    const last = part.charCodeAt(end - 1), next = part.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    const bytes = encoder.encode(part.slice(offset, end));
    if (bytes.length > buffer.length - used) { yield buffer.subarray(0, used); buffer = new Uint8Array(16384); used = 0; }
    buffer.set(bytes, used); used += bytes.length; offset = end;
  }
  if (used) yield buffer.subarray(0, used);
}
