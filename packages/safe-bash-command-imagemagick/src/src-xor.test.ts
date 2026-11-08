import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
  // Native ImageMagick preserves the destination alpha-channel presence.
  for (const compose of ["Src", "Source", "Copy", "Xor"])
  it.each([
    { base: [51, 87, 141], alpha: 255 },
    { base: [51, 87, 141, 255], alpha: 64 },
    { base: [51, 87, 141, 128], alpha: 64 },
  ])(`${mode}: ${compose} preserves destination alpha for $base`, async ({ base, alpha }) => {
    const overlay = [84, 66, 76, 64];
    const expected = compose === "Xor"
      ? base.length === 3 ? [38, 65, 106, 255]
        : base[3] === 255 ? [38, 65, 106, 191] : [30, 41, 63, 128]
      : [84, 66, 76, alpha];
    const files = new Map<string, Uint8Array>();
    const fs = createMemoryFileSystem();
    for (const [path, pixels] of [["/base.png", base], ["/overlay.png", overlay]] as const) {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: pixels.length as 3 | 4 } }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["/base.png", "/overlay.png", "-compose", compose, "-composite", "/out.png"];
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
