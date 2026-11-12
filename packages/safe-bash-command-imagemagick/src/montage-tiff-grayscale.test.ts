import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  async function run(options: string[], destination: string) {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", "-depth", "8", ...options, destination];
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
    return destination === "tiff:-" ? result.stdoutBytes!
      : mode === "sync" || mode === "buffered" ? files.get(destination)! : await filesystem.readFile(destination);
  }

  for (const destination of ["tiff:-", "/result.tif"]) {
    it.each([
      { options: [], bits: [8, 8, 8], photometric: 2, pixels: "ff0000ff0000ffff" },
      { options: ["-type", "Grayscale"], bits: [8], photometric: 1, pixels: "363636ff121212ff" },
      { options: ["-colorspace", "Gray"], bits: [8], photometric: 1, pixels: "363636ff121212ff" }
    ])(`${mode} stores $options with matching TIFF tags and pixels in ${destination}`, async ({ options, bits, photometric, pixels }) => {
      const bytes = await run(options, destination);
      // Native ImageMagick 7.1.2-35: one 8-bit BlackIsZero sample for either gray option.
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const little = bytes[0] === 73, ifd = view.getUint32(4, little);
      const tags = new Map<number, number[]>();
      for (let index = 0; index < view.getUint16(ifd, little); index++) {
        const entry = ifd + 2 + index * 12, tag = view.getUint16(entry, little);
        if (![258, 262, 277].includes(tag)) continue;
        expect(view.getUint16(entry + 2, little)).toBe(3);
        const count = view.getUint32(entry + 4, little);
        const offset = count * 2 <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
        tags.set(tag, Array.from({ length: count }, (_, sample) => view.getUint16(offset + sample * 2, little)));
      }
      expect(tags.get(258)).toEqual(bits);
      expect(tags.get(262)).toEqual([photometric]);
      expect(tags.get(277)).toEqual([bits.length]);
      const image = decodeImage(bytes);
      expect(image).toMatchObject({ width: 2, height: 1, channels: bits.length, hasAlpha: false });
      expect(Buffer.from(image.data).toString("hex")).toBe(pixels);
    });
  }
}
