import assert from "node:assert/strict";
import test from "node:test";
import {PdfDocument, cosDict, cosName, cosStream, dictSet} from "@poe-code/pdf-ast";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} pdffonts reports unresolved substitutes without host paths`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      const doc = PdfDocument.create(), page = doc.addPage([300, 200]);
      const names = ["Helvetica", "Times-Roman", "Courier", "Symbol", "ZapfDingbats", "Arial", "CustomFont"];
      const fonts = names.map(name => doc.cos.allocateObject(cosDict({Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName(name)})));
      const embedded = doc.cos.allocateObject(cosDict({Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("EmbeddedFont"),
        FontDescriptor: cosDict({FontFile: doc.cos.allocateObject(cosStream(new Uint8Array()))})}));
      dictSet(page.pageDict, "Resources", cosDict({Font: cosDict(Object.fromEntries([...fonts, embedded].map((font, i) => [`F${i}`, font])))}));
      doc.addPage([300, 200]);
      const bytes = doc.save(); await fs.writeFile("/fonts.pdf", bytes);
      const result = await shell.exec("pdffonts -subst -f 1 -l 1 /fonts.pdf");
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
      assert.deepEqual(result.stdout.trimEnd().split("\n").slice(2), names.map((name, i) =>
        `${name.padEnd(36)} ${String(fonts[i].objectNumber).padStart(6)}  0 ${"[unresolved]".padEnd(36)} [unresolved]`));
      const empty = await shell.exec("pdffonts -subst -f 2 -l 2 /fonts.pdf");
      assert.equal(empty.exitCode, 0, empty.stderr); assert.equal(empty.stdout.trimEnd().split("\n").length, 2);
      const normal = await shell.exec("pdffonts /fonts.pdf");
      assert.equal(normal.exitCode, 0, normal.stderr); assert.match(normal.stdout, /EmbeddedFont.*yes/);
      assert.deepEqual(Buffer.from(await fs.readFile("/fonts.pdf")), Buffer.from(bytes));
      if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
    } finally {await shell.dispose();}
  });

  test(`${runtime} qpdf JSON rebuild retains truthful font substitution output`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      const doc = PdfDocument.create(); doc.setTitle("Initial VFS Title");
      doc.addPage([300, 200]).drawText("JSON VFS Pipeline Text", {x: 20, y: 100, size: 12});
      await fs.writeFile("/in.pdf", doc.save());
      await fs.writeFile("/patch.json", new TextEncoder().encode(JSON.stringify({qpdf: [{jsonversion: 2}, {
        [`obj:${doc.cos.infoRef.objectNumber} 0 R`]: {value: {"/Title": "u:Updated VFS Title From JSON"}},
      }]})));
      const result = await shell.exec("qpdf /in.pdf --json --json-stream-data=file --json-stream-prefix=/stm- /dump.json && qpdf --json-input /dump.json /rebuilt.pdf && qpdf /rebuilt.pdf --update-from-json=/patch.json /patched.pdf && pdfinfo /patched.pdf && pdffonts -subst /patched.pdf && pdftotext /patched.pdf -");
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
      assert.match(result.stdout, /Updated VFS Title From JSON/);
      assert.match(result.stdout, /Helvetica\s+\d+\s+0\s+\[unresolved\]\s+\[unresolved\]/);
      assert.match(result.stdout, /JSON VFS Pipeline Text/);
      if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
    } finally {await shell.dispose();}
  });
}
