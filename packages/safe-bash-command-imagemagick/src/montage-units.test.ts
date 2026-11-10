import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { inputs: ["xc:red"], physical: [] },
    { inputs: ["-units", "PixelsPerInch", "xc:red"], physical: [] },
    { inputs: ["-units", "PixelsPerInch", "-density", "300x150", "xc:red"], physical: [[11811, 5905, 1]] },
    { inputs: ["-units", "PixelsPerCentimeter", "-density", "300x150", "xc:red"], physical: [[30000, 15000, 1]] },
    { inputs: ["-units", "PixelsPerInch", "+units", "-density", "300x150", "xc:red"], physical: [[300, 150, 0]] },
    { inputs: ["xc:red", "+units"], physical: [] },
    { inputs: ["-density", "300x150", "-units", "pixelspercentimeter", "xc:red"], physical: [[30000, 15000, 1]] },
    { inputs: ["-units", "Undefined", "-density", "300x150", "xc:red"], physical: [[300, 150, 0]] }
  ])(`writes montage resolution via ${mode}: $inputs`, async ({ inputs, physical }) => {
    const args = ["-geometry", "1x1+0+0", "-tile", "x1", ...inputs, "png:-"];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      output = Buffer.concat(stdout);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const png = new DataView(output.buffer, output.byteOffset, output.byteLength);
    const chunks = [];
    for (let offset = 8; offset < output.length; offset += 12 + png.getUint32(offset)) {
      if (new TextDecoder().decode(output.subarray(offset + 4, offset + 8)) === "pHYs") {
        chunks.push([png.getUint32(offset + 8), png.getUint32(offset + 12), png.getUint8(offset + 16)]);
      }
    }
    expect(chunks).toEqual(physical);
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([1, 1]);
    expect([...image.data]).toEqual([255, 0, 0, 255]);
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    { options: ["-units"], error: "missing argument for -units" },
    { options: ["-units", "invalid", "/sheet.png"], error: "unrecognized units type 'invalid'" }
  ])(`rejects invalid montage units via ${mode}: $options`, async ({ options, error }) => {
    const original = new TextEncoder().encode("original");
    const files = new Map([["/sheet.png", original]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/sheet.png", original);
    const args = ["xc:red", ...options];
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
    expect(mode === "retained" ? await filesystem.readFile("/sheet.png") : files.get("/sheet.png")).toEqual(original);
  });
}
