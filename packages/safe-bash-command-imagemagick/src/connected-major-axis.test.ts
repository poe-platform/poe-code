import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
 async function run(threshold: string, connectivity = 8, reset = false) {
  const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
  const args = ["-size", "14x10", "xc:black", "-fill", "white", "-draw", "rectangle 1,1 5,1 rectangle 8,1 10,3 rectangle 2,4 2,8 point 7,6 point 8,7", "-alpha", "off", "-define", `connected-components:major-axis-threshold=${threshold}`, ...(reset ? ["+define", "connected-components:major-axis-threshold"] : []), "-define", "connected-components:verbose=true", "-connected-components", String(connectivity), "out.png"];
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  return { result, files, fs };
 }
 for (const connectivity of [4, 8]) it(`filters major axes in pixels and reports (${connectivity}, ${mode})`, async () => {
  const { result, files, fs } = await run("2-3", connectivity);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "Objects (id: bounding-box centroid area mean-color major-axis):\n  0: 14x10+0+0 6.8,4.6 130 srgb(0,0,0) 8.27294\n  1: 5x1+1+1 3.0,1.0 5 srgb(255,255,255) 2.82843\n  3: 1x5+2+4 2.0,6.0 5 srgb(255,255,255) 2.82843\n" });
  const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
   expect(image.data16![(y * 14 + x) * 4]).toBe(y === 1 && x >= 1 && x <= 5 ? 1 : x === 2 && y >= 4 && y <= 8 ? 3 : 0);
  }
 });
 it(`reports square and diagonal moments (${mode})`, async () => {
  const { result } = await run("0-100");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("9 srgb(255,255,255) 1.63299\n");
  expect(result.stdout).toContain("2 srgb(255,255,255) 1.41421\n");
 });
 it(`excludes the upper bound and supports a single lower bound (${mode})`, async () => {
  expect((await run("0-0")).result.stdout.trim().split("\n")).toHaveLength(2);
  expect((await run("2")).result.stdout.trim().split("\n")).toHaveLength(4);
 });
 it(`clears the metric and filtering (${mode})`, async () => {
  const { result } = await run("100", 8, true);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("major-axis");
  expect(result.stdout.trim().split("\n")).toHaveLength(6);
 });
 for (const threshold of ["", "bad", "NaN", "Infinity", "-1", "1-2-3", "1=2"]) it(`rejects malformed major axis ${threshold} (${mode})`, async () => {
  const { result, files, fs } = await run(threshold);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Unsupported connected-components define");
  if (mode === "retained") await expect(fs.readFile("/out.png")).rejects.toThrow();
  else expect(files.has("out.png")).toBe(false);
 });
}
