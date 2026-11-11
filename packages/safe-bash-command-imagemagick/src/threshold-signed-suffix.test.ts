import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const operator of ["-black-threshold", "-white-threshold"]) {
        it.each([
            ["50+1", null], ["50-1", null], ["5e+1+1", null],
            ["50%+1", "zero"], ["50%-1", "zero"], ["50+1%", "zero"],
            ["50", "absolute"], ["+50", "absolute"], ["5e+1", "absolute"], ["50%", "percent"],
        ] as const)(`${mode}: ${operator} %s handles signed suffixes`, async (threshold, cutoff) => {
            // Native ImageMagick 7.1.2-35 Q16-HDRI, including sub-50 quantum values
            // that distinguish the accepted suffix's zero cutoff from absolute 50.
            const samples = [0, 1, 49, 50, 51, 16448, 32639, 49344, 65535];
            const input = Buffer.concat([
                Buffer.from(`P5\n${samples.length} 1\n65535\n`),
                Buffer.from(samples.flatMap(value => [value >> 8, value & 255])),
            ]);
            const destination = new TextEncoder().encode("keep");
            const files = new Map<string, Uint8Array>([["/in.pgm", input], ["/out", destination]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.pgm", input);
            await fs.writeFile("/out", destination);
            const argv = ["/in.pgm", "-channel", "RGB", operator, threshold, "-depth", "16", "-endian", "MSB", "rgb:/out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(result.exitCode).toBe(cutoff === null ? 1 : 0);
            if (cutoff === null) {
                expect("stderr" in result ? result.stderr : stderr).toContain(operator);
                expect(output).toEqual(destination);
            } else {
                const expected = cutoff === "zero"
                    ? operator === "-black-threshold" ? samples : [0, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535]
                    : cutoff === "absolute"
                        ? operator === "-black-threshold" ? [0, 0, 0, 50, 51, 16448, 32639, 49344, 65535] : [0, 1, 49, 50, 65535, 65535, 65535, 65535, 65535]
                        : operator === "-black-threshold" ? [0, 0, 0, 0, 0, 0, 0, 49344, 65535] : [0, 1, 49, 50, 51, 16448, 32639, 65535, 65535];
                expect(Array.from(output)).toEqual(expected.flatMap(value => Array(3).fill([value >> 8, value & 255]).flat()));
            }
        });
    }
}
