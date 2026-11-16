import assert from "node:assert/strict";
import test from "node:test";
import {PdfDocument, cosArray, cosDict, cosName, cosNumber, cosString, dictGet, dictSet, dictDelete} from "@poe-code/pdf-ast";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) for (const mode of ["same-font", "new-font", "font-collision"]) {
  test(`${runtime} annotation fallback retains Helvetica metrics for ${mode}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      const doc = PdfDocument.create(), page = doc.addPage([300, 200]);
      page.drawText("Base", {x: 20, y: 150, size: 12});
      const fonts = doc.cos.resolveDict(dictGet(page.getResourcesDict(), "Font"));
      const original = doc.cos.resolveDict(dictGet(fonts, "F1"));
      const widths = dictGet(original, "Widths").items.map(n => n.value);
      if (mode === "new-font") dictDelete(page.dict, "Resources");
      if (mode === "font-collision") dictSet(page.getResourcesDict(), "Font", cosDict({F1: doc.cos.allocateObject(cosDict({Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier")}))}));
      dictSet(page.dict, "Annots", cosArray([doc.cos.allocateObject(cosDict({Subtype: cosName("Square"),
        Rect: cosArray([20, 40, 220, 90].map(n => cosNumber(n))), F: cosNumber(4), Contents: cosString("Fallback € test")}))]));
      const input = doc.save(); await fs.writeFile("/in.pdf", input);
      const result = await shell.exec("qpdf /in.pdf /out.pdf --flatten-annotations=all");
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
      const out = PdfDocument.load(await fs.readFile("/out.pdf"));
      const resources = out.cos.resolveDict(dictGet(out.getPage(0).getResourcesDict(), "Font"));
      assert.equal(resources.entries.length, mode === "font-collision" ? 2 : 1);
      const name = mode === "font-collision" ? "F2" : "F1";
      const font = out.cos.resolveDict(dictGet(resources, name));
      assert.equal(dictGet(font, "BaseFont").decoded, "Helvetica");
      assert.equal(dictGet(font, "FirstChar")?.value, 32);
      assert.equal(dictGet(font, "LastChar")?.value, 255);
      assert.deepEqual(dictGet(font, "Widths")?.items.map(n => n.value), widths);
      assert.equal(widths[128 - 32], 556);
      if (mode === "font-collision") assert.equal(dictGet(out.cos.resolveDict(dictGet(resources, "F1")), "BaseFont").decoded, "Courier");
      assert.match(out.extractText(), /Fallback € test/);
      assert.deepEqual(Buffer.from(await fs.readFile("/in.pdf")), Buffer.from(input));
      if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
    } finally {await shell.dispose();}
  });
}
