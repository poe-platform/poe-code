import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, PNG24 inputs, -depth 8 rgba:-.
for (const mode of ["map", "sync", "retained", "command"] as const) {
  it.each([
    { operation: "Threshold", expected: [0, 0, 255, 255] },
    { operation: "ThresholdBlack", expected: [0, 0, 220, 255] },
    { operation: "ThresholdWhite", expected: [25, 100, 255, 255] },
  ])(`${mode}: $operation handles samples below, equal to, and above the threshold`, async ({ operation, expected }) => {
      const input = await sharp(new Uint8Array([25, 100, 220]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
      const files = new Map([["/in.png", input]]), fs = createMemoryFileSystem();
      await fs.writeFile("/in.png", input);
      const args = ["/in.png", "-evaluate", operation, "25700", "/out.png"];
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
