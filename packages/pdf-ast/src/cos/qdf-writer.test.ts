import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosStream, dictGet } from "../ast.js";
import { parseCosDocument } from "./parser.js";
import { serializeCosDocument } from "./writer.js";

const encoder = new TextEncoder();
function options(bytes: Uint8Array) {
  return {
    qdf: true,
    rootRef: cosRef(10, 2),
    objects: [
      { objectNumber: 10, generationNumber: 2, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(20) }) },
      { objectNumber: 20, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(1), Kids: cosArray([cosRef(30)]) }) },
      { objectNumber: 30, generationNumber: 0, value: cosDict({ Type: cosName("Page"), Parent: cosRef(20), Contents: cosRef(40) }) },
      { objectNumber: 40, generationNumber: 0, value: cosStream(bytes) },
    ],
  };
}

describe("QDF output", () => {
  it.each(["", "q Q", "q Q\n", "q Q\r\n"])("preserves stream bytes and indirect lengths for %j", content => {
    const bytes = encoder.encode(content), input = options(bytes);
    const output = serializeCosDocument(input), text = new TextDecoder().decode(output);
    expect(text).toContain("%QDF-1.0\n");
    expect(text).toContain("%% Original object ID: 10 2\n1 0 obj");
    expect(text).toContain("%% Page 1\n");
    expect(text).toContain("%% Contents for page 1\n");
    expect(text).toContain("  /Length 5 0 R\n");
    expect(text).toContain(`\nstream\n${content}\nendstream\nendobj\n\n%QDF: ignore_newline\n5 0 obj\n${bytes.length}\nendobj`);
    expect(text).toContain("trailer <<\n");
    const parsed = parseCosDocument(output);
    expect(parsed.rootRef).toMatchObject({ objectNumber: 1, generationNumber: 0 });
    const stream = parsed.objects.get(4)!.value;
    expect(stream.kind).toBe("stream");
    if (stream.kind !== "stream") throw new Error("Missing stream");
    expect(stream.rawBytes).toEqual(bytes);
    expect(dictGet(stream.dict, "Length")).toMatchObject({ kind: "ref", objectNumber: 5, generationNumber: 0 });
    expect(parsed.objects.get(5)!.value).toMatchObject({ kind: "number", value: bytes.length });
    expect(input.objects[0]!.objectNumber).toBe(10);
  });

  it("accounts for generated objects and output bytes", () => {
    const input = options(encoder.encode("q Q"));
    const output = serializeCosDocument(input);
    expect(serializeCosDocument({ ...input, maxOutputBytes: output.length })).toEqual(output);
    expect(() => serializeCosDocument({ ...input, maxOutputBytes: output.length - 1 })).toThrow("byte limit");
    const compact = { ...input, objects: input.objects.map((object, i) => ({ ...object, objectNumber: i + 1 })) };
    expect(() => serializeCosDocument({ ...compact, maxObjects: 4 })).toThrow("object limit");
  });
});
