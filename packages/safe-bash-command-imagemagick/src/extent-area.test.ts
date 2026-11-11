import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCliSync, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35: @ does not turn extent dimensions into an area limit.
const expanded = [
    0, 1, 2, 3, 4, 255, 255, 255, 255, 255,
    5, 6, 7, 8, 9, 255, 255, 255, 255, 255,
    10, 11, 12, 13, 14, 255, 255, 255, 255, 255,
    15, 16, 17, 18, 19, 255, 255, 255, 255, 255,
];
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["10@", 10, 4, expanded],
        ["10", 10, 4, expanded],
        ["3x2@", 3, 2, [0, 1, 2, 5, 6, 7]],
        ["3x2", 3, 2, [0, 1, 2, 5, 6, 7]],
    ] as const)(`preserves literal extent dimensions for %s (${mode})`, async (geometry, width, height, red) => {
        const pixels = Uint8Array.from(Array.from({ length: 20 }, (_, i) => [i, 0, 0]).flat());
        const input = await sharp(pixels, { raw: { width: 5, height: 4, channels: 3 } }).png().toBuffer();
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-background", "white", "-gravity", "NorthWest", "-extent", geometry, "PNG24:/out.png"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([width, height]);
        const page = runIdentifyCliSync(["-format", "%wx%h %g", "/out.png"], new Map([["/out.png", bytes]]));
        expect(page).toMatchObject({ exitCode: 0, stdout: `${width}x${height} ${width}x${height}+0+0`, stderr: "" });
        expect(output.data).toEqual(Uint8Array.from(red.flatMap(value => [value, value === 255 ? 255 : 0, value === 255 ? 255 : 0, 255])));
    });
}

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["2@+1+0", false, 1, 1, 1],
        ["2+1+0@", false, 1, 1, 1],
        ["2@", false, 2, 1, 1],
        ["2x1+1+0@", false, 2, 1, 0],
        ["7@+1+1", true, 8, 7, 12],
        ["7+1+1@", true, 8, 7, 12],
        ["2+1+0", false, 0, 0, 0],
    ] as const)(`handles scalar extent offsets %s with page=%s (${mode})`, async (geometry, page, width, height, redPixels) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = [...(page ? ["-size", "4x3"] : []), "xc:red",
            ...(page ? ["-repage", "8x7-2+1"] : []),
            "-background", "blue", "-extent", geometry, "PNG24:/out.png"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if (width === 0) {
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-extent'");
            return;
        }
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        const expected = Uint8Array.from(Array.from({ length: width * height }, (_, i) =>
            redPixels && i % width < (page ? 4 : 1) && Math.floor(i / width) < (page ? 3 : 1)
                ? [255, 0, 0, 255] : [0, 0, 255, 255]).flat());
        expect(output.data).toEqual(expected);
    });
}
