import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { runMagickCli, runMagickCliSync, createMagickCommand } from "./index.js";

const font = new Uint8Array(readFileSync(new URL("./fixtures/DejaVuSans.ttf", import.meta.url)));

// ImageMagick 7.1.2-35 Q16-HDRI with the checked-in DejaVu Sans 2.37 font.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { text: "Hello", size: [], expected: "32x16" },
        { text: "Hello", size: ["-size", "35x"], expected: "35x16" },
        { text: "one two three", size: ["-size", "35x"], expected: "35x5" },
        { text: "a\nb", size: [], expected: "9x31" },
        { text: "Hello", size: ["-size", "35x40"], expected: "35x40" },
        { text: "Hello", size: ["-size", "35"], expected: "35x16" },
        { text: "Hello", size: ["-size", "x40"], expected: "75x40" },
        { text: "Hello", size: ["-size", "0x40"], expected: "75x40" },
        { text: "Hello", size: ["-size", "35x0"], expected: "35x16" },
        { text: "Hello", size: ["-density", "144"], expected: "62x30" },
        { text: "AVj", size: [], expected: "22x16" },
        { text: "Hello", size: ["-size", "35x40", "+size"], expected: "32x16" },
    ])(`${mode}: label $text $size`, async ({ text, size, expected }) => {
        const argv = ["-font", "font.ttf", "-pointsize", "12", ...size, "label:" + text, "-write", "rgba:pixels", "-format", "%wx%h", "info:out"];
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
        expect(result.exitCode, stderr || ("stderr" in result ? result.stderr : "")).toBe(0);
        const output = mode === "command" ? await fs.readFile("/work/out") : files.get("out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
        const pixels = mode === "command" ? await fs.readFile("/work/pixels") : files.get("pixels")!;
        const rows = text.split("\n").length;
        for (let row = 0; row < rows; row++) {
            const line = pixels.subarray(Math.floor(row * pixels.length / rows), Math.floor((row + 1) * pixels.length / rows));
            expect(line.some(value => value < 255), `line ${row + 1} has visible text`).toBe(true);
        }
    });
}
