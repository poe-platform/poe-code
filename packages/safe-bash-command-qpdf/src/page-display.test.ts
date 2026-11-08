import assert from "node:assert/strict";
import { it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli } from "./index.js";

// qpdf 12.4.2 --show-pages --with-images for the pdf-lib fixture below.
const nativeOutput = "page 1: 4 0 R\n  content:\n    5 0 R\npage 2: 7 0 R\n  images:\n    /Image-7098480789: 6 0 R, 1 x 1\n  content:\n    8 0 R\npage 3: 9 0 R\n  content:\n";

for (const retained of [false, true]) for (const withImages of [false, true]) {
  it(`matches native page listing (retained=${retained}, withImages=${withImages})`, async () => {
    const document = await PDFDocument.create();
    document.addPage([100, 100]).drawRectangle({ x: 0, y: 0, width: 10, height: 10 });
    const image = await document.embedPng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=", "base64"));
    document.addPage([100, 100]).drawImage(image);
    document.addPage([100, 100]);
    const input = await document.save({ useObjectStreams: false });
    const args = ["--show-pages", ...(withImages ? ["--with-images"] : []), "in.pdf"];
    let output: string;
    if (retained) {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
        stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } } });
      assert.equal(result.exitCode, 0); assert.equal(Buffer.concat(stderr).toString(), "");
      output = Buffer.concat(stdout).toString();
      assert.deepEqual(await fs.readdir("/scratch"), []);
    } else {
      const result = await runQpdfCli(args, new Map([["in.pdf", input]]));
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); output = result.stdout;
    }
    assert.equal(output, withImages ? nativeOutput : nativeOutput.replace("  images:\n    /Image-7098480789: 6 0 R, 1 x 1\n", ""));
  });
}
