import { expect, it } from "vitest";
import { PdfDocument, cosArray, cosNumber, dictSet, decodePng } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftocairoCommand, runPdftocairoCli, runPdftocairoCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained"]) {
  it.each([
    { width: 300, height: 300, margin: 50, size: 200, origin: 0 },
    { width: 300, height: 300, margin: 50, size: 200, origin: 30 },
    { width: 100, height: 150, margin: 25, size: 100, origin: 0 },
  ])(`centers and fits PDF content on requested paper (${mode}): $width x $height`, async ({ width, height, margin, size, origin }) => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);
    dictSet(page.pageDict, "MediaBox", cosArray([origin, origin, origin + 200, origin + 200].map(value => cosNumber(value))));
    page.setRawContentStream(`1 0 0 1 ${origin} ${origin} cm 1 0 0 rg 0 100 100 100 re f 0 1 0 rg 100 100 100 100 re f 0 0 1 rg 0 0 100 100 re f 0 0 0 rg 100 0 100 100 re f`);
    const args = ["-pdf", "-paperw", String(width), "-paperh", String(height), "in.pdf", "out.pdf"];
    const files = new Map([["in.pdf", doc.save()]]);
    if (mode === "retained") {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/in.pdf", doc.save());
      const argumentValues = createCommandArguments(args);
      const result = await createPdftocairoCommand().execute({ command: "pdftocairo", args: argumentValues.args, argumentValues, cwd: "/", env: { TMPDIR: "/scratch" }, fs, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal });
      expect(result.exitCode).toBe(0);
      files.set("out.pdf", await fs.readFile("/out.pdf"));
      expect(await fs.readdir("/scratch")).toEqual([]);
    } else {
      expect((await (mode === "sync" ? runPdftocairoCliSync : runPdftocairoCli)(args, files)).exitCode).toBe(0);
    }
    expect(PdfDocument.load(files.get("out.pdf")!).getPage(0).getSize()).toEqual({ width, height });
    expect((await runPdftocairoCli(["-png", "-singlefile", "-r", "72", "out.pdf", "render"], files)).exitCode).toBe(0);
    const png = decodePng(files.get("render.png")!);
    const pixel = (x: number, y: number) => [...png.data.slice((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
    const left = (width - size) / 2;
    expect(pixel(left + 10, margin + 10)).toEqual([255, 0, 0]);
    expect(pixel(left + size / 2 + 10, margin + 10)).toEqual([0, 255, 0]);
    expect(pixel(left + 10, margin + size / 2 + 10)).toEqual([0, 0, 255]);
    expect(pixel(left + size / 2 + 10, margin + size / 2 + 10)).toEqual([0, 0, 0]);
    expect(pixel(10, 10)).toEqual([255, 255, 255]);
  });
}
