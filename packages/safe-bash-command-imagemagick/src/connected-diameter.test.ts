import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
 async function run(threshold: string, connectivity = 8, reset = false, perimeter = false) {
  const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
  const args = ["-size", "14x10", "xc:black", "-fill", "white", "-draw", "rectangle 1,1 5,1 rectangle 8,1 10,3 rectangle 2,4 2,8 point 7,6 point 8,7", "-alpha", "off", "-define", `connected-components:diameter-threshold=${threshold}`, ...(reset ? ["+define", "connected-components:diameter-threshold"] : []), "-define", "connected-components:verbose=true", ...(perimeter ? ["-define", "connected-components:perimeter-threshold=0"] : []), "-connected-components", String(connectivity), "out.png"];
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  return { result, files, fs };
 }
 for (const connectivity of [4, 8]) it(`filters diameters in pixels and reports (${connectivity}, ${mode})`, async () => {
  const { result, files, fs } = await run("3-4", connectivity);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("mean-color diameter):\n");
  expect(result.stdout).toContain("  0: 14x10+0+0 6.6,4.8 121 srgb(0,0,0) 12\n");
  expect(result.stdout).toContain("  2: 3x3+8+1 9.0,2.0 9 srgb(255,255,255) 3\n");
  expect(result.stdout.trim().split("\n")).toHaveLength(5);
  const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
   expect(image.data16![(y * 14 + x) * 4]).toBe(x >= 1 && x <= 5 && y === 1 ? 1 : x >= 8 && x <= 10 && y >= 1 && y <= 3 ? 2 : x === 2 && y >= 4 && y <= 8 ? 3 : 0);
  }
 });
 it(`reports square, bar and diagonal diameters (${mode})`, async () => {
  const { result } = await run("0-100");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("9 srgb(255,255,255) 3\n");
  expect(result.stdout.split("5 srgb(255,255,255) 3\n")).toHaveLength(3);
  expect(result.stdout).toContain("2 srgb(255,255,255) 2\n");
 });
 it(`excludes the upper bound and supports a single lower bound (${mode})`, async () => {
  expect((await run("0-3")).result.stdout.trim().split("\n")).toHaveLength(3);
  expect((await run("3")).result.stdout.trim().split("\n")).toHaveLength(5);
 });
 it(`orders combined metrics like native ImageMagick (${mode})`, async () => {
  const { result } = await run("3-4", 8, false, true);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("mean-color perimeter diameter):\n");
  expect(result.stdout).toContain("9 srgb(255,255,255) 12 3\n");
 });
 it(`clears the metric and filtering (${mode})`, async () => {
  const { result } = await run("100", 8, true);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("diameter");
  expect(result.stdout.trim().split("\n")).toHaveLength(6);
 });
 for (const threshold of ["", "bad", "NaN", "Infinity", "-1", "1-2-3", "1=2"]) it(`rejects malformed diameter ${threshold} (${mode})`, async () => {
  const { result, files, fs } = await run(threshold);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Unsupported connected-components define");
  if (mode === "retained") await expect(fs.readFile("/out.png")).rejects.toThrow();
  else expect(files.has("out.png")).toBe(false);
 });
}
