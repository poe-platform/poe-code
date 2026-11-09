import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const header = "Objects (id: bounding-box centroid area mean-color):\n";
for (const mode of ["buffered", "retained", "sync"] as const) {
 async function run(args: string[], bytes?: Uint8Array) {
  const files = new Map(bytes ? [["input.png", bytes]] : []), fs = new MemoryFileSystem();
  if (bytes) await fs.writeFile("/input.png", bytes);
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  return { result, files, fs };
 }
 for (const [space, colors, expected] of [
  ["HSL", ["red", "blue"], ["hsl(0,100%,50%)", "hsl(240,100%,50%)"]],
  ["HSB", ["red", "blue"], ["hsb(0,100%,100%)", "hsb(240,100%,100%)"]],
  ["HSV", ["red", "blue"], ["hsv(0,100%,100%)", "hsv(240,100%,100%)"]],
  ["XYZ", ["red", "blue"], ["xyz(41.2396,21.2586,1.92972)", "xyz(18.0493,7.22005,95.0497)"]],
  ["RGB", ["red", "blue"], ["rgb(255,0,0)", "rgb(0,0,255)"]],
  ["Gray", ["black", "white"], ["gray(0)", "gray(255)"]],
  ["sRGB", ["red", "blue"], ["srgb(255,0,0)", "srgb(0,0,255)"]],
 ] as const) it(`reports component means in ${space} (${mode})`, async () => {
  const { result } = await run([`xc:${colors[0]}`, `xc:${colors[1]}`, "+append", "-colorspace", space, "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"]);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + `  0: 1x1+0+0 0.0,0.0 1 ${expected[0]}\n  1: 1x1+1+0 1.0,0.0 1 ${expected[1]}\n` });
 });
 for (const [space, colors, mean] of [
  ["HSL", ["red", "blue"], "hsl(120,100%,50%)"],
  ["Gray", ["black", "white"], "gray(50%)"],
 ] as const) it(`averages component channels in ${space} (${mode})`, async () => {
  const { result } = await run([`xc:${colors[0]}`, `xc:${colors[1]}`, "+append", "-colorspace", space, "-fuzz", "100%", "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"]);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + `  0: 2x1+0+0 0.5,0.0 2 ${mean}\n` });
 });
 it(`reports decoded grayscale input (${mode})`, async () => {
  const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: "white" } }).greyscale().png().toBuffer();
  const { result } = await run(["input.png", "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"], bytes);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + "  0: 2x1+0+0 0.5,0.0 2 gray(255)\n" });
 });
}
