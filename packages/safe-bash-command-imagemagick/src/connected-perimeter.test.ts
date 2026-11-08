import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const header = "Objects (id: bounding-box centroid area mean-color perimeter):\n";
for (const mode of ["buffered", "retained", "sync"] as const) {
 async function run(fixture: string, threshold: string, connectivity = 4, reset = false) {
  const bytes = readFileSync(new URL(`./fixtures/${fixture}.png`, import.meta.url));
  const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const args = ["input.png", "-define", `connected-components:perimeter-threshold=${threshold}`, ...(reset ? ["+define", "connected-components:perimeter-threshold"] : []), "-define", "connected-components:verbose=true", "-connected-components", String(connectivity), "out.png"];
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  return { result, files, fs };
 }
 it(`reports native edge-clamped stripe perimeters (${mode})`, async () => {
  const { result, files, fs } = await run("component-stripes", "0");
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + "  0: 2x1+0+0 0.5,0.0 2 srgb(255,0,0) 3\n  2: 2x1+3+0 3.5,0.0 2 srgb(0,128,0) 3\n  1: 1x1+2+0 2.0,0.0 1 srgb(0,0,255) 5\n" });
  const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
  expect(Array.from(image.data16!).filter((_, i) => i % 4 === 0)).toEqual([0,0,1,2,2]);
 });
 for (const connectivity of [4, 8]) it(`filters native diagonal perimeters (${connectivity}, ${mode})`, async () => {
  const { result, files, fs } = await run("component-perimeter-dots", "6", connectivity);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + (connectivity === 4
   ? "  0: 8x8+0+0 3.3,3.4 55 srgb(0,0,0) 18\n  3: 3x3+4+3 5.0,4.0 9 srgb(255,255,255) 12\n"
   : "  0: 8x8+0+0 3.3,3.5 53 srgb(0,0,0) 18\n  2: 3x3+4+3 5.0,4.0 9 srgb(255,255,255) 12\n  1: 2x2+1+1 1.5,1.5 2 srgb(255,255,255) 7\n") });
  const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
  expect(image.data16![9 * 4]).toBe(connectivity === 4 ? 0 : 1);
  expect(image.data16![18 * 4]).toBe(connectivity === 4 ? 0 : 1);
  expect(image.data16![28 * 4]).toBe(connectivity === 4 ? 3 : 2);
 });
 it(`keeps the background and original metric after range merging (${mode})`, async () => {
  const { result } = await run("component-perimeter-l", "8-100");
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + "  1: 5x4+0+0 2.0,1.5 20 srgb(0,0,0) 7\n" });
 });
 it(`excludes the upper perimeter bound (${mode})`, async () => {
  const { result } = await run("component-stripes", "0-3");
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + "  0: 5x1+0+0 2.0,0.0 5 srgb(255,0,0) 3\n" });
 });
 it(`clears the perimeter define and report column (${mode})`, async () => {
  const { result } = await run("component-stripes", "100", 4, true);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("perimeter");
  expect(result.stdout.trim().split("\n")).toHaveLength(4);
 });
 for (const threshold of ["", "bad", "NaN", "Infinity", "1-2-3", "1=2"]) it(`rejects malformed perimeter ${threshold} (${mode})`, async () => {
  const { result, files, fs } = await run("component-stripes", threshold);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Unsupported connected-components define");
  if (mode === "retained") await expect(fs.readFile("/out.png")).rejects.toThrow();
  else expect(files.has("out.png")).toBe(false);
 });
}
