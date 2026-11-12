import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { options: [] },
  { options: ["-synchronize"] },
  { options: ["+synchronize"] },
  { options: ["-synchronize", "+synchronize"] },
  { options: ["+synchronize", "-synchronize"] },
])(`writes a complete montage contact sheet via ${mode}: $options`, async ({ options }) => {
  const args = [...options, "xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", "-depth", "8", "/sheet.ppm"];
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(chunk); } },
      stderr: { async write(chunk) { stderr.push(chunk); } }
    });
    expect({ exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() })
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
  }
  const output = mode === "sync" || mode === "buffered" ? files.get("/sheet.ppm")! : await fs.readFile("/sheet.ppm");
  expect(Buffer.from(output).toString("hex")).toBe("50360a3220310a3235350aff00000000ff");
});
