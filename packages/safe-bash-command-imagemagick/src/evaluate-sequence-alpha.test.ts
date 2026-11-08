import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
  // ImageMagick 7.1.2-32 evaluates alpha with the default channel selection.
  it.each([
    { operation: "Mean", expected: [120, 60, 135, 96] },
    { operation: "Median", expected: [20, 80, 240, 128] },
    { operation: "Max", expected: [220, 80, 240, 128] },
    { operation: "Subtract", expected: [0, 40, 210, 64] },
    { operation: "Divide", expected: [0, 0, 0, 0] },
    { operation: "Sum", expected: [240, 120, 255, 192] },
    { operation: "Abs", expected: [240, 120, 255, 192] },
  ])(`${mode}: evaluate-sequence $operation includes alpha`, async ({ operation, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
    for (const [path, pixel] of [["/first.png", [220, 40, 30, 64]], ["/second.png", [20, 80, 240, 128]]] as const) {
      const bytes = await sharp(Uint8Array.from({ length: 64 }, (_, index) => pixel[index % 4]!), {
        raw: { width: 4, height: 4, channels: 4 },
      }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["/first.png", "/second.png", "-evaluate-sequence", operation, "/out.png"];
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect(output.data).toEqual(Uint8Array.from({ length: 64 }, (_, index) => expected[index % 4]!));
  });
}
