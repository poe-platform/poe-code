import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
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
 it(`matches native sticker component analysis (${mode})`, async () => {
  const bytes = readFileSync(new URL("./fixtures/sticker.png", import.meta.url));
  const { result, files, fs } = await run(["input.png", "-fill", "black", "+opaque", "white", "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"], bytes);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + "  0: 512x512+0+0 255.1,255.1 140879 srgb(255,255,255)\n  1: 393x393+60+60 256.0,257.1 112948 srgb(0,0,0)\n  2: 103x103+205+190 256.0,241.0 8317 srgb(255,255,255)\n" });
  expect(files.has("null:")).toBe(false);
  await expect(fs.stat("/null:")).rejects.toThrow();
 });
 for (const fuzz of ["2%", "1310.7"]) it(`merges neighboring colors with fuzz ${fuzz} (${mode})`, async () => {
  const bytes = await sharp(Uint8Array.from([64,64,64,65,65,65,255,255,255]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
  const { result, files, fs } = await run(["input.png", "-fuzz", fuzz, "-define", "connected-components:verbose=true", "-connected-components", "4", "out.png"], bytes);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + "  0: 2x1+0+0 0.5,0.0 2 srgb(64.5,64.5,64.5)\n  1: 1x1+2+0 2.0,0.0 1 srgb(255,255,255)\n" });
  const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
  expect(Array.from(image.data16 ?? []).filter((_, i) => i % 4 === 0)).toEqual([0,0,1]);
 });
 it(`connects a chain of similar neighbors (${mode})`, async () => {
  const bytes = await sharp(Uint8Array.from([64,64,64,68,68,68,72,72,72]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
  const { result } = await run(["input.png", "-fuzz", "2%", "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"], bytes);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + "  0: 3x1+0+0 1.0,0.0 3 srgb(68,68,68)\n" });
 });
 for (const fuzz of ["0%", "2%"]) it(`combines both pixel tolerances at the color-distance boundary (${fuzz}, ${mode})`, async () => {
  const bytes = await sharp(Uint8Array.from([64,64,64,76,64,64,89,64,64]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
  const { result } = await run(["input.png", "-fuzz", fuzz, "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"], bytes);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + (fuzz === "2%"
   ? "  0: 2x1+0+0 0.5,0.0 2 srgb(70,64,64)\n  1: 1x1+2+0 2.0,0.0 1 srgb(89,64,64)\n"
   : "  0: 1x1+0+0 0.0,0.0 1 srgb(64,64,64)\n  1: 1x1+1+0 1.0,0.0 1 srgb(76,64,64)\n  2: 1x1+2+0 2.0,0.0 1 srgb(89,64,64)\n") });
 });
 it(`averages hidden colors of connected transparent pixels (${mode})`, async () => {
  const bytes = await sharp(Uint8Array.from([10,20,30,0,30,40,50,0]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
  const { result } = await run(["input.png", "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"], bytes);
  expect(result.stdout).toBe(header + "  0: 2x1+0+0 0.5,0.0 2 srgba(20,30,40,0)\n");
 });
 for (const connectivity of [4, 8]) it(`labels diagonal pixels with ${connectivity} connectivity (${mode})`, async () => {
  const bytes = await sharp(Uint8Array.from([0,0,0,255,255,255,255,255,255,0,0,0]), { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();
  const { result } = await run(["input.png", "-define", "connected-components:verbose=true", "-connected-components", String(connectivity), "null:"], bytes);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + (connectivity === 4
   ? "  0: 1x1+0+0 0.0,0.0 1 srgb(0,0,0)\n  1: 1x1+1+0 1.0,0.0 1 srgb(255,255,255)\n  2: 1x1+0+1 0.0,1.0 1 srgb(255,255,255)\n  3: 1x1+1+1 1.0,1.0 1 srgb(0,0,0)\n"
   : "  0: 2x2+0+0 0.5,0.5 2 srgb(0,0,0)\n  1: 2x2+0+0 0.5,0.5 2 srgb(255,255,255)\n") });
 });
 it(`preserves native Q16 stripe IDs in saved PNG (${mode})`, async () => {
  const bytes = await sharp(Uint8Array.from([255,0,0,255,0,0,0,0,255,0,128,0,0,128,0]), { raw: { width: 5, height: 1, channels: 3 } }).png().toBuffer();
  const { result, files, fs } = await run(["input.png", "-define", "connected-components:verbose=true", "-connected-components", "4", "out.png"], bytes);
  expect(result.exitCode).toBe(0);
  const output = mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
  expect(output[24]).toBe(16);
  const image = decodeImage(output);
  expect(Array.from(image.data16 ?? []).filter((_, i) => i % 4 === 0)).toEqual([0,0,1,2,2]);
 });
 for (const connectivity of [4, 8]) it(`renders component mean colors with ${connectivity} connectivity (${mode})`, async () => {
  const pixels = [255,0,0,255,255,0,0,255,0,0,255,255,0,128,0,255,0,128,0,255];
  const bytes = await sharp(Uint8Array.from(pixels), { raw: { width: 5, height: 1, channels: 4 } }).png().toBuffer();
  const { result, files, fs } = await run(["input.png", "-define", "connected-components:mean-color=true", "-define", "connected-components:verbose=true", "-connected-components", String(connectivity), "out.png"], bytes);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + "  0: 2x1+0+0 0.5,0.0 2 srgb(255,0,0)\n  2: 2x1+3+0 3.5,0.0 2 srgb(0,128,0)\n  1: 1x1+2+0 2.0,0.0 1 srgb(0,0,255)\n" });
  expect([...decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!).data]).toEqual(pixels);
 });
 it(`renders averaged hidden colors and preserves alpha (${mode})`, async () => {
  const bytes = await sharp(Uint8Array.from([10,20,30,0,30,40,50,0,80,90,100,128]), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
  const { result, files, fs } = await run(["input.png", "-define", "connected-components:mean-color=true", "-connected-components", "4", "out.png"], bytes);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
  expect([...decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!).data]).toEqual([20,30,40,0,20,30,40,0,80,90,100,128]);
 });
 for (const reset of [["-define", "connected-components:mean-color=false"], ["+define", "connected-components:mean-color"]]) it(`restores labels using ${reset.join(" ")} (${mode})`, async () => {
  const { result, files, fs } = await run(["xc:red", "-define", "connected-components:mean-color=true", ...reset, "-connected-components", "4", "out.png"]);
  expect(result.exitCode).toBe(0);
  expect([...decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!).data]).toEqual([0,0,0,255]);
 });
 it(`preserves all 1100 component IDs (${mode})`, async () => {
 for (const connectivity of [4, 8]) it(`merges regions below the area threshold (${connectivity}, ${mode})`, async () => {
  const bytes = await sharp(Uint8Array.from([255,0,0,255,0,0,0,0,255,0,128,0,0,128,0]), { raw: { width: 5, height: 1, channels: 3 } }).png().toBuffer();
  const { result, files, fs } = await run(["input.png", "-define", "connected-components:area-threshold=2", "-define", "connected-components:verbose=true", "-connected-components", String(connectivity), "out.png"], bytes);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + "  0: 3x1+0+0 1.0,0.0 3 srgb(255,0,0)\n  2: 2x1+3+0 3.5,0.0 2 srgb(0,128,0)\n" });
  const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
  expect(Array.from(image.data16 ?? []).filter((_, i) => i % 4 === 0)).toEqual([0,0,0,2,2]);
 });
 it(`keeps the largest region and its color when all regions are below threshold (${mode})`, async () => {
  const { result, files, fs } = await run(["xc:red", "xc:blue", "xc:green", "+append", "-define", "connected-components:area-threshold=9", "-define", "connected-components:mean-color=true", "-define", "connected-components:verbose=true", "-connected-components", "4", "out.png"]);
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: header + "  0: 3x1+0+0 1.0,0.0 3 srgb(255,0,0)\n" });
  expect([...decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!).data]).toEqual([255,0,0,255,255,0,0,255,255,0,0,255]);
 });
 for (const reset of [["-define", "connected-components:area-threshold=0"], ["+define", "connected-components:area-threshold"]]) it(`clears area threshold using ${reset.join(" ")} (${mode})`, async () => {
  const { result, files, fs } = await run(["xc:red", "xc:blue", "+append", "-define", "connected-components:area-threshold=9", ...reset, "-connected-components", "4", "out.png"]);
  expect(result.exitCode).toBe(0);
  const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
  expect(Array.from(image.data16 ?? []).filter((_, i) => i % 4 === 0)).toEqual([0,1]);
 });
  const bytes = await sharp(Uint8Array.from({ length: 1100 * 3 }, (_, i) => Math.floor(i / 3) % 2 * 255), { raw: { width: 1100, height: 1, channels: 3 } }).png().toBuffer();
  const { result, files, fs } = await run(["input.png", "-connected-components", "4", "out.png"], bytes);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
  expect(Array.from(image.data16 ?? []).filter((_, i) => i % 4 === 0)).toEqual(Array.from({ length: 1100 }, (_, i) => i));
 });
 it(`sorts statistics by area and writes labels (${mode})`, async () => {
  const bytes = await sharp(Uint8Array.from([255,0,0,0,0,255,0,0,255]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
  const { result, files, fs } = await run(["input.png", "-define", "connected-components:verbose=true", "-connected-components", "4", "out.png"], bytes);
  expect(result.stdout).toBe(header + "  1: 2x1+1+0 1.5,0.0 2 srgb(0,0,255)\n  0: 1x1+0+0 0.0,0.0 1 srgb(255,0,0)\n");
  expect(result.exitCode).toBe(0);
  expect([...decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!).data]).toEqual([0,0,0,255,0,0,0,255,0,0,0,255]);
 });
 for (const options of [["-connected-components", "6"], ["+connected-components", "4"], ["-connected-components", "4junk"], ["-define", "connected-components:verbose=true=bad", "-connected-components", "4"], ["-set", "option:connected-components:mean-color", "true", "-connected-components", "4"], ["-define", "connected-components:area-threshold=bad", "-connected-components", "4"]]) it(`rejects unsupported ${options.join(" ")} (${mode})`, async () => {
  const { result, files } = await run(["-size", "7x7", "xc:white", ...options, "out.png"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("connected-components");
  expect(files.has("out.png")).toBe(false);
 });
}

it("retains scratch and streams analysis without whole-file I/O", async () => {
 const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
 const filesystem = new Proxy(fs, { get(target, key) {
  if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
  const value = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
 } });
 const result = await runConvertCli(["-size", "1031x3", "xc:red", "-define", "connected-components:verbose=true", "-connected-components", "8", "null:"], { filesystem, cwd: "/", stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } });
 expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
 expect(new TextDecoder().decode(Buffer.concat(chunks))).toContain("1031x3+0+0 515.0,1.0 3093");
});
for (const retained of [false, true]) it(`cancels connected labeling (retained=${retained})`, async () => {
 const controller = new AbortController(), fs = new MemoryFileSystem();
 const timer = setTimeout(() => controller.abort(new Error("cancel labeling")), 10);
 try {
  const running = runConvertCli(["-size", "1024x1024", "xc:white", "-connected-components", "4", "out.png"], retained ? { filesystem: fs, cwd: "/" } : new Map(), undefined, controller.signal);
  if (retained) await expect(running).rejects.toThrow("cancel labeling");
  else expect(await running).toMatchObject({ exitCode: 1, stderr: "magick: cancel labeling\n" });
  await expect(fs.stat("/out.png")).rejects.toThrow();
 } finally { clearTimeout(timer); }
});
