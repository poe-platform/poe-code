import assert from "node:assert/strict";
import test from "node:test";
import {PdfDocument, cosArray, cosNumber, cosDict, cosName, dictSet} from "@poe-code/pdf-ast";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} rotated words retain line order and shifted page clipping`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      for (const matrix of ["1 0 0 1", "0 1 -1 0", "-1 0 0 -1", "0 -1 1 0"]) {
        const doc = PdfDocument.create(), page = doc.addPage([200, 200]);
        dictSet(page.pageDict, "MediaBox", cosArray([-100, -100, 100, 100].map(n => cosNumber(n))));
        page.setRotation(90);
        const font = doc.cos.allocateObject(cosDict({Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica")}));
        dictSet(page.pageDict, "Resources", cosDict({Font: cosDict({F1: font})}));
        page.setRawContentStream(`q ${matrix} 0 0 cm BT /F1 10 Tf 0 0 Td (FIRST WORD) Tj 0 -12 Td (SECOND LINE) Tj 0 132 Td (OUTSIDE) Tj ET Q`);
        await fs.writeFile("/lines.pdf", doc.save());
        for (const flag of ["", "-raw"]) {
          const result = await shell.exec(`pdftotext ${flag} /lines.pdf -`);
          assert.equal(result.exitCode, 0, result.stderr);
          const separator = flag || matrix === "1 0 0 1" ? "\n" : "\n\n";
          assert.equal(result.stdout.trim(), `FIRST WORD${separator}SECOND LINE`, `${matrix} ${flag}`);
        }
      }
      if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
    } finally {await shell.dispose();}
  });

  for (const rotation of [0, 90, 180, 270]) {
    test(`${runtime} rotated ${rotation} stamp preserves fitting text and clips overflow`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
      const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
      const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
      const fs = memory ?? shell.fs;
      try {
        const target = PdfDocument.create();
        target.addPage(rotation % 180 ? [200, 100] : [100, 200]).setRotation(rotation);
        await fs.writeFile("/target.pdf", target.save());
        for (const [size, expected] of [[9, "ROTATED-STAMP"], [12, "ROTATED-STA"]]) {
          const stamp = PdfDocument.create();
          stamp.addPage([100, 200]).drawText("ROTATED-STAMP", {x: 20, y: 100, size});
          await fs.writeFile("/stamp.pdf", stamp.save());
          const result = await shell.exec("pdftk /target.pdf stamp /stamp.pdf output /stamped.pdf && pdftotext /stamped.pdf -");
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout.trim(), expected, `font size ${size}`);
          const raw = await shell.exec("pdftotext -raw /stamped.pdf -");
          assert.equal(raw.exitCode, 0, raw.stderr);
          assert.equal(raw.stdout.trim(), expected, `raw font size ${size}`);
          const output = PdfDocument.load(await fs.readFile("/stamped.pdf"));
          assert.equal(output.getPage(0).getRotation(), rotation);
        }
        if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
      } finally {await shell.dispose();}
    });
  }
}
