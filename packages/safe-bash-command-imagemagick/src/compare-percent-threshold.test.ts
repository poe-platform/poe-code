import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI accepts '%' without scaling either threshold.
for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
    for (const [similarity, dissimilarity, stopped, warning] of [
        ["1%", "1", true, false],
        ["3%", "1", true, false],
        ["0.03", "1", false, false],
        ["0.032", "1", true, false],
        ["0.2", "1%", true, false],
        ["0.2", "0.032", true, false],
        ["0.2", "0.03", true, true],
        ["0.2", "0.03%", true, true],
        ["0.2", "0.032%", true, false]
    ] as const) {
        it(`${mode} compares with similarity ${similarity} and dissimilarity ${dissimilarity}`, async () => {
            const files = new Map([
                ["two.pgm", new TextEncoder().encode("P2\n1 2\n255\n120 128\n")],
                ["gray.pgm", new TextEncoder().encode("P2\n1 1\n255\n128\n")]
            ]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
            const args = ["-metric", "RMSE", "-subimage-search", "-similarity-threshold", similarity,
                "-dissimilarity-threshold", dissimilarity, "two.pgm", "gray.pgm", "null:"];
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
                exitCode: stopped ? 1 : 0,
                stdout: "",
                stderr: (stopped ? "2056 (0.0313725) @ 0,0 [0.0313725]" : "0 (0) @ 0,1 [0]")
                    + (warning ? "compare: images too dissimilar 'two.pgm'\n" : "")
            });
        });
    }
}
