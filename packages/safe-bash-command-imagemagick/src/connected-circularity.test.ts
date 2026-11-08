import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
 async function run(threshold: string, connectivity = 8, reset = false) {
  const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
  const args = ["-size", "14x10", "xc:black", "-fill", "white", "-draw", "rectangle 1,1 5,1 rectangle 8,1 10,3 rectangle 2,4 2,8 point 7,6 point 8,7", "-alpha", "off", "-define", `connected-components:circularity-threshold=${threshold}`, ...(reset ? ["+define", "connected-components:circularity-threshold"] : []), "-define", "connected-components:verbose=true", "-connected-components", String(connectivity), "out.png"];
  if (mode === "command") {
   const argumentValues = createCommandArguments(args);
   let stdout = "", stderr = "";
   const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: (async function* () {})(), fs,
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
    registerCleanup() {},
   } as unknown as CommandContext);
   return { result: { ...result, stdout, stderr }, files, fs };
  }
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  return { result, files, fs };
 }
 for (const connectivity of [4, 8]) it(`filters circularity in pixels and reports (${connectivity}, ${mode})`, async () => {
  const { result, files, fs } = await run("0.7-0.8", connectivity);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("mean-color circularity):\n");
  expect(result.stdout).toContain(connectivity === 8 ? "  0: 14x10+0+0 6.3,4.7 131 srgb(0,0,0) 0.934624\n" : "  0: 14x10+0+0 6.3,4.6 129 srgb(0,0,0) 0.934624\n");
  expect(result.stdout).toContain("  2: 3x3+8+1 9.0,2.0 9 srgb(255,255,255) ");
  expect(Number(result.stdout.split("\n").find(row => row.startsWith("  2:"))!.split(" ").at(-1))).toBeCloseTo(0.785398, 6);
  expect(result.stdout.trim().split("\n")).toHaveLength(connectivity === 8 ? 3 : 5);
  const image = decodeImage((mode === "retained" || mode === "command") ? await fs.readFile("/out.png") : files.get("out.png")!);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
   expect(image.data16![(y * 14 + x) * 4]).toBe(x >= 8 && x <= 10 && y >= 1 && y <= 3 ? 2 : connectivity === 4 && x === 7 && y === 6 ? 4 : connectivity === 4 && x === 8 && y === 7 ? 5 : 0);
  }
 });
 it(`reports square, bars and diagonal circularity (${mode})`, async () => {
  const { result } = await run("0-2");
  expect(result.exitCode).toBe(0);
  expect(Number(result.stdout.split("\n").find(row => row.startsWith("  2:"))!.split(" ").at(-1))).toBeCloseTo(0.785398, 6);
  expect(result.stdout.split("5 srgb(255,255,255) 0.436332\n")).toHaveLength(3);
  expect(result.stdout).toContain("2 srgb(255,255,255) 0.512913\n");
 });
 it(`excludes the upper bound and supports a single lower bound (${mode})`, async () => {
  expect((await run("0-0")).result.stdout.trim().split("\n")).toHaveLength(2);
  expect((await run("0.7")).result.stdout.trim().split("\n")).toHaveLength(3);
 });
 it(`clears the metric and filtering (${mode})`, async () => {
  const { result } = await run("100", 8, true);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("circularity");
  expect(result.stdout.trim().split("\n")).toHaveLength(6);
 });
 for (const threshold of ["", "bad", "NaN", "Infinity", "-1", "1-2-3", "1=2"]) it(`rejects malformed circularity ${threshold} (${mode})`, async () => {
  const { result, files, fs } = await run(threshold);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Unsupported connected-components define");
  if (mode === "retained" || mode === "command") await expect(fs.readFile("/out.png")).rejects.toThrow();
  else expect(files.has("out.png")).toBe(false);
 });
}
