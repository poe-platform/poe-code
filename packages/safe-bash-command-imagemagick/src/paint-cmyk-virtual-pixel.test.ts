import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete raw CMYK reference bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { method: "white", expected: "ffffffffffffffffffffffff" },
        { method: "gray", expected: "808080808080808080808080" },
        { method: "edge", expected: "2b15009f2b15009f00143b2f" },
    ])(`${mode}: paints CMYK black ink with $method virtual pixels`, async ({ method, expected }) => {
        const args = ["xc:#505860", "xc:#789080", "xc:#d0c0a0", "+append",
            "-colorspace", "CMYK", "-seed", "3", "-virtual-pixel", method,
            "-paint", "1", "-depth", "8", "cmyk:-"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout.push(result.stdoutBytes);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
    });
}
