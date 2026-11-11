import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P2\n5 4\n255\n0 0 0 0 255\n0 80 0 255 0\n0 0 80 0 0\n140 140 140 0 220\n");
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
 async function run(threshold: string, reset = false) {
  const files = new Map([["in.pgm", input], ["out.raw", new TextEncoder().encode("KEEP")]]);
  const fs = new MemoryFileSystem();
  for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
  const args = ["in.pgm", "-define", "connected-components:verbose=true", "-define", `connected-components:area-threshold=${threshold}`, ...(reset ? ["+define", "connected-components:area-threshold"] : []), "-connected-components", "4", "-depth", "16", "-endian", "MSB", "gray:out.raw"];
  if (mode === "command") {
   const argumentValues = createCommandArguments(args);
   let stdout = "", stderr = "";
   const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   });
   return { result: { exitCode: result.exitCode, stdout, stderr }, bytes: await fs.readFile("/out.raw") };
  }
  const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  return { result, bytes: mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")! };
 }
 for (const [threshold, ids, hex] of [
  ["1-2", [0, 3, 1, 2, 5, 7], "00000000000000000001000000020000000300030000000000050003000300000000000000030007"],
  ["2-4", [0, 6], "00000000000000000000000000000000000000000000000000000000000000060006000600000000"],
  ["2", [0, 4, 6], "00000000000000000000000000000000000000040000000000000004000400060006000600040004"]
 ] as const) it(`matches native area ${threshold} report order and labels (${mode})`, async () => {
  const { result, bytes } = await run(threshold);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim().split("\n").slice(1).map(line => Number(line.split(":")[0]!.trim()))).toEqual(ids);
  expect(Buffer.from(bytes).toString("hex")).toBe(hex);
 });
 it(`preserves scientific-notation lower bounds (${mode})`, async () => {
  expect(await run("1e-2")).toEqual(await run("0.01"));
 });
 it(`clears the area range (${mode})`, async () => {
  expect(await run("2-4", true)).toEqual(await run("0"));
 });
 for (const threshold of ["", "bad", "NaN", "Infinity", "-1", "1-", "1-2-3", "1=2"]) it(`rejects invalid area ${threshold} without overwriting output (${mode})`, async () => {
  const { result, bytes } = await run(threshold);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Unsupported connected-components define");
  expect(new TextDecoder().decode(bytes)).toBe("KEEP");
 });
}
