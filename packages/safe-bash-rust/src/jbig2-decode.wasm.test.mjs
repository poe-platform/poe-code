import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeJbig2ToRgba } from "../../pdf-ast/dist/extract/images.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, decodePng } from "@poe-code/pdf-ast";
import { pdftoppmCommands } from "safe-bash-command-pdftoppm";
import { RustWasmBash } from "./index.js";
import { pdfimagesCommands } from "safe-bash-command-pdfimages";

const fixture = (name) => new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url)));

for (const kind of ["generic-stream.bin", "mmr-stream.bin", "symbols.0000"]) for (const runtime of ["TypeScript", "Rust"]) for (const wrapped of [false, true]) for (const decode of [[0, 1], [1, 0], [0.25, 0.75], [0.75, 0.25], [0, 0], [1, 1]]) {
  test(`${runtime} renders and extracts JBIG2 ${kind} Decode ${decode} (wrapped=${wrapped}) like independent raw samples`, { skip: !WebAssembly.Suspending }, async () => {
    const payloadBytes = fixture(`jbig2-${kind}`);
    const globals = kind === "symbols.0000" ? fixture("jbig2-symbols.sym") : undefined;
    const source = globals ? { data: decodeJbig2ToRgba(payloadBytes, 64, 32, globals) } : decodePng(fixture("jbig2-source.png"));
    // Independently decoded PyMuPDF hash for the lossy global-symbol fixture (fixtures/SOURCES.md).
    if (globals) assert.equal(createHash("sha256").update(source.data).digest("hex"), "2f6fdd7e5b7bf087b4c8511e64986052aa0cbd4f267346c39906e27bc99d21ce");
    const expected = source.data.slice();
    const packed = new Uint8Array(256);
    for (let p = 0; p < 2048; p++) {
      const gray = Math.round(255 * decode[source.data[p * 4] === 0 ? 0 : 1]);
      expected[p * 4] = expected[p * 4 + 1] = expected[p * 4 + 2] = gray;
      if (gray < 128) packed[p >> 3] |= 128 >> (p % 8);
    }
    const raw = new Uint8Array(256);
    for (let p = 0; p < 2048; p++) if (source.data[p * 4]) raw[p >> 3] |= 128 >> (p % 8);
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({ fs: memory }).use(pdftoppmCommands()).use(pdfimagesCommands()) : new RustWasmBash({ cwd: "/", forceNative: true });
    const fs = memory ?? shell.fs;
    try {
      await fs.mkdir("/scratch", { recursive: true });
      for (const encoded of [false, true]) {
        const doc = PdfDocument.create(), page = doc.addPage([64, 32]);
        let payload = encoded ? payloadBytes : raw;
        if (encoded && wrapped) payload = new TextEncoder().encode(Buffer.from(payload).toString("hex") + ">");
        const params = globals && encoded ? cosDict({ JBIG2Globals: doc.cos.allocateObject(cosStream(globals)) }) : undefined;
        const image = doc.cos.allocateObject(cosStream(payload, { dict: cosDict({
          Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(64), Height: cosNumber(32),
          ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(1), Decode: cosArray(decode.map(value => cosNumber(value))),
          ...(params ? { DecodeParms: wrapped ? cosArray([{ kind: "null" }, params]) : params } : {}),
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
      assert.deepEqual(await fs.readFile("/page-true.png"), await fs.readFile("/page-false.png"));
      assert.deepEqual(decodePng(await fs.readFile("/png-true-000.png")).data, expected);
      const pbm = await fs.readFile("/pbm-true-000.pbm");
      assert.equal(new TextDecoder().decode(pbm.subarray(0, 9)), "P4\n64 32\n");
      assert.deepEqual(pbm.subarray(9), packed);
      const result = await shell.exec("TMPDIR=/scratch pdfimages -jbig2 /input-true.pdf /native");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await fs.readFile("/native-000.jb2e"), payloadBytes);
      if (globals) assert.deepEqual(await fs.readFile("/native-000.jb2g"), globals);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally { await shell.dispose(); }
  });
}

for (const mask of ["Mask", "SMask"]) for (const decode of [[0, 1], [1, 0], [0.25, 0.75]]) {
  test(`Rust applies JBIG2 Decode ${decode} before ${mask}`, { skip: !WebAssembly.Suspending }, async () => {
    const source = decodePng(fixture("jbig2-source.png"));
    const raw = new Uint8Array(256);
    for (let p = 0; p < 2048; p++) if (source.data[p * 4]) raw[p >> 3] |= 128 >> (p % 8);
    const shell = new RustWasmBash({ cwd: "/", forceNative: true });
    try {
      for (const encoded of [false, true]) {
        const doc = PdfDocument.create(), page = doc.addPage([64, 32]);
        const alpha = mask === "Mask" ? cosArray([cosNumber(0), cosNumber(0)]) : doc.cos.allocateObject(cosStream(new Uint8Array(2048).fill(128), { dict: cosDict({ Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(64), Height: cosNumber(32), ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(8) }) }));
        const image = doc.cos.allocateObject(cosStream(encoded ? fixture("jbig2-generic-stream.bin") : raw, { dict: cosDict({
          Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(64), Height: cosNumber(32),
          ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(1), Decode: cosArray(decode.map(value => cosNumber(value))),
          [mask]: alpha, ...(encoded ? { Filter: cosName("JBIG2Decode") } : {}),
        }) }));
        const name = page.ensureXObjectResource(image);
        page.setRawContentStream(`q 64 0 0 32 0 0 cm /${name} Do Q`);
        await shell.fs.writeFile(`/input-${encoded}.pdf`, doc.save());
        const result = await shell.exec(`pdftoppm -png -r 72 -singlefile /input-${encoded}.pdf /page-${encoded}`);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      assert.deepEqual(await shell.fs.readFile("/page-true.png"), await shell.fs.readFile("/page-false.png"));
      await shell.fs.writeFile("/limited-000.png", new TextEncoder().encode("keep output"));
      await assert.rejects(shell.exec("pdfimages -png /input-true.pdf /limited", { limits: { maxOutputBytes: 1 } }), { name: "ShellLimitError", limit: "maxOutputBytes" });
      assert.equal(new TextDecoder().decode(await shell.fs.readFile("/limited-000.png")), "keep output");
    } finally { await shell.dispose(); }
  });
}
