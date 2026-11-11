import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: big-endian RGBA16 at pixel (1, 4).
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { background: "black", virtualPixel: "gray", angle: "-210", expected: "2a802a802a80ffff" },
        { background: "#800080008000", virtualPixel: "background", angle: "-210", expected: "2a802a802a80ffff" },
        { background: "#808080", virtualPixel: "background", angle: "-210", expected: "2aab2aab2aabffff" },
        { background: "black", virtualPixel: "gray", angle: "0", expected: "000000000000ffff" },
        { background: "black", virtualPixel: "black", angle: "-210", expected: "000000000000ffff" },
        { background: "black", virtualPixel: "white", angle: "-210", expected: "550055005500ffff" },
    ])(`${mode}: swirls $angle with $virtualPixel virtual pixels and $background background`, async ({ background, virtualPixel, angle, expected }) => {
        const args = ["-size", "2x5", "xc:black", "-background", background, "-virtual-pixel", virtualPixel,
            "-interpolate", "bilinear", "-swirl", angle, "-crop", "1x1+1+4", "+repage", "-depth", "16", "-endian", "MSB", "rgba:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        let output: Uint8Array;
        if (mode === "command") {
            const stdout: Buffer[] = [], stderr: Buffer[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
                stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stderr).toString()).toBe("");
            output = Buffer.concat(stdout);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            output = result.stdoutBytes ?? Buffer.from(result.stdout);
        }
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
