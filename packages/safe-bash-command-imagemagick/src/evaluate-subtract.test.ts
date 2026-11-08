import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI: Subtract percentages scale by QuantumRange + 1.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    ["50%", [0, 0, 0, 0, 0, 0, 64, 126, 127]],
    ["32768", [0, 0, 0, 0, 0, 0, 64, 126, 127]],
    ["32767.5", [0, 0, 0, 0, 0, 1, 65, 127, 128]],
    ["-50%", [128, 129, 160, 192, 255, 255, 255, 255, 255]],
    ["25%", [0, 0, 0, 0, 63, 64, 128, 190, 191]],
    ["100%", [0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ] as const)(`${mode}: Subtract %s matches native Q16 operands`, async (operand, expected) => {
    const values = [0, 1, 32, 64, 127, 128, 192, 254, 255];
    const pixels = new Uint8Array(values.flatMap(value => [value, value, value]));
    const bytes = await sharp(pixels, { raw: { width: values.length, height: 1, channels: 3 } }).png().toBuffer();
    const files = new Map([["/in.png", bytes]]);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.png", bytes);
    const args = ["/in.png", "-evaluate", "Subtract", operand, "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
  });
}
