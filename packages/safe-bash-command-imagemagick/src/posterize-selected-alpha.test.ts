import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const method of ["FloydSteinberg", "Riemersma"]) {
        it.each([
            { color: "#9050c080", channels: ["-channel", "G"], dither: ["-dither", method], expected: "00000000" },
            { color: "#9050c0ff", channels: ["-channel", "G"], dither: ["-dither", method], expected: "00000000" },
            { color: "#9050c080", channels: ["-channel", "RGB"], dither: ["-dither", method], expected: "00000000" },
            { color: "#9050c080", channels: [], dither: ["-dither", method], expected: "80008080" },
            { color: "#9050c0", channels: ["-channel", "G"], dither: ["-dither", method], expected: "008000ff" },
            { color: "#9050c080", channels: ["-channel", "G"], dither: ["+dither"], expected: "9080c080" }
        ])(`${mode}: posterizes $color $channels $dither with palette alpha`, async ({ color, channels, dither, expected }) => {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = ["-seed", "42", `xc:${color}`, ...channels, ...dither, "-posterize", "3", "-depth", "8", "rgba:/out"];
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
