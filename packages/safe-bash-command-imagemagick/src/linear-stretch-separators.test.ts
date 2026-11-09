import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// RGB samples from the 7x1 native ImageMagick 7.1.2-35 Q16-HDRI repro.
const pixels = [
    [10, 140, 45], [10, 140, 45], [90, 60, 110], [105, 195, 130],
    [165, 45, 180], [200, 80, 220], [200, 80, 220],
];

for (const mode of ["buffered", "sync", "command"] as const) {
    for (const separator of [",", "/"]) {
        it.each(["1x2", "1x1", "10x20%", "10%x20%", "0x0"])(`accepts ${separator} linear-stretch separators for %s via ${mode}`, async (geometry) => {
            const input = encodeImage({ width: 7, height: 1, format: "png", space: "srgb", channels: 3,
                density: 72, hasAlpha: false, depth: "uchar",
                data: Uint8Array.from(pixels.flatMap(pixel => [...pixel, 255])) }, { format: "png" }).data;
            let reference: Uint8Array | undefined;
            for (const currentSeparator of ["x", separator]) {
                const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const argv = ["/in.png", "-linear-stretch", geometry.replace("x", currentSeparator), "/out.png"];
                const args = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
                    argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
                    : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
                expect(result.exitCode).toBe(0);
                const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
                expect([output.width, output.height]).toEqual([7, 1]);
                if (geometry === "1x2") expect([...output.data.slice(8, 11)]).toEqual([112, 0, 224]);
                if (currentSeparator === "x") reference = output.data;
                else expect(output.data).toEqual(reference);
            }
        });
    }
}
