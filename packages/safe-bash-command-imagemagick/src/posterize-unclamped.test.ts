import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: associate unclamped RGB with alpha before dithering.
const multiply = ["-channel", "RGB", "-evaluate", "Multiply", "4", "+channel"];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["rgba", "PNG32"]) {
        it.each([
            { before: multiply, dither: "FloydSteinberg", expected: "00008080" },
            { before: multiply, dither: "Riemersma", expected: "00008080" },
            { before: multiply, dither: "None", expected: "80ffff80" },
            { before: [...multiply, "-clamp"], dither: "FloydSteinberg", expected: "00000080" },
            { before: [], dither: "FloydSteinberg", expected: "00000080" }
        ])(`${mode}: ${format} posterize $dither after $before`, async ({ before, dither, expected }) => {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = ["-seed", "42", "xc:#124c9e40", ...before, "-dither", dither,
                "-posterize", "3", "-depth", "8", `${format}:/out`];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(format === "PNG32" ? decodeImage(output).data : output).toString("hex")).toBe(expected);
        });
    }
}
