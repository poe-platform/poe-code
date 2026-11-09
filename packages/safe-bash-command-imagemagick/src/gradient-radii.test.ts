import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const minimum = [255,255,255,255,255,255,255,0,255,255,255,255,255,255,255];
const ellipse = [255,255,255,255,255,255,128,0,128,255,255,255,255,255,255];
const maximum = [255,180,128,180,255,255,128,0,128,255,255,180,128,180,255];
for (const mode of ["map", "filesystem", "command"]) {
    it.each([
        { options: ["-define", "gradient:radii=1,1"], expected: minimum },
        { options: ["-define", "gradient:radii=2,1"], expected: ellipse },
        { options: ["-define", "gradient:extent=minimum"], expected: minimum },
        { options: ["-define", "gradient:extent=ellipse"], expected: ellipse },
        { options: ["-define", "gradient:extent=maximum"], expected: maximum },
        { options: ["-define", "gradient:extent=diagonal"], expected: [255,161,114,161,255,228,114,0,114,228,255,161,114,161,255] },
        { options: ["-define", "gradient:radii=1,1", "-define", "gradient:extent=maximum"], expected: minimum },
        { options: ["-define", "gradient:radii=1,1", "+define", "gradient:radii", "-define", "gradient:extent=ellipse"], expected: ellipse },
        { options: ["-define", "gradient:extent=minimum", "+define", "gradient:extent"], expected: maximum },
        { options: ["-define", "gradient:radii=2,1", "-define", "gradient:vector=0,0,4,2"], expected: ellipse }
    ])(`applies radial controls in ${mode}: $options`, async ({ options, expected }) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["-size", "5x3", ...options, "radial-gradient:black-white", "PNG64:out.png"];
        if (mode === "command") {
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem
            });
            expect(result.exitCode).toBe(0);
        } else {
            expect(await runConvertCli(argv, mode === "map" ? files : { filesystem, cwd: "/" }))
                .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const image = decodeImage(mode === "map" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
        const red = Array.from(image.data).filter((_, i) => i % 4 === 0);
        expect(red).toHaveLength(expected.length);
        // Native Q16 conversion can round one level differently.
        red.forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(1));
    });
}
