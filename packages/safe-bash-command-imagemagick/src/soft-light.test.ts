import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Pixel references from ImageMagick 7 Q16-HDRI, exported at depth 8.
const cases = [
  { base: [51, 87, 141], overlay: [84, 66, 76, 64], expected: [68, 124, 228, 255] },
  { base: [51, 87, 141], overlay: [84, 66, 76, 255], expected: [88, 146, 255, 255] },
  { base: [20, 70, 180], overlay: [220, 200, 240, 255], expected: [71, 176, 255, 255] },
  { base: [51, 87, 141, 128], overlay: [204, 128, 76, 64], expected: [91, 108, 150, 160] },
  { base: [51, 87, 141, 0], overlay: [204, 128, 76, 64], expected: [204, 128, 76, 64] },
  { base: [51, 87, 141], overlay: [84, 66, 76, 0], expected: [61, 117, 219, 255] },
  { base: [51, 87, 141, 0], overlay: [84, 66, 76, 0], expected: [0, 0, 0, 0] },
];

for (const mode of ["map", "retained", "command"] as const) {
  it.each(cases)(`${mode}: SoftLight with base $base and overlay $overlay matches native pixels`, async ({ base, overlay, expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = createMemoryFileSystem();
    for (const [path, pixels] of [["/base.png", base], ["/over.png", overlay]] as const) {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: pixels.length as 3 | 4 } }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["/base.png", "/over.png", "-compose", "SoftLight", "-composite", "/out.png"];
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect(Array.from(output.data)).toEqual(expected);
  });
}
