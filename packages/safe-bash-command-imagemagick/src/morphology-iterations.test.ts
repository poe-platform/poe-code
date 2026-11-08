import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Full pixel results checked with native ImageMagick 7.1.2, using opaque 9x9 PNGs.
for (const mode of ["command", "buffered", "retained"] as const)
for (const method of ["Dilate", "Erode", "Open", "EdgeIn", "TopHat", "Convolve", "Correlate"])
for (const count of [0, 1, 2, 3])
it(`honors ${method}:${count} iterations (${mode})`, async () => {
    const convolution = method === "Convolve" || method === "Correlate";
    const dot = method === "Dilate" || convolution;
    const pixels = new Uint8Array(9 * 9 * 4);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
        const white = dot ? x === 4 && y === 4 : x >= 2 && x <= 6 && y >= 2 && y <= 6;
        pixels.set([white ? 255 : 0, white ? 255 : 0, white ? 255 : 0, 255], (y * 9 + x) * 4);
    }
    const input = await sharp(pixels.filter((_, index) => index % 4 !== 3), { raw: { width: 9, height: 9, channels: 3 } }).png().toBuffer();
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-morphology", `${method}:${count}`, convolution ? "3x1:1,0,0" : "Diamond:1", "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    const expected = new Uint8Array(pixels);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
        const dx = Math.abs(x - 4), dy = Math.abs(y - 4);
        const eroded = dx <= 2 - count && dy <= 2 - count;
        const opened = count <= 2 && Math.max(0, dx - (2 - count)) + Math.max(0, dy - (2 - count)) <= count;
        const original = pixels[(y * 9 + x) * 4] === 255;
        const white = count === 0 ? original : convolution ? y === 4 && x === 4 + (method === "Convolve" ? -count : count)
            : method === "Dilate" ? dx + dy <= count : method === "Erode" ? eroded
            : method === "Open" ? opened : method === "EdgeIn" ? original && !eroded : original && !opened;
        expected.set([white ? 255 : 0, white ? 255 : 0, white ? 255 : 0, 255], (y * 9 + x) * 4);
    }
    expect([...output.data]).toEqual([...expected]);
});
