import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI reference bytes (big-endian).
    it.each([
        { levels: 3, dither: [], depth: 16, hex: "8000" },
        { levels: 5, dither: [], depth: 16, hex: "8000" },
        { levels: 3, dither: ["-dither", "FloydSteinberg"], depth: 16, hex: "8000" },
        { levels: 3, dither: ["+dither"], depth: 16, hex: "8000" },
        { levels: 3, dither: [], depth: 8, hex: "80" },
        { levels: 4, dither: [], depth: 16, hex: "aaaa" },
    ])(`${mode}: preserves posterize $levels midpoint, $dither depth $depth`, async ({ levels, dither, depth, hex }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["xc:#808080", ...dither, "-posterize", String(levels), "-depth", String(depth), "-endian", "MSB", "gray:out.gray"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" },
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.gray") : files.get("out.gray")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
