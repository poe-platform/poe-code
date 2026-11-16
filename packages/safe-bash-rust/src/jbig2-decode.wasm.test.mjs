import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, decodePng } from "@poe-code/pdf-ast";
import { pdftoppmCommands } from "safe-bash-command-pdftoppm";
import { pdfimagesCommands } from "safe-bash-command-pdfimages";

const fixture = (name) => new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url)));

for (const wrapped of [false, true]) for (const decode of [[0, 1], [1, 0], [0.25, 0.75]]) {
  test(`TypeScript renders and extracts JBIG2 Decode ${decode} (wrapped=${wrapped}) like independent raw samples`, { skip: !WebAssembly.Suspending }, async () => {
    const source = decodePng(fixture("jbig2-source.png"));
    const raw = new Uint8Array(256);
    for (let p = 0; p < 2048; p++) if (source.data[p * 4]) raw[p >> 3] |= 128 >> (p % 8);
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(pdftoppmCommands()).use(pdfimagesCommands());
    try {
      for (const encoded of [false, true]) {
        const doc = PdfDocument.create(), page = doc.addPage([64, 32]);
        let payload = encoded ? fixture("jbig2-generic-stream.bin") : raw;
        if (encoded && wrapped) payload = new TextEncoder().encode(Buffer.from(payload).toString("hex") + ">");
        const image = doc.cos.allocateObject(cosStream(payload, { dict: cosDict({
          Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(64), Height: cosNumber(32),
          ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(1), Decode: cosArray(decode.map(value => cosNumber(value))),
          ...(encoded ? { Filter: wrapped ? cosArray([cosName("ASCIIHexDecode"), cosName("JBIG2Decode")]) : cosName("JBIG2Decode") } : {}),
        }) }));
        const name = page.ensureXObjectResource(image);
        page.setRawContentStream(`q 64 0 0 32 0 0 cm /${name} Do Q`);
        await fs.writeFile(`/input-${encoded}.pdf`, doc.save());
        for (const command of [
          `pdftoppm -png -r 72 -singlefile /input-${encoded}.pdf /page-${encoded}`,
          `pdfimages -png /input-${encoded}.pdf /png-${encoded}`,
          `pdfimages /input-${encoded}.pdf /pbm-${encoded}`,
        ]) {
          const result = await shell.exec(`TMPDIR=/scratch ${command}`);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
        }
      }
      for (const path of ["page-BOOL.png", "png-BOOL-000.png", "pbm-BOOL-000.pbm"]) {
        assert.deepEqual(await fs.readFile(`/${path.replace("BOOL", "true")}`), await fs.readFile(`/${path.replace("BOOL", "false")}`));
      }
      const result = await shell.exec("TMPDIR=/scratch pdfimages -jbig2 /input-true.pdf /native");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await fs.readFile("/native-000.jb2e"), fixture("jbig2-generic-stream.bin"));
    } finally { await shell.dispose(); }
  });
}
