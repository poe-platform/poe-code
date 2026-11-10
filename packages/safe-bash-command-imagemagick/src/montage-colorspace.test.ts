import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Complete RGB8/PGM8 output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-colorspace", "Gray"], format: "rgb", hex: "363636b6b6b6121212" },
    { inputs: ["-colorspace", "Gray", "xc:red", "xc:lime", "xc:blue"], format: "rgb", hex: "363636b6b6b6121212" },
    { inputs: ["xc:red", "-colorspace", "Gray", "xc:blue"], format: "rgb", hex: "363636121212" },
    { inputs: ["xc:red", "-colorspace", "Gray", "-colorspace", "Gray"], format: "rgb", hex: "363636" },
    { inputs: ["xc:red", "(", "xc:lime", "-colorspace", "Gray", ")", "xc:blue"], format: "rgb", hex: "ff0000b6b6b60000ff" },
    { inputs: ["xc:red", "xc:lime", "xc:blue"], format: "pgm", hex: "50350a3320310a3235350a36b612" },
    { inputs: ["xc:red", "xc:lime", "xc:blue"], format: "rgb", hex: "ff000000ff000000ff" },
  ])(`${mode}: converts montage input colors before $format output: $inputs`, async ({ inputs, format, hex }) => {
    const args = ["-tile", "x1", "-geometry", "1x1+0+0", ...inputs, "-depth", "8", `${format}:-`];
    const fs = new MemoryFileSystem();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [], stderr: unknown[] = [];
      const context: CommandContext = {
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute(context);
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

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    { args: ["xc:red", "-colorspace"], error: "missing argument for -colorspace" },
    { args: ["xc:red", "-colorspace", "invalid", "out.rgb"], error: "unrecognized colorspace 'invalid'" },
  ])(`${mode}: rejects invalid montage colorspace without overwriting output: $args`, async ({ args, error }) => {
    const original = new Uint8Array([1, 2, 3]);
    const files = new Map([["out.rgb", original]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out.rgb", original);
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
    expect(mode === "retained" ? await fs.readFile("/out.rgb") : files.get("out.rgb")).toEqual(original);
  });
}
