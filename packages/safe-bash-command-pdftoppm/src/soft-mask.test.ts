import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument, decodePng, dictDelete, dictGet } from "@poe-code/pdf-ast";
import { runPdftoppmCli } from "./index.js";

it.each([true, false])("renders Alpha-mask backdrop outside its bounds (BC=%s)", async backdrop => {
  const bytes = new Uint8Array(readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-smask_alpha_bc.pdf", import.meta.url)));
  const doc = PdfDocument.load(bytes);
  if (!backdrop) {
    const state = doc.cos.getObject(4)!;
    if (state.kind !== "dict") throw new Error("Expected graphics state");
    const mask = dictGet(state, "SMask")!;
    if (mask.kind !== "dict") throw new Error("Expected soft mask");
    dictDelete(mask, "BC");
  }
  const files = new Map([["in.pdf", backdrop ? bytes : doc.save()]]);
  const result = await runPdftoppmCli(["-png", "-scale-to", "256", "-singlefile", "in.pdf", "out"], files);
  expect(result.exitCode).toBe(0);
  const bitmap = decodePng(files.get("out.png")!);
  const pixel = (x: number, y: number) => Array.from(bitmap.data.subarray((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4));
  // Poppler 26.08 reference pixels; allow the existing color rounding difference.
  const blue = [51, 153, 229, 255];
  for (const [actual, expected] of [[pixel(20, 20), backdrop ? blue : [242, 242, 242, 255]], [pixel(80, 100), blue]]) {
    expected!.forEach((value, i) => expect(Math.abs(actual![i]! - value)).toBeLessThanOrEqual(1));
  }
});
