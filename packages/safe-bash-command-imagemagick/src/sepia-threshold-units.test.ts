import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, blue PNG input, decoded 8-bit RGBA output.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["80", [255, 255, 18, 255]],
        ["80x20%", [255, 255, 18, 255]],
        ["80,20%", [255, 255, 18, 255]],
        ["80 %", [255, 255, 18, 255]],
        ["80!%", [255, 255, 18, 255]],
        ["80%", [57, 29, 24, 255]],
        ["80%!", [57, 29, 24, 255]],
        ["80%x20", [57, 29, 24, 255]],
        ["80% ", [57, 29, 24, 255]],
        [" 80%", [57, 29, 24, 255]],
        ["8e+1%!", [57, 29, 24, 255]],
    ] as const)(`${mode}: reads the first threshold's unit in %j`, async (threshold, expected) => {
        const input = await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } }).png().toBuffer();
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", "-sepia-tone", threshold, "PNG32:/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
        expect(Array.from(decodeImage(output).data)).toEqual(expected);
    });
}
