import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick rounds pixel bounds before fitting the source aspect ratio.
for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-sample", "-resize", "-scale", "-thumbnail", "-adaptive-resize"]) {
        it.each([
            ["2.5x1.5", "3x2"], ["2.4x1.4", "1x1"], ["2x1", "1x1"],
            ["2.5x1.5!", "3x2"], ["2.5", "3x2"], ["x1.5", "3x2"],
            ["2.5x1.5^", "3x2"], ["2.4x1.4^", "2x1"],
            ["7.4x5.4<", "7x5"], ["7.5x5.5>", "7x5"],
            ["25.5%", "2x1"], ["2.5@", "2x1"],
        ])(`${operation} %s (${mode})`, async (geometry, shape) => {
            const input = Uint8Array.from([
                ...new TextEncoder().encode("P5\n7 5\n255\n"),
                ...Array.from({ length: 35 }, (_, i) => i + 1),
            ]);
            const files = new Map([["/in.pgm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.pgm", input);
            const argumentValues = createCommandArguments([
                "/in.pgm", "-repage", "13x9+3-2", operation, geometry,
                "-write", "gray:/pixels", "-format", "%wx%h", "info:",
            ]);
            let stdout = "", stderr = "";
            const result = mode === "public" ? { ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
                : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stderr).toBe("");
            expect(result.stdout).toBe(shape);
            if (operation === "-sample" && geometry === "2.5x1.5") {
                const pixels = mode === "public" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
                expect(Array.from(pixels)).toEqual([9, 11, 13, 23, 25, 27]);
            }
        });
    }
}
