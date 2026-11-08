import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Decoded RGBA8 reference values from native ImageMagick Q16-HDRI.
for (const mode of ["map", "retained", "command"] as const) {
  it.each([
    { operation: "Subtract", count: 3, expected: [0, 76, 164, 255] },
    { operation: "Divide", count: 3, expected: [13, 66, 138, 255] },
    { operation: "Sum", count: 3, expected: [255, 228, 244, 255] },
    { operation: "Abs", count: 3, expected: [255, 228, 244, 255] },
    { operation: "Subtract", count: 2, expected: [140, 0, 0, 255] },
    { operation: "Divide", count: 2, expected: [0, 0, 0, 255] },
    ...["Subtract", "Divide", "Sum", "Abs"].map(operation => ({ operation, count: 1, expected: [36, 104, 172, 255] })),
  ])(`${mode}: $operation over $count frames matches native ordering`, async ({ operation, count, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
    const pixels = [[36, 104, 172], [176, 76, 40], [64, 48, 32]];
    const paths = [];
    for (let index = 0; index < count; index++) {
      const path = `/frame${index}.png`;
      const bytes = await sharp(Uint8Array.from(pixels[index]!), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
      paths.push(path); files.set(path, bytes); await fs.writeFile(path, bytes);
    }
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
    expect(output.data).toEqual(Uint8Array.from(expected));
  });
}
