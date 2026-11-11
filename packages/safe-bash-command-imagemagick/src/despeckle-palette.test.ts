import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: despeckle promotes palettes and drops undefined alpha.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { source: "#345678", operations: ["-type", "Palette", "-despeckle"], expected: "DirectClass sRGB |srgb  3.0" },
        { source: "#34567880", operations: ["-type", "Palette", "-despeckle"], expected: "DirectClass sRGB |srgb  3.0" },
        { source: "#34567880", operations: ["-type", "Palette", "-despeckle", "-alpha", "activate"], expected: "24466800", raw: true },
        { source: "#345678", operations: ["-type", "Palette"], expected: "PseudoClass sRGB |srgb  4.0" },
        { source: "#345678", operations: ["-despeckle"], expected: "DirectClass sRGB |srgb  3.0" },
    ])(`${mode}: $source $operations`, async ({ source, operations, expected, raw }) => {
        const args = [`xc:${source}`, ...operations, ...(raw ? ["-depth", "8", "rgba:-"] : ["-format", "%r|%[channels]", "info:"])];
        const filesystem = new MemoryFileSystem();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        let exitCode: number;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            exitCode = result.exitCode;
        } else {
            const files = new Map<string, Uint8Array>();
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            exitCode = result.exitCode;
            stderr = result.stderr;
            stdout.push(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
        }
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.concat(stdout).toString(raw ? "hex" : "utf8")).toBe(expected);
    });
}
