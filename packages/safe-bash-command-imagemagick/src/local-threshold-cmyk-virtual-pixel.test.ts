import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete raw CMYK reference bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { method: "white", expected: "0000000000000000" },
        { method: "gray", expected: "000000ff00000000" },
        { method: "black", expected: "000000ff000000ff" },
        { method: "edge", expected: "000000ff00000000" },
    ])(`${mode}: thresholds CMYK black ink with $method virtual pixels`, async ({ method, expected }) => {
        const args = ["xc:#505050", "xc:#909090", "+append", "-colorspace", "CMYK",
            "-virtual-pixel", method, "-lat", "3x3", "-depth", "8", "cmyk:-"];
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
