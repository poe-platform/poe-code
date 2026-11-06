import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, decodePng } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdftocairoCommand, runPdftocairoCli, runPdftocairoCliSync } from "./index.js";

for (const mode of ["gray", "mono"] as const) {
  it.each(["buffered", "sync", "retained"])(`encodes ${mode} PNG metadata and pixels (%s)`, async path => {
    const doc = PdfDocument.create();
    const page = doc.addPage([13, 4]);
    page.drawRect({ x: 0, y: 0, width: 6, height: 4, fill: { r: 1, g: 0, b: 0 } });
    const argv = ["-png", `-${mode}`, "-r", "72", "-singlefile", "in.pdf", "out"];
    let output: Uint8Array;
    if (path === "retained") {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/tmp");
      await fs.writeFile("/in.pdf", doc.save());
      const args = createCommandArguments(argv);
      const result = await createPdftocairoCommand().execute({ command: "pdftocairo", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal, stdout: { write: async () => {} }, stderr: { write: async () => {} } });
      expect(result.exitCode).toBe(0);
      output = await fs.readFile("/out.png");
    } else {
      const files = new Map([["in.pdf", doc.save()]]);
      const run = path === "sync" ? runPdftocairoCliSync : runPdftocairoCli;
      expect((await run(argv, files)).exitCode).toBe(0);
      output = files.get("out.png")!;
    }
    expect(output[24]).toBe(mode === "mono" ? 1 : 8);
    expect(output[25]).toBe(0);
    const bitmap = decodePng(output);
    expect(bitmap).toMatchObject({ width: 13, height: 4 });
    for (let y = 0; y < 4; y++) {
      for (const x of [1, 11]) {
        const value = x === 11 ? 255 : mode === "mono" ? 0 : 76;
        expect(Array.from(bitmap.data.subarray((y * 13 + x) * 4, (y * 13 + x) * 4 + 4))).toEqual([value, value, value, 255]);
      }
    }
  });
}
