import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = encodeImage({ width: 3, height: 1, format: "png", space: "srgb", channels: 4,
    density: 72, hasAlpha: true, depth: "uchar",
    data: Uint8Array.of(220, 40, 70, 255, 40, 200, 100, 128, 25, 100, 220, 0) }, { format: "png" }).data;

for (const mode of ["buffered", "sync", "command"] as const) {
    it.each([
        { before: [], literal: "80,60,120" },
        { before: ["-resize", "5x1!"], literal: "82,60,120" }
    ])(`expands modulation brightness using the current image via ${mode}: $before`, async ({ before, literal }) => {
        const outputs: Uint8Array[] = [];
        for (const value of [literal, "%[fx:w+77],60,120"]) {
            const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["/in.png", ...before, "-modulate", value, "PNG32:/out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
                argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
                : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
            expect(result.exitCode).toBe(0);
            outputs.push(decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!).data);
        }
        expect(outputs[1]).toEqual(outputs[0]);
        if (before.length === 0) {
            // ImageMagick 7.1.2-35 Q16-HDRI: RGB changes even when alpha is zero.
            expect([...outputs[1]!]).toEqual([149, 98, 59, 255, 58, 134, 132, 128, 71, 51, 145, 0]);
        }
    });
}
