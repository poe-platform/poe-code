import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const red = "xc:red=>red[0] XC 1x1 1x1+0+0 16-bit sRGB 0.000u 0:00.000\n";
const blue = "xc:blue=>blue[0] XC 1x1 1x1+0+0 16-bit sRGB 0.000u 0:00.000\n";
const ppm = Buffer.from("50360a3220310a3235350aff00000000ff", "hex");

// Native ImageMagick 7.1.2-35 Q16-HDRI, with elapsed times normalized to zero.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  it.each([
    { name: "records before the formatted sheet", args: ["xc:red", "xc:blue", "-identify", "-format", "%w,%h:%[fx:1/3]\\n", "info:"], stdout: red + blue + "2,1:0.333333\n" },
    { name: "records with a named PPM destination", args: ["-identify", "xc:red", "xc:blue", "-depth", "8", "/sheet.ppm"], stdout: red + blue, file: "/sheet.ppm", bytes: ppm },
    { name: "no records without identify", args: ["xc:red", "xc:blue", "-format", "%w,%h:%[fx:1/3]\\n", "info:"], stdout: "2,1:0.333333\n" },
    { name: "records stay on stdout with named info output", args: ["xc:red", "xc:blue", "-identify", "-format", "%wx%h\\n", "info:/sheet.txt"], stdout: red + blue, file: "/sheet.txt", bytes: Buffer.from("2x1\n") },
    { name: "identify only the preceding group", args: ["xc:red", "-identify", "xc:blue", "-format", "%wx%h\\n", "info:"], stdout: red.replace("[0]", "") + "2x1\n" },
    { name: "use the format active at identify", args: ["xc:red", "xc:blue", "-format", "%w!", "-identify", "-format", "%wx%h\\n", "info:"], stdout: "1!1!2x1\n" },
    { name: "records precede binary stdout", args: ["xc:red", "xc:blue", "-identify", "-depth", "8", "ppm:-"], stdout: red + blue, binary: ppm }
  ])(`${mode}: $name`, async ({ args, stdout, file, bytes, binary }) => {
    const argv = ["-tile", "2x1", "-geometry", "+0+0", ...args];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    let actual: Buffer;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...argv] : argv);
      const output: Uint8Array[] = [], errors: Uint8Array[] = [];
      const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { output.push(chunk.slice()); } },
        stderr: { async write(chunk) { errors.push(chunk.slice()); } }
      });
      expect(Buffer.concat(errors).toString()).toBe("");
      expect(result.exitCode).toBe(0);
      actual = Buffer.concat(output);
    } else {
      const result = mode === "sync" ? runMontageCliSync(argv, files)
        : await runMontageCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      actual = Buffer.from(result.stdoutBytes ?? result.stdout);
    }
    expect(actual).toEqual(Buffer.concat([Buffer.from(stdout), binary ?? Buffer.alloc(0)]));
    if (file) expect(Buffer.from(mode === "buffered" || mode === "sync" ? files.get(file)! : await fs.readFile(file))).toEqual(bytes);
  });
}
