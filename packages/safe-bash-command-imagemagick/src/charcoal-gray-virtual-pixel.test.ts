import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGBA8 output for the inline fixtures.
for (const mode of ["command", "sync"] as const) {
    it.each([
        { method: "gray", expected: "f1f1f1ff929292ff0e0e0eff" },
        { method: "background", expected: "f1f1f1ff929292ff0e0e0eff" },
        { method: "edge", expected: "fcfcfcff969696ff1c1c1cff" },
    ])(`${mode}: charcoal matches native $method virtual pixels`, async ({ method, expected }) => {
        const args = ["xc:#505860", "xc:#789080", "xc:#d0c0a0", "+append",
            "-background", "#800080008000", "-virtual-pixel", method,
            "-charcoal", "1x1", "-depth", "8", "rgba:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, new Map()) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        if ("stderr" in result) stderr = String(result.stderr);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
