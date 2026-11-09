import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7 reference pixels; 5x5 checks the center row.
for (const execution of ["buffered", "retained", "command"]) {
    it.each([
        { size: "5x5", expected: [255,128,0,128,255] },
        { size: "3x3", expected: [255,255,255,255,0,255,255,255,255] },
        { size: "5x1", expected: [255,128,0,128,255] },
        { size: "1x5", expected: [255,128,0,128,255] }
    ])(`uses the default radial radius for $size (${execution})`, async ({ size, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const argv = ["-size", size, "radial-gradient:black-white", "PNG64:out.png"];
        if (execution === "command") {
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem
            });
            expect(result.exitCode).toBe(0);
        } else {
            expect(await runConvertCli(argv, execution === "retained" ? { filesystem, cwd: "/" } : files))
                .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const image = decodeImage(execution === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
        expect(Array.from(size === "5x5" ? image.data.subarray(40, 60) : image.data)).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}
