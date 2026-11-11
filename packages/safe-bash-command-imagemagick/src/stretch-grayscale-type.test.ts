import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7 Q16-HDRI retains PGM's grayscale type through solarize.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const depth of [8, 16]) {
        for (const format of ["pgm", "ppm"]) {
            it.each([[], ["-normalize"], ["-contrast-stretch", "10%x10%"]])(
                `${mode}: stretches solarized ${depth}-bit ${format}: %j`, async (...operation) => {
                    const values = depth === 8 ? [0, 64, 255] : [0, 16385, 65535];
                    const samples = format === "pgm" ? values : values.flatMap(value => [value, value, value]);
                    const input = Buffer.concat([Buffer.from(`${format === "pgm" ? "P5" : "P6"}\n3 1\n${2 ** depth - 1}\n`),
                        Buffer.from(samples.flatMap(value => depth === 8 ? [value] : [value >>> 8, value & 255]))]);
                    const argv = ["input." + format, "-channel", "G", "-solarize", "50%", "+channel", ...operation, "-depth", String(depth), "-endian", "MSB", "rgb:out"];
                    const files = new Map([["input." + format, input as Uint8Array]]);
                    const fs = new MemoryFileSystem();
                    await fs.writeFile("/input." + format, input);
                    const args = createCommandArguments(argv);
                    let stderr = "";
                    const result = mode === "command" ? await createMagickCommand().execute({
                        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                    }) : mode === "sync" ? runConvertCliSync(argv, files)
                        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
                    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
                    const expected = depth === 8
                        ? operation.length === 0 ? "000000404040ff00ff" : format === "pgm" ? "000000404040ffffff" : "000000e1e1e1ff00ff"
                        : operation.length === 0 ? "000000000000400140014001ffff0000ffff" : format === "pgm" ? "000000000000400140014001ffffffffffff" : "000000000000e0b3e0b3e0b3ffff0000ffff";
                    expect(Buffer.from(output).toString("hex")).toBe(expected);
                });
        }
    }
}
