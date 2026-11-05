import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
  it.each([
    ["Add", "0", 9],
    ["Add", "0.5", 9],
    ["Add", "1", 9],
    ["Add", "10", 9],
    ["Add", "254", 10],
    ["Add", "255", 10],
    ["Add", "256", 10],
    ["Add", "257", 10],
    ["Add", "-10", 9],
    ["Add", "-257", 8],
    ["Add", "10%", 35],
    ["Multiply", "0.5", 5],
  ])(`${mode}: evaluates %s %s in Q16 units or operation factors`, async (operation, value, red) => {
    const pixels = new Uint8Array([9, 15, 21, 255, 109, 115, 121, 255]);
    const bytes = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", bytes]]);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.png", bytes);
    const args = ["/in.png", "-channel", "R", "-evaluate", operation, value, "+channel", "/out.png"];
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect(Array.from(output.data)).toEqual([red, 15, 21, 255, operation === "Multiply" ? 55 : red + 100, 115, 121, 255]);
  });
}
