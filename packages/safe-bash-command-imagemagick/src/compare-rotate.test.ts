import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

// Independent asymmetric PPM inputs and signed-rotation references.
const fixtures = new Map([
    ["base.ppm", new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"),
        230, 15, 64, 25, 180, 150, 120, 10, 215, 50, 120, 85, 150, 25, 35, 90, 210, 160])],
    ["clockwise.ppm", new Uint8Array([...new TextEncoder().encode("P6\n2 3\n255\n"),
        50, 120, 85, 230, 15, 64, 150, 25, 35, 25, 180, 150, 90, 210, 160, 120, 10, 215])],
    ["counter.ppm", new Uint8Array([...new TextEncoder().encode("P6\n2 3\n255\n"),
        120, 10, 215, 90, 210, 160, 25, 180, 150, 150, 25, 35, 230, 15, 64, 50, 120, 85])]
]);

for (const mode of ["sync", "async", "magick", "retained", "command"] as const) {
    it(`applies signed compare rotation before measuring distortion (${mode})`, async () => {
        for (const [args, metric, width, height] of [
            [["(", "base.ppm", "-rotate", "450", ")", "clockwise.ppm"], "0 (0)", 2, 3],
            [["(", "base.ppm", "-rotate", "-450", ")", "counter.ppm"], "0 (0)", 2, 3],
            [["(", "base.ppm", "-rotate", "90<", ")", "base.ppm"], "0 (0)", 3, 2],
            [["(", "base.ppm", "-rotate", "90>", ")", "clockwise.ppm"], "0 (0)", 2, 3],
            [["clockwise.ppm", "(", "base.ppm", "-rotate", "90", ")"], "0 (0)", 2, 3],
            [["(", "(", "base.ppm", "-rotate", "90", ")", "-rotate", "-90", ")", "base.ppm"], "0 (0)", 3, 2],
            [["base.ppm", "base.ppm"], "0 (0)", 3, 2],
            [["(", "base.ppm", "-rotate", "90", ")", "clockwise.ppm"], "0 (0)", 2, 3],
            [["(", "base.ppm", "-rotate", "-90", ")", "counter.ppm"], "0 (0)", 2, 3],
            [["base.ppm", "-rotate", "90", "clockwise.ppm"], "0 (0)", 3, 2],
            [["base.ppm", "-rotate", "-90", "counter.ppm"], "0 (0)", 3, 2],
            [["base.ppm", "-rotate", "90", "counter.ppm"], "33576.1 (0.512338)", 3, 2],
            [["base.ppm", "-rotate", "0", "base.ppm"], "0 (0)", 3, 2],
            [["base.ppm", "-rotate", "90", "-rotate", "-90", "base.ppm"], "0 (0)", 3, 2]
        ] as const) {
            const files = new Map(fixtures);
            const filesystem = new MemoryFileSystem();
            for (const [name, data] of files) await filesystem.writeFile(`/${name}`, data);
            const argv = ["-metric", "RMSE", ...args, "diff.ppm"];
            const commandArgs = createCommandArguments(["compare", ...argv]);
            let stdout = "", stderr = "";
            const result = mode === "sync" ? runCompareCliSync(argv, files)
                : mode === "magick" ? await runMagickCli(["compare", ...argv], files)
                : mode === "command" ? await createMagickCommand().execute({ command: "magick", args: commandArgs.args, argumentValues: commandArgs,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
                : await runCompareCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(mode === "command" ? { ...result, stdout, stderr } : result, args.join(" ")).toMatchObject({ exitCode: metric === "0 (0)" ? 0 : 1, stdout: "", stderr: `${metric}\n` });
            const output = (mode === "retained" || mode === "command") ? await filesystem.readFile("/diff.ppm") : files.get("diff.ppm")!;
            expect(await sharp(output).metadata()).toMatchObject({ width, height });
        }
    });
}

for (const retained of [false, true]) {
    it(`rejects invalid rotations and groups without overwriting the destination (retained=${retained})`, async () => {
        for (const args of [
            ["base.ppm", "-rotate"],
            ["base.ppm", "-rotate", "NaN", "base.ppm", "diff.ppm"],
            ["base.ppm", "-rotate", "90oops", "base.ppm", "diff.ppm"],
            ["(", "base.ppm", "-rotate", "90", "clockwise.ppm", "diff.ppm"],
            ["base.ppm", ")", "base.ppm", "diff.ppm"]
        ]) {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([...fixtures, ["diff.ppm", keep]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, data] of files) await filesystem.writeFile(`/${name}`, data);
            expect((await runCompareCli(args, retained ? { filesystem, cwd: "/" } : files)).exitCode).toBe(2);
            expect(retained ? await filesystem.readFile("/diff.ppm") : files.get("diff.ppm")).toEqual(keep);
        }
    });
}
