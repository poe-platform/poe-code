import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: partial matches in red/red/blue vs blue/red.
for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
    for (const [metric, threshold, score, warning] of [
        ["SSIM", "0.3", "21812.3 (0.332834) @ 0,0 [0.334331]", false],
        ["SSIM", "0.4", "21812.3 (0.332834) @ 0,0 [0.334331]", true],
        ["NCC", "0.1", "32767.5 (0.5) @ 0,0 [0]", true],
        ["NCC", "0", "32767.5 (0.5) @ 0,0 [0]", false],
        ["PSNR", "0.1", "4.77121 (0.0397601) @ 0,0 [0.0397601]", true],
        ["PSNR", "0.03", "4.77121 (0.0397601) @ 0,0 [0.0397601]", false],
        ["DSSIM", "0.3", "21812.3 (0.332834) @ 0,0 [0.332834]", false],
        ["DSSIM", "0.4", "21812.3 (0.332834) @ 0,0 [0.332834]", true],
        ["AE", "0.8", "1 (0.333333) @ 0,0 [0.333333]", false],
        ["AE", "0.3", "1 (0.333333) @ 0,0 [0.333333]", true]
    ] as const) {
        it(`${mode} applies ${metric} subimage warning threshold ${threshold}`, async () => {
            const files = new Map([
                ["wide.ppm", new TextEncoder().encode("P3\n3 1\n255\n255 0 0 255 0 0 0 0 255\n")],
                ["edge.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 0 255 255 0 0\n")]
            ]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
            const args = ["-metric", metric, "-subimage-search", "-dissimilarity-threshold", threshold,
                "wide.ppm", "edge.ppm", "null:"];
            let result;
            if (mode === "compare" || mode === "magick") {
                const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
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
            expect(result).toEqual({
                exitCode: 1,
                stdout: "",
                stderr: score + (warning ? "compare: images too dissimilar 'wide.ppm'\n" : "")
            });
        });
    }
}
