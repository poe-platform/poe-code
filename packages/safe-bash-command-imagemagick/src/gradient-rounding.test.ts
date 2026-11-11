import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI rounds the fifth of six intervals up.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { size: "1x7", colors: "black-white", depth: "8", pixels: [0, 43, 85, 128, 170, 213, 255] },
        { size: "7x1", colors: "black-white", depth: "8", pixels: [0, 43, 85, 128, 170, 213, 255] },
        { size: "1x7", colors: "white-black", depth: "8", pixels: [255, 213, 170, 128, 85, 43, 0] },
        { size: "1x5", colors: "black-white", depth: "8", pixels: [0, 64, 128, 191, 255] },
        { size: "1x7", colors: "red-blue", depth: "16", crop: true, hex: "2aab0000d555" },
        { size: "1x7", colors: "blue-red", depth: "16", crop: true, hex: "d55500002aab" }
    ])(`${mode}: rounds $size $colors at depth $depth`, async ({ size, colors, depth, pixels, crop, hex }) => {
        const args = ["-size", size, `gradient:${colors}`, ...(crop ? ["-crop", "1x1+0+5", "+repage"] : []),
            "-depth", depth, "-endian", "MSB", "rgb:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const files = new Map<string, Uint8Array>();
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(output).toString("hex")).toBe(hex ?? Buffer.from(pixels!.flatMap(value => [value, value, value])).toString("hex"));
    });
}
