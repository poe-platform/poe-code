import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// RGBA8 reference pixels from native ImageMagick 7.1.2-31.
const cases = [
  [
    "0",
    "ff0000ffff0000ff008000ff008000ff0000ffff0000ffffff0000ffff0000ff008000ff008000ff0000ffff0000ffffffff00ffffff00ff00ffffff00ffffffff00ffffff00ffffffff00ffffff00ff00ffffff00ffffffff00ffffff00ffff"
  ],
  [
    "0.5",
    "ff0000ffff0000ff008000ff008000ff0000ffff0000ffffff0000ffff0000ff008000ff008000ff0000ffff0000ffffffff00ffffff00ff00ffffff00ffffffff00ffffff00ffffffff00ffffff00ff00ffffff00ffffffff00ffffff00ffff"
  ],
  [
    "1",
    "ff0000ffff0000ff008000ff008000ff0000ffff0000ffffff0000ffff0000ff008000ff008000ff0000ffff0000ffffffff00ffffff00ff00ffffff00ffffffff00ffffff00ffffffff00ffffff00ff00ffffff00ffffffff00ffffff00ffff"
  ],
  [
    "1.5",
    "ff0000ffff0000ff008000ff008000ff0000ffff0000ffffff0000ffff0000ff008000ff008000ff0000ffff0000ffffffff00ffffff00ff00ffffff00ffffffff00ffffff00ffffffff00ffffff00ff00ffffff00ffffffff00ffffff00ffff"
  ],
  [
    "2",
    "ff0000ffff0000ffff8000ff008000ff0080ffff0000ffffff0000ffff0000ffff8000ff008000ff0080ffff0000ffffffff00ffffff00ffffff00ff00ffffff0080ffffff00ffffffff00ffffff00ffffffffff00ffffffffffffffff00ffff"
  ],
  [
    "3",
    "ff0000ffff0000ff008000ff008000ff0000ffff0000ffffff0000ffff8000ff008000ff0080ffff0000ffff0000ffffffff00ffffff00ff00ff00ff0080ffff0000ffffff00ffffffff00ffffff00ff00ffffff00ffffffff00ffffff00ffff"
  ],
  [
    "2x3",
    "ff0000ffff0000ffff8000ff008000ff0080ffff0000ffffff0000ffff0000ffff8000ff008000ff0080ffff0000ffffffff00ffffff00ffffff00ff00ffffff0080ffffff00ffffffff00ffffff00ffffffffff00ffffffffffffffff00ffff"
  ]
];
for (const mode of ["map", "retained", "command"] as const) {
  it.each(cases)(`${mode}: median %s matches native geometry`, async (size, expected) => {
    const colors = [[255, 0, 0], [0, 128, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
    const pixels = Uint8Array.from({ length: 6 * 4 * 4 }, (_, i) => {
      const pixel = Math.floor(i / 4);
      return i % 4 === 3 ? 255 : colors[Math.floor(pixel / 12) * 3 + Math.floor(pixel % 6 / 2)]![i % 4]!;
    });
    const bytes = await sharp(pixels, { raw: { width: 6, height: 4, channels: 4 } }).png().toBuffer();
    const files = new Map([["/input.png", bytes]]), fs = createMemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    const args = ["/input.png", "-median", size!, "/out.png"];
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect(Buffer.from(output.data).toString("hex")).toBe(expected);
  });
}
