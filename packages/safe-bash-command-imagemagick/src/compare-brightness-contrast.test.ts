import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

const source = new TextEncoder().encode("P3\n2 1\n255\n40 80 120 160 200 240\n");

// ImageMagick Q16-HDRI keeps the fractional and over-range brightened samples.
for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
    for (const [operands, metric] of [
        [["a.ppm", "a.ppm"], "0 (0)"],
        [["(", "a.ppm", "-brightness-contrast", "10x0", ")", "a.ppm"], "6553.5 (0.1)"],
        [["a.ppm", "(", "a.ppm", "-brightness-contrast", "10x0", ")"], "6553.5 (0.1)"],
        [["(", "(", "a.ppm", "-brightness-contrast", "10x0", ")", ")", "a.ppm"], "6553.5 (0.1)"],
        [["a.ppm", "-brightness-contrast", "10x0", "a.ppm"], "6553.5 (0.1)"],
        [["-brightness-contrast", "10x0", "a.ppm", "a.ppm"], "0 (0)"],
        [["a.ppm", "a.ppm", "-brightness-contrast", "10x0"], "0 (0)"],
        [["(", "a.ppm", "-brightness-contrast", "-10x0", ")", "a.ppm"], "6553.5 (0.1)"],
        [["(", "a.ppm", "-brightness-contrast", "0x0", ")", "a.ppm"], "0 (0)"],
        [["-channel", "R", "(", "a.ppm", "-brightness-contrast", "10x0", ")", "+channel", "a.ppm"], "3783.66 (0.057735)"],
    ] as const) {
        it(`applies compare brightness-contrast in operand order: ${operands.join(" ")} (${mode})`, async () => {
            const files = new Map([["a.ppm", source.slice()]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/a.ppm", source);
            const args = ["-metric", "RMSE", ...operands, "null:"];
            let result;
            if (mode === "compare" || mode === "magick") {
                const command = mode === "compare" ? createCompareCommand() : createMagickCommand();
                const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]);
                let stdout = "", stderr = "";
                result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr };
            } else result = mode === "sync" ? runCompareCliSync(args, files)
                : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result).toEqual({ exitCode: metric === "0 (0)" ? 0 : 1, stdout: "", stderr: metric });
            expect(files.get("a.ppm")).toEqual(source);
            expect(await filesystem.readFile("/a.ppm")).toEqual(source);
        });
    }
}

for (const options of [["-brightness-contrast"], ["-brightness-contrast", "bogus"]]) {
    it(`rejects invalid brightness-contrast before replacing output: ${options.join(" ")}`, async () => {
        const marker = new TextEncoder().encode("KEEP");
        const files = new Map([["diff.png", marker]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/diff.png", marker);
        const args = ["missing.ppm", "missing.ppm", "diff.png", ...options];
        for (const result of [runCompareCliSync(args, files), await runCompareCli(args, files),
            await runCompareCli(args, { filesystem, cwd: "/" })]) {
            expect(result.exitCode).toBe(2);
            expect(result.stdout).toBe("");
            expect(result.stderr).toContain(`${options.length === 1 ? "missing an argument" : "invalid argument"} for option '-brightness-contrast'`);
        }
        expect(files.get("diff.png")).toEqual(marker);
        expect(await filesystem.readFile("/diff.png")).toEqual(marker);
    });
}
