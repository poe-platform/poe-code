import assert from "node:assert/strict";
import test from "node:test";
import {PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, dictSet} from "@poe-code/pdf-ast";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} pdftotext -nodiag retains quarter-turn and near-axis text`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      for (const [x, y, keep] of [[1, 0, true], [0, 1, true], [-1, 0, true], [0, -1, true], [Math.sqrt(1 - 0.099 ** 2), 0.099, true], [Math.sqrt(1 - 0.101 ** 2), 0.101, false], [-Math.SQRT1_2, Math.SQRT1_2, false]]) {
        const doc = PdfDocument.create(), page = doc.addPage([300, 300]);
        page.drawText("AXIS", {x: 150, y: 150, size: 10});
        page.setRawContentStream(`BT /F1 10 Tf ${x} ${y} ${-y} ${x} 150 150 Tm (AXIS) Tj ET`);
        await fs.writeFile("/in.pdf", doc.save());
        for (const mode of ["", "-raw", "-layout"]) {
          const result = await shell.exec(`pdftotext ${mode} -nodiag /in.pdf -`);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stdout.replaceAll(/\s/g, ""), keep ? "AXIS" : "", `${x} ${y} ${mode}`);
        }
      }
    } finally {await shell.dispose();}
  });

  test(`${runtime} pdftotext discards diagonal stamps while preserving ordinary CropBox bleed`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      const doc = PdfDocument.create(), page = doc.addPage([200, 200]);
      dictSet(page.pageDict, "CropBox", cosArray([0, 0, 200, 120].map(n => cosNumber(n))));
      page.setRawContentStream([
        "BT /F1 12 Tf 1 0 0 1 20 60 Tm (VisibleMainText) Tj ET",
        "BT /F1 12 Tf 0.7071 0.7071 -0.7071 0.7071 50 50 Tm (DiagonalDraftStamp) Tj ET",
        "BT /F1 12 Tf 1 0 0 1 20 170 Tm (CroppedHeaderBleed) Tj ET",
      ].join("\n"));
      const appearance = doc.cos.allocateObject(cosStream(new TextEncoder().encode("BT /F1 10 Tf 5 5 Td (FlattenedAPBadge) Tj ET"), {dict: cosDict({Type: cosName("XObject"), Subtype: cosName("Form"), BBox: cosArray([0, 0, 50, 20].map(n => cosNumber(n)))})}));
      const annot = doc.cos.allocateObject(cosDict({Type: cosName("Annot"), Subtype: cosName("Stamp"), F: cosNumber(4), Rect: cosArray([20, 20, 120, 50].map(n => cosNumber(n))), AP: cosDict({N: appearance})}));
      dictSet(page.pageDict, "Annots", cosArray([annot]));
      await fs.writeFile("/in.pdf", doc.save());
      const flatten = await shell.exec("qpdf --flatten-annotations=print /in.pdf /flat.pdf");
      assert.equal(flatten.exitCode, 0, flatten.stderr);
      for (const mode of ["", "-raw", "-layout"]) {
        const unfiltered = await shell.exec(`pdftotext ${mode} -cropbox /flat.pdf -`);
        assert.equal(unfiltered.exitCode, 0, unfiltered.stderr);
        const filtered = await shell.exec(`pdftotext ${mode} -nodiag -cropbox /flat.pdf -`);
        assert.equal(filtered.exitCode, 0, filtered.stderr);
        assert.match(filtered.stdout, /VisibleMainText/); assert.match(filtered.stdout, /FlattenedAPBadge/);
        assert.match(filtered.stdout, /CroppedHeaderBleed/);
        assert.equal(filtered.stdout.replace(/VisibleMainText|FlattenedAPBadge|CroppedHeaderBleed|\s/g, ""), "");
        assert.ok(unfiltered.stdout.replaceAll(/\s/g, "").length > filtered.stdout.replaceAll(/\s/g, "").length);
      }
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
