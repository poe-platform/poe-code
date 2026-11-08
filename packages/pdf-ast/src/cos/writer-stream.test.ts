import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosStream, cosString, type PdfCosNode } from "../ast.js";
import { concatByteArrays, serializeCosNodeBytes, serializeCosNodeChunks } from "./writer.js";

const text = new TextEncoder();

describe("streamed COS serialization", () => {
  it.each([1, 7, 64, 65536])("preserves exact COS bytes with %i-byte chunks", chunkBytes => {
    const nodes: PdfCosNode[] = [
      { kind: "null" }, { kind: "boolean", value: true }, cosNumber(1e-7), cosRef(19, 2),
      cosName("name /#\u00e9\ud83d\ude00"), cosString("a(b)\\c\n\r\t"),
      { kind: "string", format: "hex", bytes: Uint8Array.from({ length: 256 }, (_, i) => i) },
      cosArray([cosNumber(4), cosDict({ Nested: cosString("text") })]),
      cosStream(new Uint8Array([0, 10, 128, 255]), { dict: cosDict({ Length: cosNumber(999) }), compress: false }),
    ];
    // These are literal golden bytes, independent of the buffered adapter.
    const golden = ["null", "true", "0", "19 2 R", "/name#20#2F#23#E9#D83D#DE00", "(a\\(b\\)\\\\c\\n\\r\\t)",
      `<${Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join("")}>`,
      "[ 4 <<\n/Nested (text)\n>> ]",
    ];
    for (const [index, node] of nodes.entries()) {
      const chunks = [...serializeCosNodeChunks(node, { chunkBytes })];
      expect(chunks.every(chunk => chunk.byteLength > 0 && chunk.byteLength <= chunkBytes)).toBe(true);
      const bytes = concatByteArrays(chunks);
      expect(bytes).toEqual(serializeCosNodeBytes(node));
      if (index < golden.length) expect(bytes).toEqual(text.encode(golden[index]!));
      else expect(bytes).toEqual(concatByteArrays([text.encode("<<\n/Length 4\n>>\nstream\n"), new Uint8Array([0, 10, 128, 255]), text.encode("\nendstream")]));
    }
  });

  it("preserves literal string bytes outside ASCII without UTF-8 conversion", () => {
    const node: PdfCosNode = { kind: "string", format: "literal", bytes: new Uint8Array([0, 127, 128, 255]) };
    expect(concatByteArrays([...serializeCosNodeChunks(node, { chunkBytes: 1 })]))
      .toEqual(new Uint8Array([40, 0, 127, 128, 255, 41]));
  });

  it("does not allocate or copy the whole stream and gives the sink owned chunks", () => {
    const payload = new Uint8Array(1024 * 1024).fill(123);
    const node = cosStream(payload, { compress: false });
    const chunks = serializeCosNodeChunks(node, { chunkBytes: 4096 });
    const first = chunks.next().value!;
    const saved = first.slice();
    let count = first.length;
    for (const chunk of chunks) {
      expect(chunk.buffer.byteLength).toBeLessThanOrEqual(4096);
      expect(chunk.buffer).not.toBe(payload.buffer);
      count += chunk.length;
      chunk.fill(0);
    }
    expect(count).toBeGreaterThan(payload.length);
    expect(first).toEqual(saved);
    expect(payload.every(byte => byte === 123)).toBe(true);
  });

  it("stops on cancellation between output chunks, including within a string", () => {
    const controller = new AbortController();
    const failure = new Error("stop serialization");
    const chunks = serializeCosNodeChunks(cosString("x".repeat(1000)), { chunkBytes: 8, signal: controller.signal });
    expect(chunks.next().value).toHaveLength(8);
    controller.abort(failure);
    expect(() => chunks.next()).toThrow(failure);
  });

  it("checks output and depth limits without exposing an oversized chunk", () => {
    const node = cosArray([cosDict({ Value: cosNumber(3) })]);
    const expected = serializeCosNodeBytes(node);
    expect(concatByteArrays([...serializeCosNodeChunks(node, { maxOutputBytes: expected.length })])).toEqual(expected);
    expect(() => [...serializeCosNodeChunks(node, { maxOutputBytes: expected.length - 1 })]).toThrow("output byte limit");
    expect(() => [...serializeCosNodeChunks(node, { maxRecursionDepth: 1 })]).toThrow("nesting depth");
    for (const chunkBytes of [0, -1, 1.5, Infinity, NaN]) {
      expect(() => [...serializeCosNodeChunks(node, { chunkBytes })]).toThrow(RangeError);
    }
  });

  it("does not inspect later objects before a slow consumer requests more output", async () => {
    let visited = false;
    const delayed = { kind: "number", get value() { visited = true; return 2; }, raw: "2", isInteger: true } as const;
    const chunks = serializeCosNodeChunks(cosArray([cosString("x".repeat(256)), delayed]), { chunkBytes: 8 });
    chunks.next();
    await Promise.resolve();
    expect(visited).toBe(false);
    chunks.return();
    expect(visited).toBe(false);
  });
});
