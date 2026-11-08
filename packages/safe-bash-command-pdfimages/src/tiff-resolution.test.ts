import { expect, it } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdfimagesCommand, runPdfimagesCli, runPdfimagesCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained"] as const) {
  it(`${mode} writes 72 DPI TIFF metadata while listing displayed PPI`, async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([72, 72]);
    page.drawImage(doc.embedRgbImage(2, 2, new Uint8Array(12).fill(120)), { x: 0, y: 0, width: 20, height: 20 });
    const input = doc.save();
    let tif: Uint8Array | undefined;
    let listing = "";
    if (mode === "retained") {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/tmp");
      await fs.writeFile("/in.pdf", input);
      for (const argv of [["-tiff", "in.pdf", "out"], ["-list", "in.pdf"]]) {
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = await createPdfimagesCommand().execute({
          command: "pdfimages", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
          stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        listing = stdout;
      }
      tif = await fs.readFile("/out-000.tif");
    } else {
      const files = new Map([["in.pdf", input]]);
      const run = mode === "sync" ? runPdfimagesCliSync : runPdfimagesCli;
      expect((await run(["-tiff", "in.pdf", "out"], files)).exitCode).toBe(0);
      const result = await run(["-list", "in.pdf"], files);
      expect(result.exitCode).toBe(0);
      listing = result.stdout;
      tif = files.get("out-000.tif");
    }
    expect(listing.trimEnd().split("\n")[2]?.split(" ").filter(Boolean).slice(12, 14)).toEqual(["7", "7"]);
    expect(tif).toBeDefined();
    const view = new DataView(tif!.buffer, tif!.byteOffset, tif!.byteLength);
    expect(view.getUint16(0, true)).toBe(0x4949);
    const ifd = view.getUint32(4, true);
    const tags = new Map<number, number>();
    for (let i = 0; i < view.getUint16(ifd, true); i++) {
      const entry = ifd + 2 + i * 12;
      const tag = view.getUint16(entry, true);
      if (tag === 282 || tag === 283) {
        const offset = view.getUint32(entry + 8, true);
        tags.set(tag, view.getUint32(offset, true) / view.getUint32(offset + 4, true));
      } else if (tag === 296) tags.set(tag, view.getUint16(entry + 8, true));
    }
    expect(Object.fromEntries(tags)).toEqual({ 282: 72, 283: 72, 296: 2 });
  });
}
