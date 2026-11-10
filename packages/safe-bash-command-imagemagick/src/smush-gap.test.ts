import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references for the generated inputs below.
const cases = [
    { operation: "-smush", gap: ".5", output: "3x5 3x5+0+0 sRGB srgba 4.0;" },
    { operation: "+smush", gap: "-.5", output: "5x3 5x3+0+0 sRGB srgba 4.0;" },
    { operation: "-smush", gap: "(2)", output: "3x5 3x5+0+0 sRGB srgba 4.0;" },
    { operation: "-smush", gap: "x2", output: "3x5 3x5+0+0 sRGB srgba 4.0;" },
    { operation: "-smush", gap: "0", output: "3x5 3x5+0+0 sRGB srgba 4.0;" },
    { operation: "-smush", gap: "0.5", output: "3x5 3x5+0+0 sRGB srgba 4.0;" },
    { operation: "+smush", gap: "2", output: "7x3 7x3+0+0 sRGB srgba 4.0;" },
];

for (const mode of ["public", "sync"] as const) {
    it.each([
        ...cases.map(test => ({ ...test, exitCode: 0 })),
        ...["", "bad", "9007199254740992"].map(gap => ({ operation: "-smush", gap, output: "KEEP", exitCode: 1 })),
    ])(`${mode} $operation '$gap' returns $exitCode and preserves native destination behavior`, async ({ operation, gap, output, exitCode }) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", sentinel);
        const argumentValues = createCommandArguments([
            "-size", "2x3", "xc:#8040c080", "-size", "3x2", "xc:#30905040", operation, gap,
            "-format", "%wx%h %g %[colorspace] %[channels];", "info:/out",
        ]);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(argumentValues.args, files) : await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { expect(chunk.byteLength).toBe(0); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        expect(result.exitCode).toBe(exitCode);
        const error = "stderr" in result ? result.stderr : stderr;
        if (exitCode === 0) expect(error).toBe("");
        else expect(error).not.toBe("");
        expect(new TextDecoder().decode(mode === "sync" ? files.get("/out") : await fs.readFile("/out"))).toBe(output);
    });
}
