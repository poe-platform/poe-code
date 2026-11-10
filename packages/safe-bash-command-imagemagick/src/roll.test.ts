import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, parseMagickGeometry, runConvertCli, runConvertCliSync } from "./index.js";

// Pixel order verified with native ImageMagick 7.
const cases = [
    { geometry: "2x1", expected: [10, 20, 30, 40, 50, 60] },
    { geometry: "2", expected: [10, 20, 30, 40, 50, 60] },
    { geometry: "2x1+0+0", expected: [10, 20, 30, 40, 50, 60] },
    { geometry: "+2+1", expected: [50, 60, 40, 20, 30, 10] },
    { geometry: "2x1+0+1", expected: [40, 50, 60, 10, 20, 30] },
    { geometry: "2x1+1+0", expected: [30, 10, 20, 60, 40, 50] },
    { geometry: "-2-1", expected: [60, 40, 50, 30, 10, 20] },
    { geometry: "+5+3", expected: [50, 60, 40, 20, 30, 10] },
    { geometry: "+2", expected: [20, 30, 10, 50, 60, 40] },
    { geometry: "2x+1", expected: [30, 10, 20, 60, 40, 50] },
];
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(cases)(`rolls only by offsets in $geometry, ${mode}`, async ({ geometry, expected }) => {
        const input = await sharp(Uint8Array.from([10, 20, 30, 40, 50, 60].flatMap(v => [v, v, v, 255])), { raw: { width: 3, height: 2, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-roll", geometry, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([3, 2]);
        expect([...output.data]).toEqual(expected.flatMap(v => [v, v, v, 255]));
    });
    it.each(["2+1", "2+1+0"])(`rejects invalid roll geometry %s, ${mode}`, async geometry => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "3x2", "xc:red", "-roll", geometry, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("invalid argument for option '-roll'");
    });
}

for (const geometry of ["+2+1%", "50%+1+1"]) {
    it(`parses percentage roll geometry ${geometry}`, () => {
        expect(parseMagickGeometry(geometry)).toMatchObject({ isPercent: true, hasOffset: true, x: geometry === "+2+1%" ? 2 : 1, y: 1 });
    });
}
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { geometry: "+2+1%", expected: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
        { geometry: "50%+1+1", expected: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
        { geometry: "2x3+2+1", expected: [11, 12, 9, 10, 3, 4, 1, 2, 7, 8, 5, 6] },
    ])(`matches native percentage handling for $geometry, ${mode}`, async ({ geometry, expected }) => {
        const input = await sharp(Uint8Array.from(Array.from({ length: 12 }, (_, i) => i + 1).flatMap(v => [v, v, v])), { raw: { width: 4, height: 3, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-gravity", "NorthWest", "-roll", geometry, "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([4, 3]);
        expect([...output.data]).toEqual(expected.flatMap(v => [v, v, v, 255]));
    });
}

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { geometry: "+%[fx:w/2]+1", x: 2, y: 1 },
        { geometry: "+%[fx:w-1]+0", x: 4, y: 0 },
        { geometry: "%[offset]", x: 1, y: 1 },
        { geometry: "+%[width]+%[height]", x: 5, y: 3 },
        { geometry: "+1+2+3%", x: 0, y: 0 },
        { geometry: "+1,2%", x: 0, y: 0 },
        { geometry: "+1+2+3", x: 1, y: 2 },
        { geometry: "+1+1x1", x: 1, y: 1 },
        { geometry: "+1+1x", x: 1, y: 1 },
        { geometry: "+1+1X2", x: 1, y: 1 },
        { geometry: "3x2+1+1x2", x: 1, y: 1 },
        { geometry: "+1,2", x: 1, y: 0 },
        { geometry: "+1:+2", x: 1, y: 0 },
        { geometry: "+1,+2", x: 1, y: 0 },
        { geometry: "1:2+1+2", x: 1, y: 2 },
        { geometry: "+1+2", x: 1, y: 2 },
        { geometry: "+1", x: 1, y: 0 },
        { geometry: "+1.7-1.7", x: 1, y: -1 },
        { geometry: "-1.7+1.7", x: -1, y: 1 },
        { geometry: "+0.5+0.5", x: 0, y: 0 },
        { geometry: "-0.7-0.7", x: 0, y: 0 },
        { geometry: "+13.9-8.9", x: 13, y: -8 },
        { geometry: "+1-1", x: 1, y: -1 },
        { geometry: "+1+1#", x: 1, y: 1 },
        { geometry: "5x3+1+1#", x: 1, y: 1 },
        { geometry: "+1#-1", x: 1, y: -1 },
        { geometry: "+1#-1%", x: 0, y: 0 },
        { geometry: "+13-8", x: 13, y: -8 },
    ])(`truncates roll offsets before wrapping $geometry, ${mode}`, async ({ geometry, x, y }) => {
        const pixels = Array.from({ length: 15 }, (_, i) => (i + 1) * 10);
        const input = await sharp(Uint8Array.from(pixels.flatMap(v => [v, v, v])), { raw: { width: 5, height: 3, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-repage", "10x9+2+3", "-set", "option:offset", "+1+1", "-roll", geometry, "-set", "option:offset", "+0+0", "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([5, 3]);
        expect(output.virtualCanvas).toEqual({ width: 10, height: 9, x: 2, y: 3 });
        const expected = pixels.map((_, i) => pixels[((Math.floor(i / 5) - y) % 3 + 3) % 3 * 5 + ((i % 5 - x) % 5 + 5) % 5]!);
        expect([...output.data]).toEqual(expected.flatMap(v => [v, v, v, 255]));
    });
}
