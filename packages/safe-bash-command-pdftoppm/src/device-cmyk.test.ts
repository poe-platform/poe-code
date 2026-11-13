import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { runPdftocairoCli, runPdftoppmCli } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("../../pdf-ast/src/fixtures/device-cmyk.pdf", import.meta.url)));
const red = [255, 46, 23], white = [255, 255, 255], black = [44, 46, 53];
const cyan = [0, 185, 242], magenta = [251, 49, 153], yellow = [255, 235, 61];
// DeviceCMYK uses the existing PDF.js conversion, including process black.
const colors = [red, white, black, [6, 6, 12], [32, 28, 21], red, white, red,
  magenta, [0, 0, 0], yellow, [255, 0, 0], red, white, red];

it.each([runPdftoppmCli, runPdftocairoCli])("renders DeviceCMYK fill/stroke and restores colors and color spaces (%#)", async run => {
  const files = new Map([["in.pdf", input]]);
  const result = await run(["-png", "-r", "72", "-singlefile", "in.pdf", "out"], files);
  expect(result.exitCode, result.stderr).toBe(0);
  const bitmap = decodePng(files.get("out.png")!);
  expect([bitmap.width, bitmap.height]).toEqual([300, 40]);
  for (const [i, color] of colors.entries()) {
    for (const y of [10, 30]) {
      const expected = y === 30 && (i === 5 || i === 7) ? cyan : y === 30 && i === 6 ? black : color;
      const at = (y * bitmap.width + i * 20 + 10) * 4;
      expect(Array.from(bitmap.data.subarray(at, at + 4)), `swatch ${i}, row ${y}`).toEqual([...expected, 255]);
    }
  }
});
