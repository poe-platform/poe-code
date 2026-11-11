import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: gray borders are exactly half the quantum range.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { method: "gray", expected: "801780178017" },
        { method: "background", expected: "808180818081" },
        { method: "edge", expected: "808180818081" },
    ])(`${mode}: enhances with native $method virtual-pixel precision`, async ({ method, expected }) => {
        const fs = new MemoryFileSystem();
        const args = ["xc:#808080", "-background", "#808080", "-virtual-pixel", method,
            "-enhance", "-depth", "16", "-endian", "MSB", "rgb:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        if ("stderr" in result) stderr = String(result.stderr);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
