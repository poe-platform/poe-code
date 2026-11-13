import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument, decodePng, dictDelete, dictGet } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftocairoCli } from "./index.js";

it.each([true, false])("renders Alpha-mask backdrop outside its bounds (BC=%s)", async backdrop => {
  const bytes = new Uint8Array(readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-smask_alpha_bc.pdf", import.meta.url)));
  const doc = PdfDocument.load(bytes);
  if (!backdrop) {
    const state = doc.cos.getObject(4)!;
    if (state.kind !== "dict") throw new Error("Expected graphics state");
    const mask = dictGet(state, "SMask")!;
    if (mask.kind !== "dict") throw new Error("Expected soft mask");
    dictDelete(mask, "BC");
  }
  const files = new Map([["in.pdf", backdrop ? bytes : doc.save()]]);
  const result = await runPdftoppmCli(["-png", "-scale-to", "256", "-singlefile", "in.pdf", "out"], files);
  expect(result.exitCode).toBe(0);
  const bitmap = decodePng(files.get("out.png")!);
  const pixel = (x: number, y: number) => Array.from(bitmap.data.subarray((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4));
  // Poppler 26.08 reference pixels; allow the existing color rounding difference.
  const blue = [51, 153, 229, 255];
  for (const [actual, expected] of [[pixel(20, 20), backdrop ? blue : [242, 242, 242, 255]], [pixel(80, 100), blue]]) {
    expected!.forEach((value, i) => expect(Math.abs(actual![i]! - value)).toBeLessThanOrEqual(1));
  }
});

const fixtures = new URL("../../safe-bash-rust/tests/fixtures/", import.meta.url);
const cases = readFileSync(new URL("pdf-soft-masks.txt", fixtures), "utf8")
  .trim().split("\n").filter(line => !line.startsWith("#")).map(line => line.split(" "));
for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  it(`${run.name} composites graphics-state soft masks and preserves ordinary Forms`, async () => {
    for (const name of new Set(cases.map(row => row[0]!))) {
      const input = new Uint8Array(readFileSync(new URL(`${name}.pdf`, fixtures)));
      const files = new Map([["input.pdf", input]]);
      const result = await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files);
      expect(result.exitCode, result.stderr).toBe(0);
      const png = decodePng(files.get("page.png")!);
      for (const row of cases.filter(row => row[0] === name)) {
        const [x, y, ...rgb] = row.slice(1).map(Number);
        const at = (y! * png.width + x!) * 4;
        rgb.forEach((value, i) => expect(Math.abs(png.data[at + i]! - value), `${run.name} ${row}`).toBeLessThanOrEqual(2));
      }
    }
  });
}

for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  it(`${run.name} rejects recursive masks without replacing output`, async () => {
    const input = readFileSync(new URL("mask-nested.pdf", fixtures));
    const cyclic = Buffer.from(input.toString("latin1").replace("/G 7 0 R", "/G 6 0 R"), "latin1");
    const existing = new TextEncoder().encode("existing");
    const files = new Map([["input.pdf", new Uint8Array(cyclic)], ["page.png", existing]]);
    await expect(run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(files.get("page.png")).toEqual(existing);
  });
}
