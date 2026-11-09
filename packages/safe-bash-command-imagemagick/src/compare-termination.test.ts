import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// Exact stderr captured with ImageMagick 7.1.2-35 Q16-HDRI and these 4x2 PGM samples.
for (const [input, stderr, exitCode] of [
    ["a.pgm", "0 (0)", 0],
    ["b.pgm", "14538.1 (0.221837)", 1]
] as const) {
    for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
        it(`preserves native metric bytes for ${input} through ${mode}`, async () => {
            const a = Uint8Array.from([...new TextEncoder().encode("P5\n4 2\n255\n"), 10, 20, 30, 40, 50, 60, 70, 80]);
            const b = a.slice();
            b[b.length - 5] = 200;
            const files = new Map([["a.pgm", a], ["b.pgm", b]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const argv = ["-metric", "RMSE", "a.pgm", input, "diff.ppm"];
            if (mode === "compare" || mode === "magick") {
                const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
                const args = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
                const stdoutChunks: Uint8Array[] = [];
                const stderrChunks: Uint8Array[] = [];
                const result = await command.execute({
                    command: command.name, args: args.args, argumentValues: args,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdoutChunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderrChunks.push(bytes.slice()); } }
                });
                expect(result).toEqual({ exitCode });
                expect(Buffer.concat(stdoutChunks)).toEqual(Buffer.alloc(0));
                expect(Buffer.concat(stderrChunks)).toEqual(Buffer.from(stderr));
            } else {
                const result = mode === "sync" ? runCompareCliSync(argv, files)
                    : await runCompareCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result).toEqual({ exitCode, stdout: "", stderr });
            }
        });
    }
}
