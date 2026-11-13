import assert from "node:assert/strict";
import test from "node:test";
import { createRustWasmBash } from "./index.js";
import { PdfDocument, cosDict, cosName, cosStream, dictSet, decodePng } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftocairoCli } from "safe-bash-command-pdftoppm";

function pdf(stream) {
  const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
  const font = doc.cos.allocateObject(cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") }));
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: font }) }));
  dictSet(page.pageDict, "Contents", doc.cos.allocateObject(cosStream(new TextEncoder().encode(stream), { compress: false })));
  return doc.save();
}

test("PDF text strokes match TypeScript colors, transforms and stroke state in Wasm", async () => {
  const bash = await createRustWasmBash();
  try {
    for (const [command, run] of [["pdftoppm", runPdftoppmCli], ["pdftocairo", runPdftocairoCli]]) {
      const cases = [];
      for (const matrix of ["1 0 0 1 0 0 cm", "1 .2 .3 1 0 0 cm", "0 1 -1 0 100 0 cm", "-1 0 0 1 100 0 cm"])
        for (let mode = 0; mode < 8; mode++)
          cases.push(`${matrix} 1 0 0 rg 0 0 1 RG 1 w BT /F1 60 Tf ${mode} Tr 10 20 Td (A) Tj ET`);
      for (const state of ["3 w", "0 w", "3 w [3 3] 1 d", "3 w [0 6] 1 d 1 J", "3 w [3 6 2] 2 d 2 J", "5 w 1 j", "5 w 2 j", "5 w 1 M", "1 w q 9 w 1 j [3 3] 1 d Q"])
        cases.push(`0 0 1 RG ${state} BT /F1 60 Tf 1 Tr 10 20 Td (A) Tj ET`);
      for (const text of ["O", "S", "@", " "])
        cases.push(`0 0 1 RG 2 w BT /F1 60 Tf 1 Tr 10 20 Td (${text}) Tj ET`);
      cases.push("1.5 0 .2 .7 0 0 cm 0 0 1 RG 0 w [3 3] 0 d BT /F1 60 Tf 1 Tr 10 20 Td (A) Tj ET");
      for (const stream of cases) {
        const input = pdf(stream), files = new Map([["/input.pdf", input]]);
        const args = ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"];
        const expectedResult = await run(args, files);
        assert.equal(expectedResult.exitCode, 0, expectedResult.stderr);
        await bash.fs.writeFile("/input.pdf", input);
        const result = await bash.exec(`${command} ${args.join(" ")}`);
        assert.equal(result.exitCode, 0, result.stderr);
        const expected = decodePng(files.get("/page.png")), actual = decodePng(await bash.fs.readFile("/page.png"));
        assert.deepEqual([actual.width, actual.height], [100, 100]);
        // Edge coverage differs between rasterizers; compare colored areas and
        // locations while allowing antialiasing within one pixel of a contour.
        let changed = 0, reference = 0, mismatch = 0;
        for (let i = 0; i < actual.data.length; i += 4) {
          const a = Math.min(...actual.data.subarray(i, i + 3)) < 180;
          const e = Math.min(...expected.data.subarray(i, i + 3)) < 180;
          changed += a; reference += e;
          if (a !== e) mismatch++;
        }
        assert.ok(Math.abs(changed - reference) <= Math.max(40, reference * .2), `${command}: ${changed} vs ${reference}: ${stream}`);
        assert.ok(mismatch <= Math.max(80, reference * .35), `${command}: ${mismatch} misplaced pixels: ${stream}`);
        for (const channel of [0, 2]) {
          const count = data => {
            let n = 0;
            for (let i = 0; i < data.length; i += 4)
              if (data[i + channel] > 180 && data[i + 1] < 100 && data[i + 2 - channel] < 100) n++;
            return n;
          };
          const e = count(expected.data), a = count(actual.data);
          assert.ok(Math.abs(a - e) <= Math.max(60, e * .3), `${command}: color ${channel}: ${a} vs ${e}: ${stream}`);
        }
        if (!reference) assert.deepEqual(actual.data, expected.data);
      }
    }
  } finally { await bash.dispose(); }
});

test("PDF text stroke geometry failures preserve output in TypeScript and Wasm", async () => {
  const input = pdf("[.000000001 .000000001] 0 d BT /F1 60 Tf 1 Tr 10 20 Td (A) Tj ET");
  const bash = await createRustWasmBash();
  try {
    for (const [command, run] of [["pdftoppm", runPdftoppmCli], ["pdftocairo", runPdftocairoCli]]) {
      for (const existing of [false, true]) {
        const files = new Map([["/input.pdf", input]]), sentinel = new TextEncoder().encode("existing output");
        await bash.fs.writeFile("/input.pdf", input);
        if (existing) { files.set("/page.png", sentinel); await bash.fs.writeFile("/page.png", sentinel); }
        const args = ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"];
        await assert.rejects(run(args, files), { code: "E_LIMIT" });
        const wasm = await bash.exec(`${command} ${args.join(" ")}`);
        assert.notEqual(wasm.exitCode, 0);
        if (existing) {
          assert.deepEqual(files.get("/page.png"), sentinel);
          assert.deepEqual(await bash.fs.readFile("/page.png"), sentinel);
        } else {
          assert.equal(files.has("/page.png"), false);
          assert.equal((await bash.exec("test -e /page.png")).exitCode, 1);
        }
        await bash.exec("rm -f /page.png");
      }
    }
  } finally { await bash.dispose(); }
});
