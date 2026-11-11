import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Raw RGB output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const [space, average] of [
    ["Lab", "23303d3e4e5e"],
    ["HSL", "1e3246395067"],
    ["sRGB", "25323f3f5061"]
] as const) {
    it.each([
        ["0,0,0,1,1,1,0,0,0", average],
        ["0,0,0,0,1,0,0,0,0", "0a141e5a6e82"]
    ])(`preserves ${space} convolution when converting to sRGB (%s)`, async (kernel, expected) => {
        const stdout: number[] = [], stderr: number[] = [];
        const args = ["xc:#0a141e", "xc:#5a6e82", "+append", "-colorspace", space,
            "-convolve", kernel, "-colorspace", "sRGB", "-depth", "8", "rgb:-"];
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {},
            fs: new MemoryFileSystem(), signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(...bytes); } },
            stderr: { async write(bytes) { stderr.push(...bytes); } }
        });
        expect(result.exitCode).toBe(0);
        expect(stderr).toEqual([]);
        expect(Buffer.from(stdout).toString("hex")).toBe(expected);
    });
}
