import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        { size: "5x1", input: "gradient:black-white", expected: [0, 64, 128, 191, 255] },
        { size: "1x5", input: "gradient:black-white", expected: [0, 64, 128, 191, 255] },
        { size: "2x3", input: "gradient:black-white", expected: [0, 0, 128, 128, 255, 255] },
        { size: "1x1", input: "gradient:black-white", expected: [0] },
        { size: "5x1", input: "radial-gradient:black-white", expected: [255, 128, 0, 128, 255] }
    ])(`generates $size $input (retained=${retained})`, async ({ size, input, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        expect(await runConvertCli(["-size", size, input, "PNG64:out.png"], retained ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect(Array.from(image.data)).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}

// RGBA reference pixels from native ImageMagick 7, including transparent-stop RGB.
for (const execution of ["buffered", "retained", "command"]) {
    const retained = execution !== "buffered";
    for (const radial of [false, true]) {
        it.each([
            { colors: "#ff000080-#0000ff40", pixels: [[255, 0, 0, 128], [170, 0, 85, 96], [0, 0, 255, 64]] },
            { colors: "red-none", pixels: [[255, 0, 0, 255], [255, 0, 0, 128], [0, 0, 0, 0]] },
            { colors: "#ff0000-#0000ff00", pixels: [[255, 0, 0, 255], [255, 0, 0, 128], [0, 0, 0, 0]] },
            { colors: "#ff000000-#0000ff00", pixels: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
            { colors: "none-red", pixels: [[0, 0, 0, 0], [255, 0, 0, 128], [255, 0, 0, 255]] },
            { colors: "red-blue", pixels: [[255, 0, 0, 255], [128, 0, 128, 255], [0, 0, 255, 255]] }
        ])(`weights gradient $colors by opacity (execution=${execution}, radial=${radial})`, async ({ colors, pixels }) => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const input = `${radial ? "radial-gradient" : "gradient"}:${colors}`;
            const argv = ["-size", radial ? "5x1" : "1x3", input, "PNG64:out.png"];
            if (execution === "command") {
                const args = createCommandArguments(argv);
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem
                });
                expect(result.exitCode).toBe(0);
            } else {
                expect(await runConvertCli(argv, retained ? { filesystem, cwd: "/" } : files))
                    .toEqual({ exitCode: 0, stdout: "", stderr: "" });
            }
            const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect(Array.from(image.data)).toEqual((radial ? [pixels[2], pixels[1], pixels[0], pixels[1], pixels[2]] : pixels).flat());
        });
    }
}
