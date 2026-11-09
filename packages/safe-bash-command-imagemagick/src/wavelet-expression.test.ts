import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli, runMogrifyCliSync } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("./fixtures/wavelet-denoise-8.png", import.meta.url)));

for (const mode of ["command", "buffered", "sync", "mogrify", "retained-mogrify", "sync-mogrify"] as const) {
    it.each([
        { before: [], expression: "%[fx:w/2]%", literal: "16%" },
        { before: ["-crop", "16x16+0+0"], expression: "%[fx:w/2]%", literal: "8%" },
        { before: ["-set", "threshold", "16%"], expression: "%[threshold]", literal: "16%" },
        { before: ["-set", "option:threshold", "16%"], expression: "%[option:threshold]", literal: "16%" },
        { before: [], expression: "%[fx:w*256]x%[fx:1/2]", literal: "8192x0.5" }
    ])(`expands wavelet geometry against the current image via ${mode}: $before $expression`, async ({ before, expression, literal }) => {
        const outputs: Uint8Array[] = [];
        for (const threshold of [literal, expression]) {
            const mogrify = mode.endsWith("mogrify"), retained = mode === "command" || mode === "retained-mogrify";
            const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/input.png", input);
            const operations = [...before, "-wavelet-denoise", threshold, "-set", "option:threshold", "0"];
            const argv = mogrify ? [...operations, "/input.png"] : ["/input.png", ...operations, "PNG32:/output.png"];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode.startsWith("sync") ? (mogrify ? runMogrifyCliSync : runConvertCliSync)(argv, files)
                : await (mogrify ? runMogrifyCli : runConvertCli)(argv, retained ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            const path = mogrify ? "/input.png" : "/output.png";
            outputs.push(decodeImage(retained ? await fs.readFile(path) : files.get(path)!).data);
        }
        expect(outputs[1]).toEqual(outputs[0]);
        if (literal === "16%") {
            // ImageMagick 7.1.2-35 Q16-HDRI, pixel (16, 16) decoded as RGBA8.
            expect([...outputs[1]!.slice((16 * 32 + 16) * 4, (16 * 32 + 17) * 4)]).toEqual([189, 90, 149, 10]);
        }
    });
}
