import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const [kernel, targetX, low, high] of [
    ["3x3:0,0,0,0,1,0,0,0,0", 4, 0, 255],
    ["3x3:0,0,0,0,1,0,0,0,0", 4, 51, 204],
    ["3x1:0,1,nan", 4, 0, 255],
    ["3x1+0+0:0,1,nan", 3, 0, 255],
] as const)
it.each(kernel.startsWith("3x3") ? [false, true] : [false])(`matches isolated foreground and rejects a block (${mode}, ${kernel}, ${low}, block=%s)`, async block => {
    const pixels = new Uint8Array(9 * 9 * 4);
    pixels.fill(low);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    for (let y = block ? 2 : 4; y <= (block ? 6 : 4); y++)
        for (let x = block ? 2 : 4; x <= (block ? 6 : 4); x++)
            pixels.set([high, high, high, 255], (y * 9 + x) * 4);
    const input = await sharp(pixels, { raw: { width: 9, height: 9, channels: 4 } }).png().toBuffer();
    const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-morphology", "HitAndMiss", kernel, "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage((mode === "buffered" || mode === "sync") ? files.get("/out.png")! : await fs.readFile("/out.png"));
    const expected = new Uint8Array(pixels.length);
    for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
    if (!block) expected.set([high - low, high - low, high - low, 255], (4 * 9 + targetX) * 4);
    expect(output.data).toEqual(expected);
});
