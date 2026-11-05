import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
  it.each([[4, 4, 2, 2], [2, 2, 4, 4], [4, 2, 2, 4], [4101, 2, 2, 1]])(
    `${mode}: evaluate-sequence preserves the pixel grid (%ix%i, %ix%i)`,
    async (firstWidth, firstHeight, sourceWidth, sourceHeight) => {
      const width = Math.max(firstWidth, sourceWidth), height = Math.max(firstHeight, sourceHeight);
      const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
      const colors = [[255, 0, 0, 255], [0, 128, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
      const source = Uint8Array.from({ length: sourceWidth * sourceHeight * 4 }, (_, i) => {
        const pixel = Math.floor(i / 4);
        return colors[(Math.floor(pixel / sourceWidth) % 2) * 2 + pixel % sourceWidth % 2]![i % 4]!;
      });
      for (const [path, data, w, h] of [
        ["/black.png", Uint8Array.from({ length: firstWidth * firstHeight * 4 }, (_, i) => i % 4 === 3 ? 255 : 0), firstWidth, firstHeight],
        ["/color.png", source, sourceWidth, sourceHeight],
      ] as const) {
        const bytes = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
      }
      const args = ["/black.png", "/color.png", "-evaluate-sequence", "Mean", "/out.png"];
      const result = mode === "command"
        ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
      expect([output.width, output.height]).toEqual([width, height]);
      // Native ImageMagick uses the largest width and height and extends the other frame's edge pixels.
      const expected = Uint8Array.from({ length: width * height * 4 }, (_, i) => {
        const pixel = Math.floor(i / 4), x = Math.min(pixel % width, sourceWidth - 1), y = Math.min(Math.floor(pixel / width), sourceHeight - 1);
        return i % 4 === 3 ? 255 : Math.round(source[(y * sourceWidth + x) * 4 + i % 4]! / 2);
      });
      expect(output.data).toEqual(expected);
    },
  );
}
