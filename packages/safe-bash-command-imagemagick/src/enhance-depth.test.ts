import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for two neighboring RGB8 pixels.
for (const height of [1, 513]) for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { enhance: true, depth: 16, expected: "485d5c717a8f4b375f4b7d69" },
        { enhance: true, depth: 8, expected: "485c7a4b5f7d" },
        { enhance: false, depth: 16, expected: "46465a5a78784d4d61617f7f" },
    ])(`${mode}: RGB8 enhance=$enhance exported at depth $depth, height=${height}`, async ({ enhance, depth, expected }) => {
        const input = Buffer.concat([Buffer.from(`P6\n2 ${height}\n255\n`),
            Buffer.from("465a784d617f".repeat(height), "hex")]);
        const files = new Map([["/input.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.ppm", input);
        const args = ["/input.ppm", ...(enhance ? ["-enhance"] : []),
            "-depth", String(depth), "-endian", "MSB", "rgb:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(output).toString("hex")).toBe(expected.repeat(height));
    });
}
