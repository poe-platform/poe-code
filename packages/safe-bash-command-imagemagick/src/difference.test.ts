import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
  // ImageMagick 7 Difference skips transparent source pixels and otherwise
  // subtracts channels, including alpha only when the destination has alpha.
  it.each([
    { base: [20, 40, 80], overlay: [29, 51, 103, 0], expected: [20, 40, 80, 255] },
    { base: [51, 87, 141], overlay: [84, 66, 76, 64], expected: [33, 21, 65, 255] },
    { base: [51, 87, 141], overlay: [84, 66, 76, 255], expected: [33, 21, 65, 255] },
    { base: [51, 87, 141, 128], overlay: [84, 66, 76, 0], expected: [51, 87, 141, 128] },
    { base: [51, 87, 141, 255], overlay: [84, 66, 76, 64], expected: [33, 21, 65, 191] },
  ])(`${mode}: Difference $base with $overlay matches native RGBA`, async ({ base, overlay, expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = createMemoryFileSystem();
    for (const [path, pixels] of [["/base.png", base], ["/overlay.png", overlay]] as const) {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: pixels.length as 3 | 4 } }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["/base.png", "/overlay.png", "-compose", "Difference", "-composite", "/out.png"];
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
    expect(output.hasAlpha).toBe(base.length === 4);
  });
}
