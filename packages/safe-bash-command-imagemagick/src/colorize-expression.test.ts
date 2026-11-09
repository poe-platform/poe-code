import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7 Q16-HDRI: RGB 285aa0 blended 50% with b4506e is 6e5587,
// including hidden RGB at alpha 0. The fill's alpha does not affect colorize.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const fill of ["#b4506e40", "#b4506e"]) {
        it.each(["50", "%[fx:w+47]", "%[fx:w+47]%", "%[strength]", "%[option:strength]", "%[local-strength]", "%[fx:w+47],%[fx:h+49],%[fx:25*2]"])(
            `${mode}: expands colorize strength %s with fill ${fill}`, async strength => {
                const input = encodeImage({ width: 3, height: 1,
                    data: Uint8Array.from([0, 128, 255].flatMap(alpha => [40, 90, 160, alpha])),
                    format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true,
                }, { format: "png" }).data;
                const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/input.png", input);
                const args = ["/input.png", "-set", "option:strength", "50", "-set", "local-strength", "50", "-fill", fill,
                    "-colorize", strength, "-set", "option:strength", "100", "-fill", "red", "PNG32:/out.png"];
                const argumentValues = createCommandArguments(args);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} },
                }) : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = decodeImage(mode === "retained" || mode === "command"
                    ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
                expect([...output.data]).toEqual([0, 128, 255].flatMap(alpha => [110, 85, 135, alpha]));
            }
        );
    }

    it(`${mode}: rejects invalid expanded strengths without replacing output`, async () => {
        const destination = new Uint8Array([1, 2, 3]);
        const files = new Map([["/out.png", destination]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", destination);
        const args = ["xc:red", "-set", "strength", "bogus", "-colorize", "%[strength]", "/out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(mode === "retained" || mode === "command"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(destination);
    });

    it(`${mode}: evaluates colorize strength against each image`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:black", "-size", "2x1", "xc:black", "-fill", "white",
            "-colorize", "%[fx:w*50]", "PNG32:/out-%d.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        for (const [scene, expected] of [[0, [128, 128, 128, 255]], [1, [255, 255, 255, 255, 255, 255, 255, 255]]] as const) {
            const path = `/out-${scene}.png`;
            expect([...decodeImage(mode === "retained" || mode === "command"
                ? await filesystem.readFile(path) : files.get(path)!).data]).toEqual(expected);
        }
    });
}
