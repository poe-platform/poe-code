import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: +ordered-dither is deprecated; the minus form still dithers.
const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: ["+ordered-dither", "o4x4"], position: 2 },
        { options: ["+ordered-dither"], position: 2 },
        { options: ["(", "-depth", "8", "+ordered-dither", "o4x4", ")"], position: 5 },
        { options: ["-ordered-dither", "o4x4"], position: 0 }
    ])(`${mode}: matches native ordered-dither status and output for $options`, async ({ options, position }) => {
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", ...options, "-depth", "8", "rgb:-"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(position ? 1 : 0);
        expect.soft("stderr" in result ? result.stderr : stderr).toBe(position
            ? `magick: option deprecated, unable to execute '+ordered-dither' at CLI arg ${position}\n` : "");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : "stdout" in result ? result.stdout : stdout)
            .toBe(position ? "" : "00ffff000000");
    });
}
