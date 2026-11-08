import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

const pixels = Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255);
const input = encodeImage({ width: 2, height: 1, data: pixels, format: "png",
  space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;

for (const mode of ["buffered", "retained", "command"]) {
  async function convert(options: string[], beforeInput = false) {
    const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
    await fs.writeFile("/input.png", input);
    const args = [...(beforeInput ? [...options, "/input.png"] : ["/input.png", ...options]), "/output.tiff"];
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
      args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} } })
      : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    return { result, output: mode === "buffered" ? files.get("/output.tiff") : await fs.readFile("/output.tiff").catch(() => undefined) };
  }

  it.each(["TopLeft", "TopRight", "BottomRight", "BottomLeft", "LeftTop", "RightTop", "RightBottom", "LeftBottom"])(`sets %s without transforming pixels (${mode})`, async name => {
    const { result, output } = await convert(["-orient", name]);
    expect(result).toMatchObject({ exitCode: 0 });
    const image = decodeImage(output!);
    expect(image).toMatchObject({ width: 2, height: 1,
      orientation: ["TopLeft", "TopRight", "BottomRight", "BottomLeft", "LeftTop", "RightTop", "RightBottom", "LeftBottom"].indexOf(name) + 1 });
    expect(image.data).toEqual(pixels);
  });

  it(`applies auto-orient to the newly set tag (${mode})`, async () => {
    const { result, output } = await convert(["-orient", "righttop", "-auto-orient"]);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(decodeImage(output!)).toMatchObject({ width: 1, height: 2, orientation: 1, data: pixels });
  });

  it(`sets orientation before reading input (${mode})`, async () => {
    const { result, output } = await convert(["-orient", "BottomLeft"], true);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(decodeImage(output!)).toMatchObject({ width: 2, height: 1, orientation: 4, data: pixels });
  });

  it(`accepts Undefined orientation (${mode})`, async () => {
    const { result, output } = await convert(["-orient", "Undefined"]);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(decodeImage(output!)).toMatchObject({ width: 2, height: 1, data: pixels });
  });

  it(`rejects invalid orientation without writing output (${mode})`, async () => {
    const { result, output } = await convert(["-orient", "sideways"]);
    expect(result).toMatchObject({ exitCode: 1 });
    expect(output).toBeUndefined();
  });
}
