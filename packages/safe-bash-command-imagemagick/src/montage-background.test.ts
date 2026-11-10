import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { inputs: ["xc:none"], hex: "ffffffff" },
  { inputs: ["+background", "xc:none"], hex: "ffffffff" },
  { inputs: ["-background", "blue", "xc:none"], hex: "0000ffff" },
  { inputs: ["-background", "blue", "+background", "xc:none"], hex: "0000ffff" },
  { inputs: ["-background", "blue", "xc:none", "+background"], hex: "0000ffff" },
  { inputs: ["-background", "blue", "+background", "+background", "xc:none"], hex: "0000ffff" },
  { inputs: ["+background", "-background", "red", "xc:none"], hex: "ff0000ff" },
])(`preserves the montage sheet background via ${mode}: $inputs`, async ({ inputs, hex }) => {
  const args = ["-geometry", "1x1+0+0", "-tile", "x1", ...inputs, "png:-"];
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
    const result = mode === "sync" ? runMontageCliSync(args, new Map())
      : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const image = decodeImage(output);
  expect([image.width, image.height]).toEqual([1, 1]);
  expect(Buffer.from(image.data).toString("hex")).toBe(hex);
});
