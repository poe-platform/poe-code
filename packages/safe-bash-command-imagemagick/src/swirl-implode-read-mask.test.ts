import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 5\n255\n"), Buffer.from(Array.from({ length: 25 }, (_, i) => [
    (i * 37 + 19) % 256, (i * 17 + 23) % 256, (i * 59 + 5) % 256
]).flat())]);
const mask = Buffer.concat([Buffer.from("P5\n5 5\n255\n"), Buffer.from(Array.from({ length: 25 }, (_, i) => [6, 7, 11, 12].includes(i) ? 255 : 0))]);

// Native ImageMagick 7.1.2-35 Q16-HDRI stdout for these exact PPM/PGM inputs.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { interpolation: "nearest", operation: "-swirl", amount: "120", clear: false, expected: "0.627451" },
        { interpolation: "bilinear", operation: "-swirl", amount: "270", clear: false, expected: "0.633862" },
        { interpolation: "nearest", operation: "-implode", amount: "3", clear: false, expected: "0.945098" },
        { interpolation: "nearest", operation: "-swirl", amount: "120", clear: true, expected: "0.49051" },
        { interpolation: "nearest", operation: "-implode", amount: "3", clear: true, expected: "0.471686" },
        { interpolation: "nearest", operation: "-swirl", amount: "0", clear: false, expected: "0.627451" },
    ])(`${mode}: $interpolation $operation $amount, clear mask=$clear`, async ({ interpolation, operation, amount, clear, expected }) => {
        const files = new Map<string, Uint8Array>([["in.ppm", input], ["mask.pgm", mask]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["in.ppm", "-read-mask", "mask.pgm", "-interpolate", interpolation, operation, amount,
            ...(clear ? ["+read-mask"] : []), "-channel", "R", "-format", "%[fx:mean]", "info:-"];
        const commandArgs = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: commandArgs.args, argumentValues: commandArgs, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
