import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { decodeImage } from "@poe-code/image-ast";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 truncates fractional pixels per meter.
const input = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAEklEQVR4nGO4wyX3HxkzEBQAAGT5GCWP9zVLAAAAAElFTkSuQmCC", "base64"));

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { density: "72", expected: [2834, 2834, 1] },
    { density: "96", expected: [3779, 3779, 1] },
    { density: "150x100", expected: [5905, 3937, 1] },
    { density: "300x150", expected: [11811, 5905, 1] }
  ])(`matches native PNG inch density $density (${mode})`, async ({ density, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
    await fs.writeFile("/input.png", input);
    const args = ["/input.png", "-units", "PixelsPerInch", "-density", density, "PNG32:/output.png"];
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
      args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} } })
      : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "retained" || mode === "command" ? await fs.readFile("/output.png") : files.get("/output.png")!;
    const png = new DataView(output.buffer, output.byteOffset, output.byteLength);
    const physical = [];
    for (let offset = 8; offset < output.length; offset += 12 + png.getUint32(offset)) {
      if (new TextDecoder().decode(output.subarray(offset + 4, offset + 8)) === "pHYs") {
        expect(png.getUint32(offset)).toBe(9);
        physical.push([png.getUint32(offset + 8), png.getUint32(offset + 12), png.getUint8(offset + 16)]);
      }
    }
    expect(physical).toEqual([expected]);
    const decoded = decodeImage(input);
    expect(decodeImage(output)).toMatchObject({ width: decoded.width, height: decoded.height, data: decoded.data });
  });
}
