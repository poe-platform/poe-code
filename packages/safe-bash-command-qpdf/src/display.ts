import { decodePdfString, type PdfCosNode } from "@poe-code/pdf-ast";

/** qpdf's human-readable object syntax, emitted without collecting containers. */
export function* displayNodeParts(node: PdfCosNode | undefined): Generator<string> {
  if (!node) { yield "null"; return; }
  switch (node.kind) {
    case "null": yield "null"; return;
    case "boolean": yield node.value ? "true" : "false"; return;
    case "number": yield String(node.value); return;
    case "name": yield "/"; yield node.decoded; return;
    case "string": yield "("; yield decodePdfString(node); yield ")"; return;
    case "ref": yield `${node.objectNumber} ${node.generationNumber} R`; return;
    case "array":
      yield "[ ";
      for (let i = 0; i < node.items.length; i++) { if (i) yield " "; yield* displayNodeParts(node.items[i]); }
      yield " ]"; return;
    case "dict":
      yield "<< ";
      for (let i = 0; i < node.entries.length; i++) { const entry = node.entries[i]!; if (i) yield " "; yield "/"; yield entry.key.decoded; yield " "; yield* displayNodeParts(entry.value); }
      yield " >>"; return;
    case "stream":
      yield* displayNodeParts(node.dict); yield `\nstream\n...(${node.rawBytes.byteLength} bytes)...\nendstream`; return;
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
