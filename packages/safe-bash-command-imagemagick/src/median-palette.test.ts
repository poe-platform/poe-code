import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n5 3\n255\n"),
    Buffer.from(Array.from({ length: 45 }, (_, i) => (i * 73 + 19) % 256)),
]);

// Native ImageMagick promotes indexed images after either median spelling.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { operations: [], expected: "PseudoClass sRGB " },
        { operations: ["-median", "3"], expected: "DirectClass sRGB " },
        { operations: ["-statistic", "Median", "3"], expected: "DirectClass sRGB " },
    ])(`${mode}: indexed image $operations`, async ({ operations, expected }) => {
        const args = ["-quiet", "/in.ppm", "-colors", "16", ...operations, "-format", "%r", "info:"];
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
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
            const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            exitCode = result.exitCode;
            stderr = result.stderr;
            stdout.push(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
        }
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.concat(stdout).toString()).toBe(expected);
    });
}
