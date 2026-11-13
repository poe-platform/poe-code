import { expect, test } from "vitest";
import { PdfDocument, cosDict, cosName, cosStream, dictSet, decodePng } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftoppmCommand, createPdftocairoCommand, runPdftoppmCli, runPdftocairoCli } from "./index.js";

function pdf(stream: string): Uint8Array {
  const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
  const font = doc.cos.allocateObject(cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") }));
  dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: font }) }));
  dictSet(page.pageDict, "Contents", doc.cos.allocateObject(cosStream(new TextEncoder().encode(stream), { compress: false })));
  return doc.save();
}

for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  async function render(stream: string) {
    const files = new Map([["in.pdf", pdf(stream)]]);
    const result = await run(["-png", "-r", "72", "-singlefile", "in.pdf", "out"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    return decodePng(files.get("out.png")!).data;
  }
  test(`${run.name} text stroke modes, colors and transforms`, async () => {
    for (const matrix of ["1 0 0 1 0 0 cm", "1 .2 .3 1 0 0 cm", "0 1 -1 0 100 0 cm", "-1 0 0 1 100 0 cm"]) {
      for (let mode = 0; mode < 8; mode++) {
        const pixels = await render(`${matrix} 1 0 0 rg 0 0 1 RG 1 w BT /F1 60 Tf ${mode} Tr 10 20 Td (A) Tj ET`);
        let red = 0, blue = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i]! > 180 && pixels[i + 1]! < 100 && pixels[i + 2]! < 100) red++;
          if (pixels[i]! < 150 && pixels[i + 1]! < 150 && pixels[i + 2]! > 180) blue++;
        }
        expect(red > 100, `mode ${mode} red=${red}`).toBe([0, 2, 4, 6].includes(mode));
        expect(blue > 100, `mode ${mode} blue=${blue}`).toBe([1, 2, 5, 6].includes(mode));
        if ([3, 7].includes(mode)) expect(pixels.every(v => v === 255)).toBe(true);
      }
    }
  });
  test(`${run.name} text stroke width, dash and graphics state`, async () => {
    const text = "BT /F1 60 Tf 1 Tr 10 20 Td (A) Tj ET";
    const thin = await render(`0 0 1 RG 1 w ${text}`);
    const wide = await render(`0 0 1 RG 3 w ${text}`);
    const dashed = await render(`0 0 1 RG 3 w [3 3] 1 d ${text}`);
    const count = (p: Uint8Array) => p.filter((v, i) => i % 4 === 0 && v < 180).length;
    expect(count(wide)).toBeGreaterThan(count(thin) * 2);
    expect(count(dashed)).toBeLessThan(count(wide) * 3 / 4);
    expect(await render(`0 0 1 RG 1 w q 1 0 0 RG 9 w [3 3] 1 d 1 j 1 J Q ${text}`)).toEqual(thin);
    expect(await render("0 0 1 RG 3 w BT /F1 30 Tf 1 Tr 2 0 0 2 10 20 Tm (A) Tj ET")).toEqual(wide);
  });
}

for (const create of [createPdftoppmCommand, createPdftocairoCommand]) test(`${create.name} retains glyph stroke state`, async () => {
  const fs = createMemoryFileSystem();
  const input = pdf("1 0 0 rg 0 0 1 RG 3 w 1 j 2 J [3 6] 1 d BT /F1 60 Tf 2 Tr 10 20 Td (A) Tj ET");
  await fs.writeFile("/in.pdf", input);
  const command = create(), argv = ["-png", "-r", "72", "-singlefile", "/in.pdf", "/out"];
  const argumentValues = createCommandArguments(argv);
  const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0);
  const files = new Map([["/in.pdf", input]]);
  const run = create === createPdftoppmCommand ? runPdftoppmCli : runPdftocairoCli;
  expect((await run(argv, files)).exitCode).toBe(0);
  expect(decodePng(await fs.readFile("/out.png")).data).toEqual(decodePng(files.get("/out.png")!).data);
});
