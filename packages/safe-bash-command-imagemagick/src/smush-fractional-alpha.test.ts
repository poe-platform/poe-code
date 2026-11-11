import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps nonzero working alpha when measuring margins,
// even when that alpha rounds to zero at the requested output depth.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        for (const depth of [8, 16]) {
            it.each([
                { alpha: "0.00001%", extent: 6, sample: 0 },
                { alpha: "0", extent: 4, sample: 0 },
                { alpha: "1%", extent: 6, sample: depth === 8 ? 3 : 655 },
            ])(`${mode}: ${operation} places alpha $alpha before depth ${depth} rounding`, async ({ alpha, extent, sample }) => {
                const size = operation === "+smush" ? "3x1" : "1x3";
                const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const argv = [
                    "-background", "none", "(", "-size", size, "xc:none",
                    "-channel", "A", "-evaluate", "set", alpha, "+channel", ")",
                    "(", "-size", size, "xc:red", ")", operation, "0", "-depth", String(depth),
                    "-format", "%wx%h|%g", "-write", "info:", "-endian", "MSB", "rgba:out",
                ];
                const argumentValues = createCommandArguments(argv);
                let stdout = "", stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                expect("stdout" in result ? result.stdout : stdout).toBe(operation === "+smush" ? `${extent}x1|6x1+0+0` : `1x${extent}|1x6+0+0`);
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
                const maximum = depth === 8 ? 255 : 65535;
                const samples = [...Array.from({ length: extent - 3 }, () => [0, 0, 0, sample]).flat(), ...Array.from({ length: 3 }, () => [maximum, 0, 0, maximum]).flat()];
                expect([...output]).toEqual(depth === 8 ? samples : samples.flatMap(value => [value >> 8, value & 255]));
            });
        }
    }
}
