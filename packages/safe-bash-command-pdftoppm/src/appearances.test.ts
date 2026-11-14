import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftoppmCliSync, runPdftocairoCli, runPdftocairoCliSync } from "./index.js";
const pdf = new Uint8Array(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pdf-appearances.pdf", import.meta.url)));
const samples = readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pdf-appearances.samples", import.meta.url), "utf8").trim().split("\n").map(row => row.split(" ").map(Number));
for (const run of [runPdftoppmCli, runPdftoppmCliSync, runPdftocairoCli, runPdftocairoCliSync]) {
  it(`${run.name} renders visible annotation appearances against PDFium`, async () => {
    const files = new Map([["input.pdf", pdf]]);
    const result = await run(["-png", "-r", "72", "input.pdf", "page"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    const pages = [...files.entries()].filter(([name]) => name.startsWith("page-")).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([, bytes]) => decodePng(bytes));
    expect(pages).toHaveLength(10);
    for (const [page, x, y, ...rgb] of samples) {
      const image = pages[page! - 1]!;
      expect([image.width, image.height]).toEqual([100, 100]);
      const actual = image.data.subarray((y! * 100 + x!) * 4, (y! * 100 + x!) * 4 + 3);
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(actual[channel]! - rgb[channel]!), `page ${page}, ${x},${y}: ${actual} vs ${rgb}`).toBeLessThanOrEqual(2);
    }
    expect(files.get("input.pdf")).toEqual(pdf);
  });
}

for (const run of [runPdftoppmCli, runPdftoppmCliSync, runPdftocairoCli, runPdftocairoCliSync]) {
  it(`${run.name} hides annotations without hiding page content`, async () => {
    for (const page of [1, 6]) {
      const files = new Map([["input.pdf", pdf]]);
      const result = await run(["-hide-annotations", "-png", "-r", "72", "-singlefile", "-f", String(page), "input.pdf", "page"], files);
      expect(result.exitCode, result.stderr).toBe(0);
      const image = decodePng(files.get("page.png")!);
      for (let i = 0; i < image.data.length; i += 4) expect([...image.data.subarray(i, i + 4)]).toEqual(page === 1 ? [255,255,255,255] : [0,0,255,255]);
    }
  });
}
