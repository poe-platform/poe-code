import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2: embedded TIFF orientation is not a persistent -orient setting.
const cases = [
    { options: [], expected: "3x2|RightTop;" },
    { options: ["-auto-orient"], expected: "2x3|TopLeft;" },
    { options: ["-hough-lines", "1x1+3"], expected: "3x2|Undefined;" },
    { options: ["-hough-lines", "1x1+3", "-auto-orient"], expected: "3x2|TopLeft;" },
    { options: ["-orient", "RightTop", "-hough-lines", "1x1+3"], expected: "3x2|RightTop;" },
    { options: ["-orient", "RightTop", "-hough-lines", "1x1+3", "-auto-orient"], expected: "2x3|RightTop;" },
    { options: ["-define", "hough-lines:accumulator=true", "-hough-lines", "1x1+3"], expected: "3x2|Undefined;180x4|Undefined;" },
    { options: ["-define", "hough-lines:accumulator=true", "-hough-lines", "1x1+3", "-auto-orient"], expected: "3x2|TopLeft;180x4|TopLeft;" }
];

for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each(cases)(`handles embedded orientation through Hough lines (${mode}): $options`, async ({ options, expected }) => {
        const { data } = encodeImage({
            width: 3, height: 2, data: Uint8Array.from({ length: 24 }, (_, index) => index % 4 === 3 ? 255 : 0),
            format: "tiff", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, orientation: 6
        }, { format: "tiff" });
        const files = new Map([["/input.tiff", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.tiff", data);
        const args = ["/input.tiff", ...options, "-format", "%wx%h|%[orientation];", "info:"];
        if (mode === "public") {
            let stdout = "", stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args,
                cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
                stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
            });
            expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
        }
    });
}
