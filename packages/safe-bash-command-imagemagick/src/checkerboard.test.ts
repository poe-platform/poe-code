import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"] as const) {
    it.each([[32, 17], [17, 32], [67, 67]])(`matches native checkerboard pixels at %ix%i (${mode})`, async (width, height) => {
        const seed = new TextEncoder().encode("keep");
        const files = new Map([["/out.png", seed]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", seed);
        const argv = ["-size", `${width}x${height}`, "pattern:checkerboard", "/out.png"];
        if (mode === "command") {
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem
            });
            expect(result.exitCode).toBe(0);
        } else {
            expect(await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" }))
                .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const image = decodeImage(mode === "buffered" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
        expect([image.width, image.height]).toEqual([width, height]);
        // Native pattern repeats these 30-pixel rows, switching rows every 15 pixels.
        const light = [...Array<number>(15).fill(153), ...Array<number>(15).fill(102)];
        const dark = [...Array<number>(15).fill(102), ...Array<number>(15).fill(153)];
        const expected = Array.from({ length: height }, (_, y) =>
            Array.from({ length: width }, (_, x) => {
                const gray = (y % 30 < 15 ? light : dark)[x % 30]!;
                return [gray, gray, gray, 255];
            }).flat()).flat();
        expect(Array.from(image.data)).toEqual(expected);
    });
}
