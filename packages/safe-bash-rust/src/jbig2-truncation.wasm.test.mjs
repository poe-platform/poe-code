import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PdfDocument, cosDict, cosName, cosNumber, cosStream } from "@poe-code/pdf-ast";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { pdftoppmCommands } from "safe-bash-command-pdftoppm";
import { RustWasmBash } from "./index.js";

const fixture = readFileSync(new URL("../../pdf-ast/src/fixtures/jbig2-generic-stream.bin", import.meta.url));
for (const runtime of ["TypeScript", "Rust"]) for (const end of [5, 10, 20, 29]) {
  test(`${runtime} pdftoppm rejects JBIG2 truncated at byte ${end} without replacing output`, { skip: !WebAssembly.Suspending }, async () => {
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({ fs: memory }).use(pdftoppmCommands()) : new RustWasmBash({ cwd: "/", forceNative: true });
    const fs = memory ?? shell.fs;
    try {
      const doc = PdfDocument.create(), page = doc.addPage([64, 32]);
      const image = doc.cos.allocateObject(cosStream(fixture.subarray(0, end), { dict: cosDict({
        Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(64), Height: cosNumber(32),
        ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(1), Filter: cosName("JBIG2Decode"),
      }) }));
      const name = page.ensureXObjectResource(image);
      page.setRawContentStream(`q 64 0 0 32 0 0 cm /${name} Do Q`);
      await fs.writeFile("/in.pdf", doc.save());
      await fs.writeFile("/out.png", new TextEncoder().encode("keep output"));
      const result = await shell.exec("TMPDIR=/scratch pdftoppm -png -singlefile -r 72 /in.pdf /out");
      assert.notEqual(result.exitCode, 0);
      assert.notEqual(result.stderr, "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/out.png")), "keep output");
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally { await shell.dispose(); }
  });
}
