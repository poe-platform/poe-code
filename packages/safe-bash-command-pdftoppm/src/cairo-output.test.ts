import { expect, it } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runPdftocairoCli, runPdftocairoCliSync } from "./index.js";

for (const run of [runPdftocairoCli, runPdftocairoCliSync]) {
  it.each([
    ["-paperw", "300"],
    ["-paperh", "400"],
    ["-paper", "A4", "-paperw", "300"],
    ["-paperh", "400", "-paper", "A4"],
    ["-q", "-paperw", "300"],
  ])(`${run.name} rejects an unpaired custom paper dimension %j`, async (...flags) => {
    const doc = PdfDocument.create();
    doc.addPage([144, 216]);
    for (const existingOutput of [false, true]) {
      const files = new Map([["in.pdf", doc.save()]]);
      if (existingOutput) files.set("out.pdf", new Uint8Array([1, 2, 3]));
      const before = new Map(files);
      expect(await run(["-pdf", ...flags, "in.pdf", "out.pdf"], files)).toEqual({
        exitCode: 99,
        stdout: "",
        stderr: "Error: both -paperw and -paperh must be specified.\n",
      });
      expect(files).toEqual(before);
    }
  });

  it.each(["A3", "A4", "letter", "legal", "match"])(`${run.name} accepts native paper spelling %s`, async paper => {
    const doc = PdfDocument.create();
    doc.addPage([144, 216]);
    const files = new Map([["in.pdf", doc.save()]]);
    const result = await run(["-pdf", "-paper", paper, "in.pdf", "out.pdf"], files);
    expect(result.exitCode).toBe(0);
    expect(files.has("out.pdf")).toBe(true);
  });

  it.each(["a3", "a4", "A5", "a5", "Letter", "Legal", "Match", "unknown"])(`${run.name} rejects invalid paper spelling %s without publishing output`, async paper => {
    const doc = PdfDocument.create();
    doc.addPage([144, 216]);
    const files = new Map([["in.pdf", doc.save()]]);
    const args = ["-pdf", "-paper", paper, "in.pdf", "out.pdf"];
    const result = await run(args, files);
    expect(result).toEqual({ exitCode: 99, stdout: "", stderr: "Invalid paper size\n" });
    expect(files.has("out.pdf")).toBe(false);
    const existing = new TextEncoder().encode("existing output");
    files.set("out.pdf", existing);
    expect((await run(args, files)).exitCode).toBe(99);
    expect(files.get("out.pdf")).toBe(existing);
  });

  it.each([
    { flags: ["-paper", "A4"], sizes: [[842, 595], [595, 842], [595, 842]] },
    { flags: ["-paperw", "900", "-paperh", "500"], sizes: [[500, 900], [900, 500], [900, 500]] },
    { flags: ["-origpagesizes"], sizes: [[216, 144], [144, 216], [144, 144]] },
    { flags: ["-paperw", "300", "-paperh", "400", "-origpagesizes"], sizes: [[216, 144], [144, 216], [144, 144]] },
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

  it.each([
    ["-paper", "A4", "-origpagesizes"],
    ["-origpagesizes", "-paper", "A4"],
  ])(`${run.name} rejects conflicting paper options %j`, async (...flags) => {
    const doc = PdfDocument.create();
    doc.addPage([72, 72]);
    for (const existingOutput of [false, true]) {
      const files = new Map([["in.pdf", doc.save()]]);
      if (existingOutput) files.set("out.pdf", new Uint8Array([1, 2, 3]));
      const before = new Map(files);
      const result = await run(["-pdf", ...flags, "in.pdf", "out.pdf"], files);
      expect(result).toEqual({
        exitCode: 99,
        stdout: "",
        stderr: "Error: -origpagesizes and -paper may not be used together.\n",
      });
      expect(files).toEqual(before);
    }
  });

  for (const format of ["ps", "eps"]) {
    it(`${run.name} renders text containing backslashes and parentheses in ${format} strings`, async () => {
      const doc = PdfDocument.create();
      doc.addPage([100, 30]).drawText("a\\b(c)d", { x: 1, y: 10, size: 8 });
      const files = new Map([["in.pdf", doc.save()]]);
      const result = await run([`-${format}`, "in.pdf", `out.${format}`], files);
      expect(result.exitCode).toBe(0);
      expect(new TextDecoder().decode(files.get(`out.${format}`))).toContain("colorimage");
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
