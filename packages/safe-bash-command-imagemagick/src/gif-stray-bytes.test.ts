import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

// Two 2x1 red/green frames, with disposal 2/1 and delays 7/23 cs.
const control = Buffer.from(
  "47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30" +
  "030102000021f90408070000002c0000000002000100000202045300" +
  "21f90404170000002c00000000020001000002020c51003b", "hex"
);
const pixels = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255);

for (const mode of ["buffered", "retained", "command"]) {
  it.each([
    ["control", 61, []],
    ["zero", 61, [0]],
    ["four zeros", 61, [0, 0, 0, 0]],
    ["ASCII x", 61, [120]],
    ["trailing junk", 84, [120]],
    ["unknown extension", 61, [33, 240, 3, 44, 59, 33, 0]],
    // Extra bytes after LZW EOI still belong to the declared image-data sub-block.
    ["image payload markers", 60, [44, 59, 33]]
  ] as const)(`preserves GIF frames with %s (${mode})`, async (name, offset, extra) => {
    const input = new Uint8Array([...control.subarray(0, offset), ...extra, ...control.subarray(offset)]);
    if (name === "image payload markers") input[57] = 5;
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", input);
    await fs.writeFile("/out.gif", new TextEncoder().encode("keep"));
    const files = new Map([["/in.gif", input], ["/out.gif", new TextEncoder().encode("keep")]]);
    const args = ["/in.gif", "/out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} }
    }) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = mode === "buffered" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [70, 230], loop: 3 });
    expect(await sharp(output, { animated: true }).raw().toBuffer()).toEqual(pixels);
    // Exercise the animated decoder independently of command frame selection.
    expect(await sharp(input, { animated: true }).raw().toBuffer()).toEqual(pixels);
  });
}
