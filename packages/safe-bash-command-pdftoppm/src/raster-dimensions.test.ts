import { describe, expect, it } from "vitest";
import { PdfDocument, decodePng } from "@poe-code/pdf-ast";
import { runPdftocairoCli, runPdftoppmCli } from "./index.js";

for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  describe(run.name, () => {
    it.each([
      { size: 100, args: ["-r", "150"], width: 209, height: 209 },
      { size: 100, args: ["-r", "96"], width: 134, height: 134 },
      { size: 1, args: ["-r", "96"], width: 2, height: 2 },
      { size: 1, args: ["-r", "150"], width: 3, height: 3 },
      { size: 100, args: ["-r", "72"], width: 100, height: 100 },
      { size: 1, args: ["-r", "72"], width: 1, height: 1 },
      { size: 100, args: ["-rx", "96", "-ry", "150"], width: 134, height: 209 },
    ])("rounds $size pt at $args up to $width x $height", async ({ size, args, width, height }) => {
      const doc = PdfDocument.create();
      doc.addPage([size, size]);
      const files = new Map([["in.pdf", doc.save()]]);
      const result = await run(["-png", "-singlefile", ...args, "in.pdf", "out"], files);
      expect(result.exitCode).toBe(0);
      expect(decodePng(files.get("out.png")!)).toMatchObject({ width, height });
    });

    it("rounds scaled pixel extents up", async () => {
      const doc = PdfDocument.create();
      doc.addPage([216, 144]);
      const files = new Map([["in.pdf", doc.save()]]);
      const result = await run(["-png", "-singlefile", "-scale-to", "100", "in.pdf", "out"], files);
      expect(result.exitCode).toBe(0);
      expect(decodePng(files.get("out.png")!)).toMatchObject({ width: 101, height: 67 });
    });
  });
}
