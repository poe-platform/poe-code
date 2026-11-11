import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["map", "filesystem", "command"]) {
    it.each([
        { draw: "fill-opacity 0.5 rectangle 1,1 2,2", x: 1, y: 1, pixel: [255, 128, 128, 255] },
        { draw: "fill-opacity 50% point 3,2", x: 3, y: 2, pixel: [255, 128, 128, 255] },
        { draw: "fill-opacity 0 rectangle 1,1 2,2", x: 1, y: 1, pixel: [255, 255, 255, 255] },
        { draw: "stroke blue stroke-opacity 0.5 line 1,1 4,1", x: 2, y: 1, pixel: [128, 0, 128, 255] },
        { draw: "stroke blue stroke-opacity 0 fill-opacity 50% rectangle 1,1 4,3", x: 2, y: 2, pixel: [255, 128, 128, 255] },
        { draw: "fill-opacity 50% fill blue point 3,2", x: 3, y: 2, pixel: [128, 128, 255, 255] },
        { draw: "fill-opacity 0 push graphic-context fill-opacity 1 pop graphic-context point 3,2", x: 3, y: 2, pixel: [255, 255, 255, 255] },
        { draw: "stroke blue stroke-opacity 0.5 push graphic-context stroke-opacity 1 pop graphic-context line 1,1 4,1", x: 2, y: 1, pixel: [128, 0, 128, 255] },
        { draw: "fill-opacity nope point 3,2" },
        { draw: "point 1,1 stroke-opacity" },
        { draw: "fill-opacity 0 fill-opacity 1 point 3,2", x: 3, y: 2, pixel: [255, 0, 0, 255] },
        { draw: "fill-opacity 0.5 circle 3,2 4,2", x: 3, y: 2, pixel: [255, 128, 128, 255] },
        { draw: "fill-opacity 0.5 stroke blue stroke-opacity 0.5 line 1,1 4,1", x: 2, y: 1, pixel: [128, 64, 191, 255] },
    ])(`${mode}: $draw`, async ({ draw, x, y, pixel }) => {
        const original = new TextEncoder().encode("keep");
        const files = new Map([["out.png", original]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", original);
        const args = ["-size", "7x5", "xc:white", "-fill", "red", "-draw", draw, "out.png"];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs: filesystem,
        } as unknown as CommandContext;
        const result = mode === "command" ? await createMagickCommand().execute(context) : await runConvertCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : files);
        const output = mode === "map" ? files.get("out.png")! : await filesystem.readFile("/out.png");
        if (!pixel) {
            expect(result.exitCode).not.toBe(0);
            expect(output).toEqual(original);
            return;
        }
        expect(result, JSON.stringify(result)).toMatchObject({ exitCode: 0 });
        const image = decodeImage(output);
        const offset = (y! * image.width + x!) * 4;
        expect([...image.data.slice(offset, offset + 4)]).toEqual(pixel);
        expect([...image.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    });
}
