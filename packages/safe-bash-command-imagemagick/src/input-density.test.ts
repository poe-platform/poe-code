import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const tagged of [false, true]) {
    for (const placement of ["before", "after"]) {
      for (const [name, options, physical] of [
        ["unchanged", [], tagged ? [6000, 7500, 1] : undefined],
        ["density", ["-density", "150x100"], tagged ? [15000, 10000, 1] : [150, 100, 0]],
        ["inch", ["-units", "PixelsPerInch", "-density", "150x100"], [5905, 3937, 1]],
        ["centimeter", ["-density", "150x100", "-units", "PixelsPerCentimeter"], [15000, 10000, 1]],
        ["scalar", ["-units", "Undefined", "-density", "96"], [96, 96, 0]],
      ] as const) {
        it(`preserves explicit PNG density ${placement} input: ${name} (${mode}, tagged=${tagged})`, async () => {
          const pixels = Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 128);
          const input = encodeImage({ width: 2, height: 1, data: pixels, format: "png", space: "srgb",
            channels: 4, depth: "uchar", density: 72, hasAlpha: true,
            ...(tagged ? { resolution: { x: 6000, y: 7500, unit: "meter" as const } } : {}),
          }, { format: "png" }).data;
          const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
          await fs.writeFile("/input.png", input);
          const args = [...(placement === "before" ? [...options, "/input.png"] : ["/input.png", ...options]), "PNG32:/output.png"];
          const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
            args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} } })
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
          expect(result).toMatchObject({ exitCode: 0 });
          const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
          const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
          let actual: number[] | undefined;
          for (let offset = 8; offset + 12 <= output.length; offset += view.getUint32(offset) + 12) {
            if (view.getUint32(offset + 4) === 0x70485973) {
              actual = [view.getUint32(offset + 8), view.getUint32(offset + 12), output[offset + 16]!];
            }
          }
          expect(actual).toEqual(physical);
          expect(decodeImage(output)).toMatchObject({ width: 2, height: 1, data: pixels });
        });
      }
    }
  }
}

for (const mode of ["buffered", "retained"]) {
  it(`uses the density active at each subsequent input (${mode})`, async () => {
    const input = encodeImage({ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255),
      format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
    }, { format: "png" }).data;
    const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
    await fs.writeFile("/input.png", input);
    const result = await runConvertCli(["-density", "150x100", "/input.png", "-write", "/first.png",
      "-delete", "0", "/input.png", "-write", "/second.png", "-delete", "0",
      "-density", "96x48", "/input.png", "/third.png"],
      mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    for (const [path, x, y] of [["/first.png", 150, 100], ["/second.png", 150, 100], ["/third.png", 96, 48]] as const) {
      const output = mode === "buffered" ? files.get(path)! : await fs.readFile(path);
      expect(decodeImage(output).resolution).toEqual({ x, y, unit: "unknown" });
    }
  });
}
