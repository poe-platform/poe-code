import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
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
    [1, [8], 0],
    [2, [8, 7], 70],
    [3, [8, 7, 0], 70],
    [3, [8, 7, 1], 2630],
    [4, [8, 7, 0, 0], 70],
    [5, [8, 7, 0, 0, 99], 70]
  ] as const)(`preserves delay from a %i-byte GIF control block (${mode})`, async (length, payload, delay) => {
    const input = new Uint8Array([...control.subarray(0, 40), length, ...payload, ...control.subarray(45)]);
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
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [delay, 230], loop: 3 });
    expect(await sharp(output, { animated: true }).raw().toBuffer()).toEqual(pixels);
    expect([0, 1].map(page => decodeImage(output, { page, coalesce: false }).disposal)).toEqual([2, 1]);
    // Exercise the animated decoder independently of command frame selection.
    expect(await sharp(input, { animated: true }).raw().toBuffer()).toEqual(pixels);
  });
}
