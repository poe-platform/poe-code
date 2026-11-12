import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: preserve dithered working levels above white.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { input: ["xc:#607090", "-evaluate", "multiply", "4"], name: "working levels", options: ["-ordered-dither", "o4x4,4", "-format", "%[fx:r],%[fx:g],%[fx:b]", "info:"], expected: "1.66667,2,2.33333", binary: false },
        { input: ["xc:#607090", "-evaluate", "multiply", "4"], name: "later exposure reduction", options: ["-ordered-dither", "o4x4,4", "-evaluate", "divide", "3", "-depth", "8", "rgb:-"], expected: "8eaac6", binary: true },
        { input: ["xc:#607090", "-evaluate", "multiply", "4"], name: "integer output saturation", options: ["-ordered-dither", "o4x4,4", "-depth", "8", "rgb:-"], expected: "ffffff", binary: true },
        { input: ["xc:#607090", "-evaluate", "multiply", "4"], name: "undithered control", options: ["-format", "%[fx:r],%[fx:g],%[fx:b]", "info:"], expected: "1.50588,1.75686,2.25882", binary: false },
        { input: ["xc:#223344ff", "xc:#335577ff", "xc:#303040ff", "xc:#204060ff", "+append", "-colorspace", "Lab"], name: "Lab alpha", options: ["-ordered-dither", "o2x2,3", "-format", "%[pixel:p{0,0}];%[pixel:p{1,0}];%[pixel:p{2,0}];%[pixel:p{3,0}]", "info:"], expected: "cielaba(50,0,0,1.5);cielaba(50,0,0,1);cielaba(50,0,0,1.5);cielaba(0,0,0,1)", binary: false },
        { input: ["xc:#223344ff", "xc:#335577ff", "xc:#303040ff", "xc:#204060ff", "+append", "-colorspace", "Lab"], name: "Lab unique colors", options: ["-ordered-dither", "o2x2,3", "-unique-colors", "-format", "%wx%h", "info:"], expected: "3x1", binary: false },
        { input: ["xc:#223344ff", "xc:#335577ff", "xc:#303040ff", "xc:#204060ff", "+append", "-colorspace", "Lab"], name: "Lab undithered unique colors", options: ["-unique-colors", "-format", "%wx%h", "info:"], expected: "4x1", binary: false },
        { input: ["xc:#223344ff", "xc:#335577ff", "xc:#303040ff", "xc:#204060ff", "+append", "-colorspace", "Lab"], name: "Lab integer output saturation", options: ["-ordered-dither", "o2x2,3", "-colorspace", "sRGB", "-depth", "8", "rgba:-"], expected: "777777ff777777ff777777ff000000ff", binary: true },
    ])(`${mode}: preserves over-range ordered dither $name`, async ({ input, options, expected, binary }) => {
        const argv = [...input, ...options];
        const fs = new MemoryFileSystem();
        if (mode === "command") {
            const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(chunks).toString(binary ? "hex" : "utf8")).toBe(expected);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, new Map())
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(binary ? Buffer.from(result.stdoutBytes!).toString("hex") : result.stdout).toBe(expected);
        }
    });
}
