import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 output, including neighboring palette sizes.
const cases = [
    { space: "LinearGray", colors: "2", unique: false, hex: "000000000000ffffff" },
    { space: "LinearGray", colors: "2", unique: true, hex: "000000ffffff" },
    { space: "LinearGray", colors: "1", unique: false, hex: "a2a2a2a2a2a2a2a2a2" },
    { space: "LinearGray", colors: "3", unique: false, hex: "6a6a6a838383dcdcdc" },
    { space: "Gray", colors: "2", unique: true, hex: "000000ffffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $space with $colors colors, unique=$unique`, async ({ space, colors, unique, hex }) => {
        const argv = ["-size", "1x1", "xc:#806642", "xc:#ff0077", "xc:#00ff00", "+append",
            "-quantize", space, "+dither", "-colors", colors, ...(unique ? ["-unique-colors"] : []),
            "-colorspace", "sRGB", "-depth", "8", "rgb:-"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        let exitCode: number;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk.slice()); } },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            exitCode = result.exitCode;
            stderr = result.stderr;
            chunks.push(result.stdoutBytes!);
        }
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.concat(chunks).toString("hex")).toBe(hex);
    });
}
