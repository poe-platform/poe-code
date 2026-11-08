import type {EmbeddingJsonDocument, EmbeddingJsonNode} from "./import-json-document.js";
import {floatText} from "./embed-output.js";
import {yieldTurn} from "safe-bash-contracts/yield";

/** Python json.dumps(indent=2) over the caller-backed parsed document. */
export async function* prettyJsonDocument(document: EmbeddingJsonDocument, signal: AbortSignal): AsyncIterable<Uint8Array> {
  const escape = (point: number): string => {
    if (point < 127) return JSON.stringify(String.fromCodePoint(point)).slice(1, -1);
    if (point <= 65535) return "\\u" + point.toString(16).padStart(4, "0");
    const value = point - 65536;
    return "\\u" + (0xd800 + (value >>> 10)).toString(16) + "\\u" + (0xdc00 + (value & 1023)).toString(16);
  };
  async function* node(value: EmbeddingJsonNode, depth: number): AsyncIterable<string> {
    signal.throwIfAborted();
    if (value.type === "string") {
      yield '"';
      for await (const points of document.points(value)) for (const point of points) yield escape(point);
      yield '"'; return;
    }
    if (value.type === "null") {yield "null"; return;}
    if (value.type === "boolean") {yield value.token; return;}
    if (value.type === "number") {
      const token = value.token;
      if (token === "NaN" || token.endsWith("Infinity")) yield token;
      else if (!token.includes(".") && !token.includes("e") && !token.includes("E")) yield BigInt(token).toString();
      else {
        const number = Number(token);
        yield Number.isFinite(number) ? floatText(number) : number < 0 ? "-Infinity" : "Infinity";
      }
      return;
    }
    const object = value.type === "object";
    yield object ? "{" : "[";
    let child = await document.child(value.id), count = 0;
    while (child) {
      yield (count++ ? ",\n" : "\n") + "  ".repeat(depth + 1);
      if (object) {
        yield '"';
        for (const point of child.keyPoints ?? Array.from(String(child.key), char => char.codePointAt(0)!)) yield escape(point);
        yield '": ';
      }
      yield* node(child.node, depth + 1);
      child = await document.child(value.id, child.position);
    }
    if (count) yield "\n" + "  ".repeat(depth);
    yield object ? "}" : "]";
  }
  const encoder = new TextEncoder(); let chunk = "", steps = 0;
  for await (const part of node(document.root, 0)) {
    if (++steps % 256 === 0) await yieldTurn(signal);
    chunk += part;
    while (chunk.length >= 4096) {yield encoder.encode(chunk.slice(0, 4096)); chunk = chunk.slice(4096);}
  }
  if (chunk) yield encoder.encode(chunk);
}
