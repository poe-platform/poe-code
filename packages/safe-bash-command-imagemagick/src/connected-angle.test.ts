import { expect, it } from "vitest";
import { decodeImage, encodePngImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const data = new Uint8Array(14 * 10 * 4);
for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
 const white = (y === 1 && x >= 1 && x <= 5) || (x >= 8 && x <= 10 && y >= 1 && y <= 3) || (x === 2 && y >= 4 && y <= 8) || (x === 7 && y === 6) || (x === 8 && y === 7);
 data.set(white ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * 14 + x) * 4);
}
const bytes = encodePngImage({ width: 14, height: 10, data, hasAlpha: false, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72 });
for (const mode of ["buffered", "retained", "sync"] as const) {
 for (const threshold of ["130-140", "30-60", undefined]) it(`uses the native major-axis direction for descending diagonals (${mode}, ${threshold})`, async () => {
  const input = new TextEncoder().encode("P2\n5 5\n255\n0 0 0 0 0\n0 0 0 255 0\n0 0 255 0 0\n0 255 0 0 0\n0 0 0 0 0\n");
  const files = new Map([["in.pgm", input], ["out.raw", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
  for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
  const args = ["in.pgm", "-define", "connected-components:verbose=true", ...(threshold ? ["-define", `connected-components:angle-threshold=${threshold}`] : []), "-connected-components", "8", "-depth", "16", "-endian", "MSB", "gray:out.raw"];
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const retained = threshold !== "30-60";
  expect(result.stdout.trimEnd().split("\n").slice(1).map(line => line.trim().split(":")[0])).toEqual(retained ? ["0", "1"] : ["0"]);
  if (threshold === "130-140") expect(result.stdout.trimEnd().split("\n").at(-1)).toContain(" 135");
  const output = mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
  expect([...output]).toEqual(Array.from({ length: 25 }, (_, i) => [0, retained && [8, 12, 16].includes(i) ? 1 : 0]).flat());
 });
 async function run(threshold: string, connectivity = 8, reset = false) {
  const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const args = ["input.png", "-define", `connected-components:angle-threshold=${threshold}`, ...(reset ? ["+define", "connected-components:angle-threshold"] : []), "-define", "connected-components:verbose=true", "-connected-components", String(connectivity), "out.png"];
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  const output = result.exitCode === 0 ? decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!) : undefined;
  return { result, labels: output && Array.from(output.data16!).filter((_, i) => i % 4 === 0) };
 }
 for (const connectivity of [4, 8]) it(`merges nonvertical labels and reports original native angles (${mode}, ${connectivity})`, async () => {
  const { result, labels } = await run("80-100", connectivity);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "Objects (id: bounding-box centroid area mean-color angle):\n  0: 14x10+0+0 6.7,4.4 135 srgb(0,0,0) 1.13001\n  3: 1x5+2+4 2.0,6.0 5 srgb(255,255,255) 90\n" });
  expect(labels).toEqual(Array.from({ length: 140 }, (_, i) => i % 14 === 2 && Math.floor(i / 14) >= 4 && Math.floor(i / 14) <= 8 ? 3 : 0));
 });
 it(`reports horizontal, square and diagonal angles and excludes the upper bound (${mode})`, async () => {
  const { result, labels } = await run("0-90");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("9 srgb(255,255,255) 0\n");
  expect(result.stdout).toContain("5 srgb(255,255,255) 0\n");
  expect(result.stdout).toContain("2 srgb(255,255,255) 45\n");
  expect([0, 15, 22, 58, 91].map(i => labels![i])).toEqual([0, 1, 2, 0, 4]);
 });
 it(`supports a single lower bound and clearing the define (${mode})`, async () => {
  expect((await run("80")).labels).toEqual((await run("80-100")).labels);
  const { result, labels } = await run("80", 8, true);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("angle");
  expect([0, 15, 22, 58, 91].map(i => labels![i])).toEqual([0, 1, 2, 3, 4]);
 });
 for (const threshold of ["", "bad", "NaN", "Infinity", "1-2-3", "1=2"]) it(`rejects malformed angle ${threshold} (${mode})`, async () => {
  const { result } = await run(threshold);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Unsupported connected-components define");
 });
}
