import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: empty lists fail at the operator without opening output.
for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        ["before input", ["-brightness-contrast", "10x30", "a.ppm"], false],
        ["empty group", ["a.ppm", "(", "-brightness-contrast", "0", ")"], false],
        ["deleted input", ["a.ppm", "+delete", "-brightness-contrast", "10x30", "a.ppm"], false],
        ["after input", ["a.ppm", "-brightness-contrast", "10x30"], true],
        ["populated group", ["(", "a.ppm", "-brightness-contrast", "10x30", ")"], true],
    ] as const)(`${mode}: brightness-contrast %s preserves native status and output`, async (_placement, operation, valid) => {
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["a.ppm", input], ["out", original]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", original);
        const args = [...operation, "-endian", "MSB", "-depth", "8", "rgb:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("out") : await fs.readFile("/out");
        expect.soft(result.exitCode).toBe(valid ? 0 : 1);
        expect.soft(result.stdout).toBe("");
        expect.soft(result.stderr).toBe(valid ? "" : "magick: no images found for operation '-brightness-contrast'\n");
        expect.soft(output).toEqual(valid ? Uint8Array.from([3, 96, 189, 6, 199, 255, 255, 255, 75]) : original);
    });
}
