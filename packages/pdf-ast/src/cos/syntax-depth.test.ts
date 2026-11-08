import { expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosRef, dictGet, parseCosDocument, serializeCosDocument, type PdfCosNode } from "../index.js";

function nestedDocument(depth: number, objectStreams: "disable" | "generate" = "disable"): Uint8Array {
  let node: PdfCosNode = cosNumber(42);
  for (let i = 0; i < depth; i++) node = cosArray([node]);
  return serializeCosDocument({ objects: [
    { objectNumber: 1, generationNumber: 0, value: cosDict({Type: cosName("Catalog")}) },
    { objectNumber: 2, generationNumber: 0, value: node },
  ], rootRef: cosRef(1), objectStreams });
}

it.each(["disable", "generate"] as const)("enforces requested nesting depth in %s object streams", objectStreams => {
  const bytes = nestedDocument(8, objectStreams);
  expect(() => parseCosDocument(bytes, {maxRecursionDepth: 7})).toThrow(/nesting.*limit/);
  expect(parseCosDocument(bytes, {maxRecursionDepth: 8}).resolve(cosRef(2))).toBeDefined();
});

it.each(["disable", "generate"] as const)("retains syntax limits during repair with %s object streams", objectStreams => {
  const bytes = nestedDocument(8, objectStreams);
  const marker = new TextEncoder().encode("startxref");
  const end = bytes.findIndex((_, index) => marker.every((byte, offset) => bytes[index + offset] === byte));
  const damaged = bytes.subarray(0, end);
  expect(() => parseCosDocument(damaged, {recovery: "repair", maxRecursionDepth: 7})).toThrow(/nesting.*limit/);
});

it.each(["array", "dict"])("parses deep %s nesting without recursive stack consumption", kind => {
  const depth = 30000;
  const payload = kind === "array" ? "[".repeat(depth) + "42" + "]".repeat(depth) : "<< /V ".repeat(depth) + "42" + " >>".repeat(depth);
  let text = "%PDF-1.7\n";
  const first = text.length; text += "1 0 obj\n<< /Type /Catalog >>\nendobj\n";
  const second = text.length; text += `2 0 obj\n${payload}\nendobj\n`;
  const xref = text.length;
  text += `xref\n0 3\n0000000000 65535 f \n${String(first).padStart(10, "0")} 00000 n \n${String(second).padStart(10, "0")} 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const doc = parseCosDocument(new TextEncoder().encode(text));
  let node = doc.resolve(cosRef(2));
  for (let i = 0; i < depth; i++) {
    if (node?.kind === "array") node = node.items[0];
    else if (node?.kind === "dict") node = dictGet(node, "V");
    else throw new Error("Missing nested container");
  }
  expect(node).toMatchObject({kind: "number", value: 42});
});
