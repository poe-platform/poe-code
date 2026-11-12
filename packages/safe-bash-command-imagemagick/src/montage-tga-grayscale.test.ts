import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  async function run(options: string[], destination: string) {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", "-tile", "2x2", "-geometry", "+0+0", ...options, destination];
    let result;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments([...(mode === "magick" ? ["montage"] : []), ...args]);
      const chunks: Uint8Array[] = [];
      let stderr = "";
      result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      }), stderr, stdoutBytes: Buffer.concat(chunks) };
    } else result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    return destination === "tga:-" ? result.stdoutBytes!
      : mode === "sync" || mode === "buffered" ? files.get(destination)! : await filesystem.readFile(destination);
  }

  for (const destination of ["tga:-", "/result.tga"]) {
    it.each([
      { options: [], type: 2, depth: 24, payload: "0000ff00ff00ff0000ffffff", pixels: "ff0000ff00ff00ff0000ffffffffffff" },
      { options: ["-type", "Grayscale"], type: 3, depth: 8, payload: "36b612ff", pixels: "363636ffb6b6b6ff121212ffffffffff" },
      { options: ["-colorspace", "Gray"], type: 3, depth: 8, payload: "36b612ff", pixels: "363636ffb6b6b6ff121212ffffffffff" }
    ])(`${mode} stores $options with native TGA headers and pixels in ${destination}`, async ({ options, type, depth, payload, pixels }) => {
      const bytes = await run(options, destination);
      // Native ImageMagick 7.1.2-35: top-left origin, one 8-bit sample for gray sheets.
      expect(Array.from(bytes.subarray(0, 18))).toEqual([
        0, 0, type, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, depth, 0x20
      ]);
      expect(Buffer.from(bytes.subarray(18)).toString("hex")).toBe(payload);
      const image = decodeImage(bytes);
      expect(image).toMatchObject({ width: 2, height: 2, channels: depth / 8, hasAlpha: false });
      expect(Buffer.from(image.data).toString("hex")).toBe(pixels);
    });
  }
}
