import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI outputs, including the trailing space without alpha.
for (const mode of ["sync", "buffered", "command"] as const) {
    it.each([
        { input: ["in.pgm"], type: [], expected: "Gray|DirectClass Gray " },
        { input: ["in.pgm"], type: ["-type", "TrueColor"], expected: "Gray|DirectClass Gray " },
        { input: ["in.pgm"], type: ["-type", "TrueColorAlpha"], expected: "Gray|DirectClass Gray Alpha" },
        { input: ["xc:red", "-colorspace", "Gray"], type: ["-type", "TrueColor"], expected: "Gray|DirectClass Gray " },
        { input: ["xc:red", "-colorspace", "Gray"], type: ["-type", "TrueColorAlpha"], expected: "Gray|DirectClass Gray Alpha" },
        { input: ["xc:#806020"], type: ["-type", "TrueColor"], expected: "sRGB|DirectClass sRGB " },
        { input: ["xc:#806020"], type: ["-type", "TrueColorAlpha"], expected: "sRGB|DirectClass sRGB Alpha" },
    ])(`retains colorspace for $input $type via ${mode}`, async ({ input, type, expected }) => {
        const pgm = Buffer.concat([Buffer.from("P5\n6 5\n255\n"), Buffer.from(Array.from({ length: 30 }, (_, i) => i * 8))]);
        const files = new Map([["in.pgm", pgm], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, data] of files) await fs.writeFile(`/${name}`, data);
        const args = [...input, ...type, "-format", "%[colorspace]|%r", "info:out"];
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : mode === "buffered" ? await runMagickCli(args, files)
                : await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { write: async chunk => { stdout += chunk; } },
                    stderr: { write: async chunk => { stderr += chunk; } },
                });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect(Buffer.from(mode === "command" ? await fs.readFile("/out") : files.get("out")!).toString()).toBe(expected);
    });
}
