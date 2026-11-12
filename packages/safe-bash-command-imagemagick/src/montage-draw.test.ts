import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const unchanged = "000000 000000 000000 0000ff 0000ff 0000ff";
const point = "000000 ff0000 000000 0000ff ff0000 0000ff";
const rectangle = "ff0000 ff0000 000000 ff0000 ff0000 0000ff";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { inputs: ["(", "xc:black", "-fill", "red", "-draw", "point 1,1", ")", "xc:blue"], rows: [unchanged, "000000 ff0000 000000 0000ff 0000ff 0000ff", unchanged] },
  { inputs: ["xc:black", "xc:blue"], rows: [unchanged, unchanged, unchanged] },
  { inputs: ["xc:black", "xc:blue", "-fill", "red", "-draw", "point 1,1"], rows: [unchanged, point, unchanged] },
  { inputs: ["xc:black", "-fill", "red", "-draw", "point 1,1", "xc:blue"], rows: [unchanged, point, unchanged] },
  { inputs: ["xc:black", "xc:blue", "-fill", "red", "-draw", "rectangle 0,0 1,1"], rows: [rectangle, rectangle, unchanged] },
  { inputs: ["xc:black", "-fill", "red", "-draw", "rectangle 0,0 1,1", "xc:blue"], rows: [rectangle, rectangle, unchanged] }
])(`draws native montage primitives in tile coordinates via ${mode}: $inputs`, async ({ inputs, rows }) => {
  const args = ["-size", "3x3", ...inputs, "-tile", "2x1", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
  const fs = new MemoryFileSystem();
  let output: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    output = Buffer.concat(stdout);
  } else {
    const files = new Map<string, Uint8Array>();
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  expect(Buffer.from(output)).toEqual(Buffer.concat([
    Buffer.from("P6\n6 3\n255\n"), Buffer.from(rows.join("").split(" ").join(""), "hex")
  ]));
});

for (const mode of ["sync", "buffered", "retained"] as const)
it.each([
  { drawing: ["-draw"], error: "missing argument for -draw" },
  { drawing: ["-draw", "rectangle 1,1"], error: "improper image header" }
])(`rejects invalid montage drawing without overwriting output via ${mode}: $drawing`, async ({ drawing, error }) => {
  const args = ["-size", "3x3", "xc:black", ...drawing, ...(drawing.length === 1 ? [] : ["out.ppm"])];
  const original = new TextEncoder().encode("keep");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/out.ppm", original);
  const files = new Map([["out.ppm", original]]);
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(error);
  expect(result.stdoutBytes?.byteLength ?? 0).toBe(0);
  expect(mode === "retained" ? await fs.readFile("/out.ppm") : files.get("out.ppm")).toEqual(original);
});
