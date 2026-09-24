import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Shell, createMemoryFileSystem } from "../../src/index.js";
import { sipsCommands } from "../../src/commands/sips/index.js";
import { pdfinfoCommands } from "../../src/commands/pdfinfo/index.js";
import { sharp } from "@poe-code/image-ast";
import { PdfDocument, rgb } from "@poe-code/pdf-ast";

describe("safe-bash sips & identify integration", () => {
  it("runs sips and identify pipelines inside virtual Shell with pdftoppm interoperability", async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs })
      .use(sipsCommands())
      .use(pdfinfoCommands());

    const inputPng = await sharp({
      create: { width: 120, height: 80, channels: 4, background: "#336699ff" }
    }).png().toBuffer();
    await fs.writeFile("/hero.png", inputPng);

    const queryRes = await shell.exec("sips -g pixelWidth -g pixelHeight -g format /hero.png");
    assert.equal(queryRes.exitCode, 0);
    assert.match(queryRes.stdout, /pixelWidth: 120/);
    assert.match(queryRes.stdout, /pixelHeight: 80/);
    assert.match(queryRes.stdout, /format: png/);

    const resizeRes = await shell.exec("sips -Z 60 -s format jpeg -s formatOptions 85 /hero.png --out /hero-thumb.jpg");
    assert.equal(resizeRes.exitCode, 0);

    const idRes = await shell.exec("identify -format '%m %wx%h' /hero-thumb.jpg");
    assert.equal(idRes.exitCode, 0);
    assert.equal(idRes.stdout, "JPEG 60x40");

    const pdf = PdfDocument.create();
    const page = pdf.addPage({ width: 200, height: 100 });
    page.drawRect({ x: 0, y: 0, width: 200, height: 100, fill: rgb(0.9, 0.2, 0.2) });
    await fs.writeFile("/slide.pdf", pdf.save());

    const ppmRes = await shell.exec("pdftoppm -png -r 72 /slide.pdf /slide-page && sips -Z 100 /slide-page-1.png --out /slide-100.png && identify -format '%m %wx%h' /slide-100.png");
    assert.equal(ppmRes.exitCode, 0);
    assert.match(ppmRes.stdout, /PNG 100x50$/);
  });
});
