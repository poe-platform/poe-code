import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: each input followed by [+-]smush GAP -format '%wx%h|%g' info:.
const cases = [
    { name: "first page", args: ["(", "xc:#ff000080", "-repage", "4x6+2+3", ")", "xc:#0000ff80"], gap: "0", expected: ["1x2|4x12+2+3", "2x1|8x6+2+3"] },
    { name: "unpaged", args: ["xc:red", "xc:blue"], gap: "0", expected: ["1x2|1x2+0+0", "2x1|2x1+0+0"] },
    { name: "second page ignored", args: ["xc:red", "(", "xc:blue", "-repage", "10x20+8+9", ")"], gap: "0", expected: ["1x2|1x2+0+0", "2x1|2x1+0+0"] },
    { name: "single image", args: ["xc:red", "-repage", "4x6-2-3"], gap: "0", expected: ["1x1|4x6-2-3", "1x1|4x6-2-3"] },
    { name: "gap scales offsets", args: ["(", "xc:red", "-repage", "4x6+2+3", ")", "xc:blue"], gap: "2", expected: ["1x4|4x24+2+12", "4x1|16x6+8+3"] },
    { name: "unequal sizes round page and offsets", args: ["(", "-size", "2x3", "xc:red", "-repage", "5x7-3+4", ")", "(", "-size", "3x2", "xc:blue", ")"], gap: "0", expected: ["3x5|8x12-5+6", "5x3|13x7-3+4"] },
    { name: "transparent margins retain untrimmed page", args: ["-background", "none", "(", "-size", "3x3", "xc:none", "-fill", "red", "-draw", "point 1,1", "-repage", "6x9+2+3", ")", "(", "-size", "3x3", "xc:none", "-fill", "blue", "-draw", "point 1,1", ")"], gap: "0", expected: ["3x4|6x18+2+3", "4x3|12x9+2+3"] },
    { name: "offset without page size", args: ["(", "xc:red", "-repage", "+2-3", ")", "xc:blue"], gap: "0", expected: ["1x2|1x2+2-3", "2x1|2x1+2-3"] },
];

for (const mode of ["public", "sync"] as const) {
    for (const [direction, operation] of ["-smush", "+smush"].entries()) {
        it.each(cases)(`${mode} ${operation}: $name`, async ({ args, gap, expected }) => {
            const argumentValues = createCommandArguments([...args, operation, gap, "-format", "%wx%h|%g", "info:/out"]);
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            let stderr = "";
            const result = mode === "sync" ? runConvertCliSync(argumentValues.args, files) : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
            expect(new TextDecoder().decode(output)).toBe(expected[direction]);
        });

        it.each([false, true])(`${mode} ${operation}: crop uses source offset, paged=%s`, async paged => {
            const argumentValues = createCommandArguments([
                "(", "xc:red", ...(paged ? ["-repage", "4x6+2+3"] : []), ")", "xc:blue", operation, "0",
                "-crop", "1x1+2+3", "+repage", "-depth", "8", "rgba:/out"
            ]);
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            let stderr = "";
            const result = mode === "sync" ? runConvertCliSync(argumentValues.args, files) : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
            expect(result.exitCode).toBe(0);
            if (paged) expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
            expect([...output]).toEqual(paged ? [255, 0, 0, 255] : [255, 255, 255, 0]);
        });
    }
}
