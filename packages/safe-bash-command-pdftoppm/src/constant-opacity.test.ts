import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftocairoCli } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/constant-opacity.pdf", import.meta.url)));
for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  it(`${run.name} applies fill/stroke opacity and restores q/Q and Form state`, async () => {
    const files = new Map([["input.pdf", input]]);
    expect((await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).exitCode).toBe(0);
    const png = decodePng(files.get("page.png")!);
    for (const y of [20, 40, 50, 60, 70, 80, 90, 95]) {
      const colors = y === 50 ? [[255, 0, 0], [0, 0, 255], [255, 0, 0]]
        : y === 95 ? [[127, 0, 128], [191, 0, 64], [255, 0, 0]]
        : [[255, 0, 0], [128, 0, 128], [0, 0, 255]];
      for (const [column, x] of [20, 50, 80].entries()) {
        const pixel = png.data.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 3);
        colors[column]!.forEach((value, i) => expect(Math.abs(pixel[i]! - value)).toBeLessThanOrEqual(1));
      }
    }
  });
}
