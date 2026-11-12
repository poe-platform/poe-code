import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 restores both canvas dimensions when either dimension is zero.
for (const mode of ["public", "buffered", "retained", "sync"] as const) {
    for (const output of ["info", "flatten"] as const) {
        it.each([
            { page: ["+repage"], width: 5, height: 3 },
            { page: [], width: 5, height: 3 },
            { page: ["-repage", "0x3+0+0"], width: 5, height: 3 },
            { page: ["-repage", "5x0+0+0"], width: 5, height: 3 },
            { page: ["-repage", "7x0+0+0"], width: 5, height: 3 },
            { page: ["-repage", "0x8+0+0"], width: 5, height: 3 },
            { page: ["-repage", "0x0+0+0"], width: 5, height: 3 },
            { page: ["-repage", "7x8+0+0"], width: 7, height: 8 },
            { page: ["-repage", "3x2+0+0"], width: 3, height: 2 },
        ])(`preserves the crop canvas after $page (${mode}, ${output})`, async ({ page, width, height }) => {
            const keep = new TextEncoder().encode("KEEP");
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", keep);
            const files = new Map([["/out", keep]]);
            const args = ["-size", "5x3", "xc:blue", ...page, "-crop", "1x1+1+1", ...(output === "info"
                ? ["-format", "%wx%h %W,%H,%X,%Y", "info:/out"]
                : ["-background", "white", "-flatten", "-depth", "8", "rgba:/out"])];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (output === "info") {
                expect(new TextDecoder().decode(bytes)).toBe(`1x1 ${width},${height},+1,+1`);
            } else {
                const expected = new Uint8Array(width * height * 4).fill(255);
                expected.set([0, 0, 255, 255], (width + 1) * 4);
                expect(bytes).toEqual(expected);
            }
        });
    }
}

// ImageMagick 7.1.2-35 Q16-HDRI dimensions for cropped and untouched partial pages.
it.each([
    { page: "7x0+0+0", operations: ["-crop", "1x1+1+1"], expected: "1x1|3x3+1+1" },
    { page: "0x8+0+0", operations: ["-crop", "1x1+1+1"], expected: "1x1|3x3+1+1" },
    { page: "7x0+0+0", operations: ["-crop", "1x1+1+1", "-flatten"], expected: "3x3|3x3+0+0" },
    { page: "0x0+0+0", operations: ["-crop", "1x1+1+1"], expected: "1x1|3x3+1+1" },
    { page: "7x8+0+0", operations: ["-crop", "1x1+1+1"], expected: "1x1|7x8+1+1" },
    { page: "7x0+0+0", operations: [], expected: "3x3|7x0+0+0" },
])("reports the native canvas for $page with $operations", async ({ page, operations, expected }) => {
    const argumentValues = createCommandArguments(["-size", "3x3", "gradient:#334411-#77aaee",
        "-repage", page, ...operations, "-format", "%wx%h|%g", "info:"]);
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: new MemoryFileSystem(),
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
});
