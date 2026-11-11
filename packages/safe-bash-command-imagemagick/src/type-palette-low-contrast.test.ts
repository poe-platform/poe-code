import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference values.
// The reference ramp retains 12 colors without conversion and 10 with default dithering.
const input = Buffer.concat([Buffer.from("P6\n12 1\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => [70, 90, 120][i % 3]! + (Math.floor(i / 3) * 7) % 19))]);
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operations: [], count: "12", pixels: "465a784d617f546886485c7a4f6381566a884a5e7c516583586c8a4c607e536785475b79" },
        { operations: ["-type", "Palette"], count: "10", pixels: "465a784d617f546886485c7a4f6381566a884a5e7c516583586c8a4d617f536785465a78" },
        { operations: ["+dither", "-type", "Palette"], count: "12", pixels: "465a784d617f546886485c7a4f6381566a884a5e7c516583586c8a4c607e536785475b79" },
    ])(`${mode}: low-contrast ramp $operations`, async ({ operations, count, pixels }) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const files = new Map<string, Uint8Array>([["in.ppm", input]]);
        const argv = ["in.ppm", ...operations, "-format", "%k", "-write", "info:count", "-depth", "8", "rgb:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        for (const [path, encoding, expected] of [["count", "utf8", count], ["out", "hex", pixels]] as const) {
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile(`/${path}`) : files.get(path)!;
            expect(Buffer.from(bytes).toString(encoding)).toBe(expected);
        }
    });
}
