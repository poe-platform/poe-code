import { expect, it } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runPdftocairoCli, runPdftocairoCliSync } from "./index.js";

for (const run of [runPdftocairoCli, runPdftocairoCliSync]) {
  for (const format of ["ps", "eps"]) {
    it(`${run.name} escapes backslashes and parentheses in ${format} strings`, async () => {
      const doc = PdfDocument.create();
      doc.addPage([100, 30]).drawText("a\\b(c)d", { x: 1, y: 10, size: 8 });
      const files = new Map([["in.pdf", doc.save()]]);
      const result = await run([`-${format}`, "in.pdf", `out.${format}`], files);
      expect(result.exitCode).toBe(0);
      expect(new TextDecoder().decode(files.get(`out.${format}`))).toContain("(a\\\\b\\(c\\)d) show");
    });
  }

  for (const format of ["png", "svg"]) {
    it(`${run.name} forwards allocation accounting for ${format} output`, async () => {
      const doc = PdfDocument.create();
      doc.addPage([8, 8]);
      const files = new Map([["in.pdf", doc.save()]]);
      const charges: number[] = [];
      const result = await run([`-${format}`, "-singlefile", "-r", "72", "in.pdf", "out"], files, {
        onAllocateBytes: bytes => charges.push(bytes),
      });
      expect(result.exitCode).toBe(0);
      expect(charges).toEqual(format === "png" ? [8 * 8 * 4, files.get("out.png")!.byteLength] : [files.get("out.svg")!.byteLength]);
    });
  }
}
