import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
 async function run(threshold: string, connectivity = 8, reset = false) {
  const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
  const args = ["-size", "14x10", "xc:black", "-fill", "white", "-draw", "rectangle 1,1 5,1 rectangle 8,1 10,3 rectangle 2,4 2,8 point 7,6 point 8,7", "-alpha", "off", "-define", `connected-components:eccentricity-threshold=${threshold}`, ...(reset ? ["+define", "connected-components:eccentricity-threshold"] : []), "-define", "connected-components:verbose=true", "-connected-components", String(connectivity), "out.png"];
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  return { result, files, fs };
 }
 for (const connectivity of [4, 8]) it(`filters eccentricity in pixels and reports (${connectivity}, ${mode})`, async () => {
  const { result, files, fs } = await run("0-0.1", connectivity);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("mean-color eccentricity):\n");
  expect(result.stdout).toContain("  0: 14x10+0+0 6.3,4.7 131 srgb(0,0,0) 0.715238\n");
  expect(result.stdout).toContain("  2: 3x3+8+1 9.0,2.0 9 srgb(255,255,255) ");
  expect(Number(result.stdout.split("\n").find(row => row.startsWith("  2:"))!.split(" ").at(-1))).toBeCloseTo(0, 6);
  expect(result.stdout.trim().split("\n")).toHaveLength(3);
  const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
   expect(image.data16![(y * 14 + x) * 4]).toBe(x >= 8 && x <= 10 && y >= 1 && y <= 3 ? 2 : 0);
  }
 });
 it(`reports square and diagonal moments (${mode})`, async () => {
  const { result } = await run("0-2");
  expect(result.exitCode).toBe(0);
  expect(Number(result.stdout.split("\n").find(row => row.startsWith("  2:"))!.split(" ").at(-1))).toBeCloseTo(0, 6);
  expect(result.stdout.split("5 srgb(255,255,255) 1\n")).toHaveLength(3);
  expect(result.stdout).toContain("2 srgb(255,255,255) 1\n");
 });
 it(`excludes the upper bound and supports a single lower bound (${mode})`, async () => {
  expect((await run("0-0")).result.stdout.trim().split("\n")).toHaveLength(2);
  expect((await run("1")).result.stdout.trim().split("\n")).toHaveLength(5);
 });
 it(`clears the metric and filtering (${mode})`, async () => {
  const { result } = await run("100", 8, true);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("eccentricity");
  expect(result.stdout.trim().split("\n")).toHaveLength(6);
 });
 for (const threshold of ["", "bad", "NaN", "Infinity", "-1", "1-2-3", "1=2"]) it(`rejects malformed eccentricity ${threshold} (${mode})`, async () => {
  const { result, files, fs } = await run(threshold);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Unsupported connected-components define");
  if (mode === "retained") await expect(fs.readFile("/out.png")).rejects.toThrow();
  else expect(files.has("out.png")).toBe(false);
 });
}
