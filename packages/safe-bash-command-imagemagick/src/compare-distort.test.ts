import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

const fixtures = new Map([
    ["dist.miff", new Uint8Array(readFileSync(new URL("./fixtures/compare-distort-srt.miff", import.meta.url)))],
    ["a.ppm", new TextEncoder().encode("P3\n2 1\n255\n40 80 120 160 200 240\n")],
    ["rotated.ppm", new TextEncoder().encode("P3\n2 1\n255\n160 200 240 40 80 120\n")]
]);

for (const mode of ["sync", "buffered", "retained", "compare", "magick", "magick-cli"] as const) {
    const run = async (args: string[]) => {
        const files = new Map(fixtures);
        const filesystem = new MemoryFileSystem();
        for (const [name, data] of files) await filesystem.writeFile(`/${name}`, data);
        if (mode === "sync") return runCompareCliSync(args, files);
        if (mode === "magick-cli") return runMagickCli(["compare", ...args], files);
        if (mode === "buffered" || mode === "retained") return runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
        const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]);
        let stdout = "", stderr = "";
        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
            cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        return { ...result, stdout, stderr };
    };

    it(`${mode} applies SRT to the grouped comparison operand`, async () => {
        // Native ImageMagick: 180-degree SRT reverses these two pixels exactly.
        for (const [inputs, stderr] of [
            [["(", "a.ppm", "-distort", "SRT", "180", ")", "a.ppm"], "30840 (0.470588)"],
            [["(", "a.ppm", "-distort", "SRT", "180", ")", "rotated.ppm"], "0 (0)"],
            [["rotated.ppm", "(", "a.ppm", "-distort", "SRT", "180", ")"], "0 (0)"],
            [["(", "(", "a.ppm", "-distort", "SRT", "180", ")", "-distort", "SRT", "180", ")", "a.ppm"], "0 (0)"],
            [["rotated.ppm", "rotated.ppm"], "0 (0)"],
            [["(", "a.ppm", "-distort", "SRT", "180", ")", "dist.miff"], "0 (0)"],
            [["dist.miff", "dist.miff"], "0 (0)"]
        ] as const) {
            expect(await run(["-metric", "RMSE", ...inputs, "null:"])).toMatchObject({
                exitCode: stderr === "0 (0)" ? 0 : 1, stdout: "", stderr
            });
        }
    });

    it(`${mode} rejects incomplete or unsupported distortions`, async () => {
        for (const args of [
            ["a.ppm", "-distort"], ["a.ppm", "-distort", "SRT"],
            ["(", "a.ppm", "-distort", "bogus", "180", ")", "a.ppm", "null:"],
            ["(", "a.ppm", "-distort", "SRT", "NaN", ")", "a.ppm", "null:"]
        ]) expect(await run(args)).toMatchObject({ exitCode: 2, stdout: "" });
    });
}
