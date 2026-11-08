import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, PNG24 inputs, -depth 8 rgba:-.
for (const mode of ["map", "sync", "retained", "command"] as const) {
  for (const { operation, forward, reverse } of [
    { operation: "LeftShift", forward: [194, 150, 49, 255], reverse: [36, 108, 201, 255] },
    { operation: "RightShift", forward: [194, 150, 49, 255], reverse: [36, 108, 201, 255] },
    { operation: "Mean", forward: [104, 92, 158, 255], reverse: [104, 92, 158, 255] },
  ]) {
    it.each([
      { order: "single", expected: [36, 108, 201, 255] },
      { order: "pair", expected: operation === "LeftShift" ? [255, 255, 255, 255] : operation === "RightShift" ? [0, 0, 0, 255] : [60, 63, 212, 255] },
      { order: "zero", expected: operation === "Mean" ? [77, 86, 83, 255] : [194, 150, 49, 255] },
      { order: "forward", expected: forward },
      { order: "reverse", expected: reverse },
    ])(`${mode}: ${operation} in $order order matches native`, async ({ order, expected }) => {
      const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
      const paths: string[] = [];
      const pixels = [[36, 108, 201], [83, 17, 223], [194, 150, 49]];
      if (order === "zero") pixels[1] = [0, 0, 0];
      const ordered = order === "pair" ? pixels.slice(0, 2) : order === "single" ? pixels.slice(0, 1) : order === "reverse" ? pixels.reverse() : pixels;
      for (const pixel of ordered) {
        const path = `/input${paths.length}.png`;
        const bytes = await sharp(new Uint8Array(pixel), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
        paths.push(path);
      }
      const args = [...paths, "-evaluate-sequence", operation, "/out.png"];
      const result = mode === "command"
        ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
      expect([...output.data]).toEqual(expected);
    });
  }
}
