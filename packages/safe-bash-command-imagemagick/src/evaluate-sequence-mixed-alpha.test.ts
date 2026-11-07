import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
  for (const reverse of [false, true]) {
    it.each([
      { operation: "Mean", expected: [106, 90, 106, 96] },
      { operation: "Min", expected: [36, 76, 40, 0] },
      { operation: "Max", expected: [176, 104, 172, 191] },
    ])(`${mode}: mixed alpha $operation (reverse=${reverse})`, async ({ operation, expected }) => {
      const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
      for (const [path, pixel] of [["/rgb.png", [36, 104, 172]], ["/rgba.png", [176, 76, 40, 191]]] as const) {
        const bytes = await sharp(Uint8Array.from(pixel), {
          raw: { width: 1, height: 1, channels: pixel.length },
        }).png().toBuffer();
        expect(decodeImage(bytes).hasAlpha).toBe(pixel.length === 4);
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
      }
      const paths = ["/rgb.png", "/rgba.png"];
      if (reverse) paths.reverse();
      const args = [...paths, "-evaluate-sequence", operation, "/out.png"];
      const result = mode === "command"
        ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
      expect(output.hasAlpha).toBe(true);
      expect(output.data).toEqual(Uint8Array.from(expected));
    });
  }
}
