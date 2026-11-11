import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// Metrics and plus-form semantics verified against ImageMagick 7.1.2-35 Q16-HDRI.
const a = new TextEncoder().encode("P3\n2 1\n255\n40 80 120 160 200 240\n");
const b = new TextEncoder().encode("P3\n2 1\n255\n40 80 120 160 199 240\n");
const search = new TextEncoder().encode("P3\n2 2\n255\n112 112 112 144 144 144 128 128 128 128 128 128\n");
const patch = new TextEncoder().encode("P3\n1 1\n255\n128 128 128\n");
const cases = [
    { option: "precision", settings: ["-metric", "RMSE", "-precision", "2"], inputs: ["a.ppm", "b.ppm"],
        expected: { exitCode: 1, stdout: "", stderr: "1e+02 (0.0016)" } },
    { option: "format", settings: ["-metric", "RMSE", "-format", "hello"], inputs: ["a.ppm", "a.ppm"],
        expected: { exitCode: 0, stdout: "hello", stderr: "0 (0)" } },
    { option: "metric", settings: ["-metric", "AE"], inputs: ["a.ppm", "b.ppm"],
        expected: { exitCode: 1, stdout: "", stderr: "0.00130719 (0.000653595)" } },
    { option: "fuzz", settings: ["-metric", "AE", "-fuzz", "10%"], inputs: ["a.ppm", "b.ppm"],
        expected: { exitCode: 1, stdout: "", stderr: "0.00130719 (0.000653595)" } },
    { option: "similarity-threshold", settings: ["-metric", "RMSE", "-subimage-search", "-dissimilarity-threshold", "1", "-similarity-threshold", "0.1"], inputs: ["search.ppm", "patch.ppm"],
        expected: { exitCode: 1, stdout: "", stderr: "4112 (0.0627451) @ 0,0 [0.0627451]" } },
    { option: "dissimilarity-threshold", settings: ["-metric", "RMSE", "-subimage-search", "-similarity-threshold", "0.1", "-dissimilarity-threshold", "0"], inputs: ["search.ppm", "patch.ppm"],
        expected: { exitCode: 1, stdout: "", stderr: "4112 (0.0627451) @ 0,0 [0.0627451]compare: images too dissimilar 'search.ppm'\n" } }
];

for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
    async function run(argv: string[]) {
        const files = new Map([["a.ppm", a], ["b.ppm", b], ["search.ppm", search], ["patch.ppm", patch],
            ["+unknown.ppm", a], ["+precision.ppm", a]]);
        if (mode === "sync") return runCompareCliSync(argv, files);
        if (mode === "buffered") return runCompareCli(argv, files);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        if (mode === "retained") return runCompareCli(argv, { filesystem, cwd: "/" });
        const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
        const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
        let stdout = "", stderr = "";
        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
            cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        return { ...result, stdout, stderr };
    }

    for (const { option, settings, inputs, expected } of cases) {
        it(`handles +${option} with native semantics through ${mode}`, async () => {
            const control = await run([...settings, ...inputs, "null:"]);
            expect(control).toEqual(option === "fuzz" ? { exitCode: 0, stdout: "", stderr: "0 (0)" } : expected);
            expect(await run([...settings, `+${option}`, ...inputs, "null:"])).toEqual(expected);
        });
    }

    it(`accepts plus settings without prior values through ${mode}`, async () => {
        expect(await run([...cases.map(({ option }) => `+${option}`), "a.ppm", "a.ppm", "null:"]))
            .toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
    });

    for (const filename of ["+unknown.ppm", "+precision.ppm"]) {
        it(`keeps ${filename} as an image operand through ${mode}`, async () => {
            expect(await run([filename, "a.ppm", "null:"])).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
        });
    }
}
