import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

for (const mode of ["command", "buffered", "retained"] as const)
for (const statistic of ["Mean", "Median"])
for (const center of [true, false])
it(`computes ${statistic} with clamped edges (${mode}, center=${center})`, async () => {
    const pixels = new Uint8Array(36);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    pixels.set([255, 128, 64, 255], center ? 16 : 0);
    const input = await sharp(pixels, { raw: { width: 3, height: 3, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-statistic", statistic, "3x3", "/out.png"];
    const stderr: string[] = [];
    const result = mode === "command" ? await createConvertCommand().execute({
        command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr.push(String(chunk)); } },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toEqual([]);
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    // A center impulse contributes once everywhere; a corner impulse is repeated by edge clamping.
    const counts = center ? Array<number>(9).fill(1) : [4, 2, 0, 2, 1, 0, 0, 0, 0];
    // Means can now retain 16-bit samples; compare their rounded byte values.
    expect(output.data16 ? Array.from(output.data16, value => Math.round(value / 257)) : [...output.data]).toEqual(counts.flatMap(count => statistic === "Mean"
        ? [Math.round(255 * count / 9), Math.round(128 * count / 9), Math.round(64 * count / 9), 255]
        : [0, 0, 0, 255]));
});
