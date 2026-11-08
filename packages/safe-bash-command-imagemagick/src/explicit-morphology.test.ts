import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Full 9x9 pixel expectations from native ImageMagick.
for (const mode of ["command", "buffered", "retained"] as const)
for (const method of ["Dilate", "Erode"] as const)
it.each(([
    ["3x1:1,1,1", [[3, 4], [4, 4], [5, 4]]],
    ["3x1+0+0:1,1,1", [[4, 4], [5, 4], [6, 4]]],
    ["3x1+2+0:1,1,1", [[2, 4], [3, 4], [4, 4]]],
    ["3x1:1,nan,1", [[3, 4], [5, 4]]],
    ["1x3+0+0:1,nan,1", [[4, 4], [4, 6]]],
    ["2x1:1,1", [[4, 4], [5, 4]]],
    ["Diamond:1", [[4, 3], [3, 4], [4, 4], [5, 4], [4, 5]]],
] as const).filter(([kernel]) => method === "Dilate" || !kernel.includes("nan")))(`honors explicit ${method} footprints (${mode}): %s`, async (kernel, white) => {
    const pixels = new Uint8Array(9 * 9 * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    pixels.set([255, 255, 255, 255], (4 * 9 + 4) * 4);
    if (method === "Erode") for (let i = 0; i < pixels.length; i++) if (i % 4 !== 3) pixels[i] = 255 - pixels[i]!;
    const input = await sharp(pixels, { raw: { width: 9, height: 9, channels: 4 } }).png().toBuffer();
    const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-morphology", method, kernel, "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    const background = method === "Erode" ? 255 : 0, foreground = 255 - background;
    pixels.set([background, background, background, 255], (4 * 9 + 4) * 4);
    for (const [x, y] of white) {
        const position = method === "Erode" ? ((8 - y) * 9 + 8 - x) * 4 : (y * 9 + x) * 4;
        pixels.set([foreground, foreground, foreground, 255], position);
    }
    expect(output.data).toEqual(pixels);
});
