import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["map", "filesystem", "command"]) {
    it.each([
        ["translate 1,0 scale 2,2 point 1,1", [[3, 2]]],
        ["scale 2,2 translate 1,0 point 1,1", [[4, 2]]],
        ["affine 2,0,0,2,1,0 point 1,1", [[3, 2]]],
        ["rotate 90 point 1,-2", [[2, 1]]],
        ["skewX -90 point 3,2", [[1, 2]]],
        ["skewY -90 point 2,1", [[2, 3]]],
        ["translate 1,0 skewX 90 point 1,1", [[3, 1]]],
        ["skewX 90 translate 0,1 point 1,1", [[3, 2]]],
        ["skewX 90 push graphic-context skewY 0 point 1,1 pop graphic-context point 2,1", [[2, 1], [3, 1]]],
        ["push graphic-context skewX 90 point 1,1 pop graphic-context point 1,1", [[2, 1], [1, 1]]],
        ["translate 1,0 affine 2,0,0,2,1,0 point 1,1", [[4, 2]]],
        ["affine 1,0,1,1,0,0 point 1,2", [[1, 3]]],
        ["translate 2,1 rectangle 0,0 1,1", [[2, 1], [3, 1], [2, 2], [3, 2]]],
        ["translate 2,1 path 'M 0 0 L 2 0 L 2 2 L 0 2 Z'", [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]]],
        ["translate 1,0 point 0,0 scale 2,2 point 1,1", [[1, 0], [3, 2]]],
        ["translate 1,0 push graphic-context scale 2,2 point 1,1 pop graphic-context point 1,1", [[3, 2], [2, 1]]],
        ["point 0,0 translate 2,0 color 0,0 floodfill", Array.from({ length: 35 }, (_, i) => [i % 7, Math.floor(i / 7)])],
    ] as const)(`${mode}: transforms %s`, async (draw, redPixels) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-size", "7x5", "xc:white", "-fill", "red", "-draw", draw, "out.png"];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs,
        } as unknown as CommandContext;
        const result = mode === "command" ? await createMagickCommand().execute(context) : await runConvertCli(args, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const image = decodeImage(mode === "map" ? files.get("out.png")! : await fs.readFile("/out.png"));
        expect([...image.data]).toEqual(Array.from({ length: 35 }, (_, i) => redPixels.some(([x, y]) => x === i % 7 && y === Math.floor(i / 7)) ? [255, 0, 0, 255] : [255, 255, 255, 255]).flat());
    });
    it.each(["skewX", "skewY NaN", "skewX Infinity", "translate 1", "scale 2,NaN", "rotate Infinity", "affine 1,0,0,1,0", "scale 1e308,1e308 scale 1e308,1e308", "point 0,0 translate bad,0"])(`${mode}: preserves output after invalid %s`, async draw => {
        const original = new TextEncoder().encode("keep"), fs = new MemoryFileSystem(), files = new Map([["out.png", original]]);
        await fs.writeFile("/out.png", original);
        const args = ["-size", "7x5", "xc:white", "-draw", draw, "out.png"], argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs,
        } as unknown as CommandContext;
        const result = mode === "command" ? await createMagickCommand().execute(context) : await runConvertCli(args, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).not.toBe(0);
        expect(mode === "map" ? files.get("out.png")! : await fs.readFile("/out.png")).toEqual(original);
    });
}

it("resets transforms between draw options", async () => {
    const files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["-size", "7x5", "xc:white", "-fill", "red", "-draw", "translate 3,2 point 0,0", "-draw", "point 0,0", "out.png"], files);
    expect(result.exitCode).toBe(0);
    const image = decodeImage(files.get("out.png")!);
    expect([...image.data]).toEqual(Array.from({ length: 35 }, (_, i) => i === 0 || i === 17 ? [255, 0, 0, 255] : [255, 255, 255, 255]).flat());
});
