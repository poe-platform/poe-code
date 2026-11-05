import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

for (const mode of ["command", "buffered", "retained"] as const)
for (const method of ["Convolve", "Correlate"] as const)
for (const weight of [1, 0.1])
for (const [opaque, opacity, hiddenBlue] of [[false, 255, 0], [true, 255, 0], [false, 128, 255], [false, 0, 255]] as const)
it(`matches morphology ${method} alpha (${mode}, weight=${weight}, opaque=${opaque}, opacity=${opacity}, hiddenBlue=${hiddenBlue})`, async () => {
    // ImageMagick 7.1.2: a red impulse in a transparent or opaque black 3x3 image.
    const pixels = new Uint8Array(36);
    for (let i = 2; i < pixels.length; i += 4) pixels[i] = hiddenBlue;
    if (opaque) for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    pixels.set([255, 0, 0, opacity], 16);
    const input = await sharp(pixels, { raw: { width: 3, height: 3, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-morphology", method, `3x3:${Array(9).fill(weight).join(",")}`, "/out.png"];
    const stderr: string[] = [];
    const result = mode === "command" ? await createConvertCommand().execute({
        command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr.push(String(chunk)); } },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toEqual([]);
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([...output.data]).toEqual(Array.from({ length: 9 }, () => opaque ? [28, 0, 0, Math.min(255, Math.round((255 * 8 + opacity) * weight))] : [opacity ? 255 : 0, 0, 0, Math.round(opacity * weight)]).flat());
});
