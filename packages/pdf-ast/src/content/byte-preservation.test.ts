import { expect, it } from "vitest";
import { PdfDocument, cosDict, cosName, cosNumber, cosString, parseContentStream, serializeContentAst, type PdfContentNode } from "../index.js";

it("preserves every byte of PDF literal strings through content serialization", () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const nodes: PdfContentNode[] = [{ kind: "text-object", commands: [{ kind: "show-text", token: cosString(bytes) }] }];
  const parsed = parseContentStream(serializeContentAst(nodes));
  expect(parsed).toHaveLength(1);
  const text = parsed[0]!;
  expect(text.kind).toBe("text-object");
  if (text.kind !== "text-object") throw new Error("Missing text object");
  const command = text.commands[0]!;
  expect(command.kind).toBe("show-text");
  if (command.kind !== "show-text") throw new Error("Missing text operand");
  expect(command.token.bytes).toEqual(bytes);
});

it("preserves inline-image bytes including the Windows-1252 range", () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const nodes: PdfContentNode[] = [{ kind: "inline-image", dict: cosDict({ W: cosNumber(256), H: cosNumber(1), BPC: cosNumber(8), CS: cosName("G") }), data: bytes }];
  const image = parseContentStream(serializeContentAst(nodes))[0]!;
  expect(image.kind).toBe("inline-image");
  if (image.kind !== "inline-image") throw new Error("Missing image");
  expect(image.data).toEqual(bytes);
});

it("round-trips WinAnsi punctuation and accented text through drawing and saving", () => {
  const doc = PdfDocument.create(); const page = doc.addPage([400, 100]);
  const text = "• Item € — ‘quoted’ “double” é";
  page.drawText(text, { x: 10, y: 40, size: 12, font: "Helvetica" });
  expect(PdfDocument.load(doc.save()).extractText()).toContain(text);
});
