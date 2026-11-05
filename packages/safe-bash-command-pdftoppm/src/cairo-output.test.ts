import { expect, it } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runPdftocairoCli, runPdftocairoCliSync } from "./index.js";

for (const run of [runPdftocairoCli, runPdftocairoCliSync]) {
  it.each([
    { flags: ["-paper", "A4"], sizes: [[842, 595], [595, 842], [595, 842]] },
    { flags: ["-paperw", "900", "-paperh", "500"], sizes: [[500, 900], [900, 500], [900, 500]] },
    { flags: ["-paper", "A4", "-origpagesizes"], sizes: [[216, 144], [144, 216], [144, 144]] },
  ])(`${run.name} orients PDF paper per source page: $flags`, async ({ flags, sizes }) => {
    const doc = PdfDocument.create();
    doc.addPage([216, 144]);
    doc.addPage([144, 216]);
    doc.addPage([144, 144]);
    const result = await run(["-pdf", ...flags, "in.pdf", "-"], new Map([["in.pdf", doc.save()]]));
    expect(result.exitCode).toBe(0);
    const output = PdfDocument.load(result.stdoutBytes!);
    expect(sizes.map((_, index) => output.getPage(index).getSize())).toEqual(
      sizes.map(([width, height]) => ({ width, height })),
    );
  });

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
