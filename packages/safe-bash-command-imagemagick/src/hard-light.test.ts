import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Pixel references from ImageMagick 7 Q16-HDRI, exported at depth 8.
const cases = [
  ...[
    ["HardLight", [47, 76, 127, 255]],
    ["Over", [59, 82, 125, 255]],
    ["Multiply", [42, 71, 116, 255]],
    ["Screen", [68, 98, 150, 255]],
    ["Darken", [59, 82, 125, 255]],
    ["Lighten", [59, 87, 141, 255]],
    ["Overlay", [47, 76, 129, 255]],
  ].map(([compose, expected]) => ({ compose: compose as string, base: [51, 87, 141], overlay: [84, 66, 76, 64], expected })),
  { compose: "HardLight", base: [51, 87, 141, 128], overlay: [204, 128, 76, 64], expected: [106, 95, 117, 160] },
  { compose: "HardLight", base: [51, 87, 141], overlay: [204, 128, 76, 255], expected: [173, 88, 84, 255] },
  { compose: "HardLight", base: [51, 87, 141, 0], overlay: [204, 128, 76, 64], expected: [204, 128, 76, 64] },
  { compose: "HardLight", base: [51, 87, 141], overlay: [204, 128, 76, 0], expected: [51, 87, 141, 255] },
];

for (const mode of ["map", "retained", "command"] as const) {
  it.each(cases)(`${mode}: $compose with base $base and overlay $overlay matches native pixels`, async ({ compose, base, overlay, expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = createMemoryFileSystem();
    for (const [path, pixels] of [["/base.png", base], ["/over.png", overlay]] as const) {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: pixels.length as 3 | 4 } }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["/base.png", "/over.png", "-compose", compose, "-composite", "/out.png"];
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
