import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const font = new Uint8Array(readFileSync(new URL("./fixtures/DejaVuSans.ttf", import.meta.url)));
// ImageMagick 7.1.2-35 Q16-HDRI, DejaVu Sans 2.37.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { text: "Hello", size: "35x", expected: "35x16" },
        { text: "one two three", size: "35x", expected: "35x48" },
        { text: "a\nb", size: "35x", expected: "35x32" },
        { text: "Hello", size: "35x64", expected: "35x64" },
        { text: "one two three four five", size: "35x", expected: "35x80" },
        { text: "abcdefghijk", size: "35x", expected: "35x48" },
        { text: "a\n\nb", size: "35x", expected: "35x48" },
        { text: "a\n", size: "35x", expected: "35x32" },
        { text: "one two three", size: "35x64", expected: [5, 6, 7, 8, 9, 10, 11, 18, 19, 20, 21, 22, 23, 24, 25, 26, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41], rgb: true },
        { text: "a\nb", size: "35x64", gravity: "center", expected: [22, 23, 24, 25, 26, 27, 28, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43], rgb: true },
        { text: "a\nb", size: "35x64", gravity: "north", expected: [0, 1, 2, 3, 4, 5, 6, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], rgb: true },
        { text: "a\nb", size: "35x64", gravity: "south", expected: [39, 40, 41, 42, 43, 44, 45, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60], rgb: true },
        { text: "a\nb", size: "35x64", expected: "8a5550b7a6e4860c53658025a094fc740ad702d408c3cbcafa14a4f32cd1a361", rgb: true }
    ])(`${mode}: caption $text on $size`, async ({ text, size, expected, rgb, gravity }) => {
        const argv = ["-font", "font.ttf", "-pointsize", "12", "-size", size, ...(gravity ? ["-gravity", gravity] : []), `caption:${text}`,
            ...(rgb ? ["-depth", "8", "rgb:out"] : ["-format", "%wx%h", "info:out"])];
        const files = new Map([["font.ttf", font]]);
        const fs = new MemoryFileSystem();
        await fs.mkdir("/work");
        await fs.writeFile("/work/font.ttf", font);
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/work", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode, stderr || ("stderr" in result ? String(result.stderr) : "")).toBe(0);
        const output = mode === "command" ? await fs.readFile("/work/out") : files.get("out")!;
        if (rgb) expect(output.length).toBe(6720);
        if (Array.isArray(expected)) {
            const rows = Array.from({ length: 64 }, (_, y) => y)
                .filter(y => output.subarray(y * 35 * 3, (y + 1) * 35 * 3).some(value => value !== 255));
            expect(rows).toEqual(expected);
        } else expect(rgb ? createHash("sha256").update(output).digest("hex") : new TextDecoder().decode(output)).toBe(expected);
    });
}
