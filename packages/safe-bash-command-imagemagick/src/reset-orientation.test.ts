import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runMogrifyCli } from "./index.js";

const pixels = Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255);
const input = encodeImage({ width: 2, height: 1, data: pixels, format: "tiff",
  space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, orientation: 6 }, { format: "tiff" }).data;

for (const mode of ["buffered", "retained", "command", "mogrify"]) {
  it.each([
    { options: ["+orient"], width: 2, height: 1, orientation: 6 },
    { options: ["-orient", "RightTop", "+orient", "-auto-orient"], width: 1, height: 2, orientation: 1 },
    { options: ["-orient", "RightTop", "-auto-orient", "+orient"], width: 1, height: 2, orientation: 6 },
    { options: ["-orient", "RightTop", "+orient", "-auto-orient", "-auto-orient"], width: 1, height: 2, orientation: 1 }
  ])(`resets only the active orientation setting (${mode}): $options`, async ({ options, width, height, orientation }) => {
    const fs = new MemoryFileSystem(), files = new Map([["/input.tiff", input]]);
    await fs.writeFile("/input.tiff", input);
    const args = ["/input.tiff", ...options, "/output.tiff"];
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
      args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} } })
      : mode === "mogrify" ? await runMogrifyCli([...options, "/input.tiff"], { filesystem: fs, cwd: "/" })
      : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "buffered" ? files.get("/output.tiff") : await fs.readFile(mode === "mogrify" ? "/input.tiff" : "/output.tiff");
    expect(decodeImage(output!)).toMatchObject({ width, height, orientation, data: pixels });
  });
}
