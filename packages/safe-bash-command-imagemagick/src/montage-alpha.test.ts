import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI RGBA8 output for a half-transparent red tile.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { inputs: ["-alpha", "off", "xc:#ff000080"], hex: "ff0000ff" },
    { inputs: ["xc:#ff000080", "-alpha", "off"], hex: "ff0000ff" },
    { inputs: ["-alpha", "remove", "xc:#ff000080"], hex: "80007fff" },
    { inputs: ["xc:#ff000080", "-alpha", "remove"], hex: "80007fff" },
    { inputs: ["xc:#ff000080"], hex: "80007fff" },
    { inputs: ["xc:#ff000080", "-alpha", "OFF", "-rotate", "90"], hex: "ff0000ff" },
    { inputs: ["xc:#ff000080", "-alpha", "remove", "-background", "lime"], hex: "80007fff" },
    { inputs: ["xc:#ff000080", "(", "xc:#ff000080", "-alpha", "off", ")"], hex: "80007fffff0000ff" },
    { inputs: ["xc:#ff000080", "-alpha", "remove", "-alpha", "off"], hex: "80007fff" },
    { inputs: ["xc:#ff000080", "-alpha", "off", "-alpha", "remove"], hex: "ff0000ff" },
  ])(`${mode}: applies montage alpha to input tiles: $inputs`, async ({ inputs, hex }) => {
    const args = ["-geometry", "1x1+0+0", "-tile", "x1", "-background", "blue", ...inputs, "-depth", "8", "rgba:-"];
    const fs = new MemoryFileSystem();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      const stderr: unknown[] = [];
      const context: CommandContext = {
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const result = await command.execute(context);
      expect(stderr).toEqual([]);
      expect(result.exitCode).toBe(0);
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });
}

it.each([
  { args: ["xc:red", "-alpha"], error: "missing argument for -alpha" },
  { args: ["xc:red", "-alpha", "invalid", "out.png"], error: "unsupported alpha mode 'invalid'" },
])("rejects invalid montage alpha before writing output: $args", ({ args, error }) => {
  const files = new Map<string, Uint8Array>();
  expect(runMontageCliSync(args, files)).toMatchObject({ exitCode: 1, stderr: `montage: ${error}\n` });
  expect(files.size).toBe(0);
});
