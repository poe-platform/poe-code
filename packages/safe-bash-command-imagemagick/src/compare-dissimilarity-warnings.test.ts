import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: red/red/blue searched for blue/red.
const wide = new TextEncoder().encode("P3\n3 1\n255\n255 0 0 255 0 0 0 0 255\n");
const edge = new TextEncoder().encode("P3\n2 1\n255\n0 0 255 255 0 0\n");
const cases = [
    { options: [], exitCode: 1, warning: true },
    { options: ["-quiet"], exitCode: 1, warning: false },
    { options: ["-regard-warnings"], exitCode: 2, warning: true },
    { options: ["-quiet", "-regard-warnings"], exitCode: 2, warning: false },
    { options: ["-dissimilarity-threshold", "0.8", "-regard-warnings"], exitCode: 1, warning: false },
    { options: ["-quiet", "+quiet", "-regard-warnings"], exitCode: 2, warning: true },
    { options: ["-regard-warnings", "+regard-warnings"], exitCode: 1, warning: true }
];

for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
    it.each(cases)(`honors dissimilarity warning options $options through ${mode}`, async ({ options, exitCode, warning }) => {
        for (const output of ["null:", "diff.png"]) {
            const files = new Map([["wide.ppm", wide.slice()], ["edge.ppm", edge.slice()]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const argv = ["-metric", "AE", "-subimage-search", ...options, "wide.ppm", "edge.ppm", output];
            let result;
            if (mode === "sync") result = runCompareCliSync(argv, files);
            else if (mode === "buffered") result = await runCompareCli(argv, files);
            else if (mode === "retained") result = await runCompareCli(argv, { filesystem, cwd: "/" });
            else {
                const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
                const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
                let stdout = "", stderr = "";
                const status = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                result = { ...status, stdout, stderr };
            }
            expect(result).toEqual({ exitCode, stdout: "", stderr: "1 (0.333333) @ 0,0 [0.333333]"
                + (warning ? "compare: images too dissimilar 'wide.ppm'\n" : "") });
            const names = mode === "sync" || mode === "buffered" ? [...files.keys()]
                : (await filesystem.readdir("/")).map(entry => entry.name);
            expect(names.filter(name => name.startsWith("diff"))).toEqual(output === "null:" ? [] : ["diff-0.png", "diff-1.png"]);
        }
    });
}
