import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const operator of ["-level-colors", "+level-colors"] as const) {
        it.each([
            { label: "before the first image", prefix: [], suffix: ["a.ppm"], valid: false },
            { label: "inside an empty image group", prefix: ["a.ppm", "("], suffix: [")"], valid: false },
            { label: "after deleting all images", prefix: ["a.ppm", "+delete"], suffix: ["a.ppm"], valid: false },
            { label: "after the input image", prefix: ["a.ppm"], suffix: [], valid: true },
            { label: "inside a populated image group", prefix: ["(", "a.ppm"], suffix: [")"], valid: true }
        ])(`${mode}: ${operator} $label`, async ({ prefix, suffix, valid }) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["a.ppm", input], ["out", original]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
            const args = [...prefix, operator, "red,blue", ...suffix, "-endian", "MSB", "-depth", "16", "rgb:out"];
            let stdout = "", stderr = "";
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
            expect.soft(result.exitCode).toBe(valid ? 0 : 1);
            expect.soft(result.stdout).toBe("");
            if (valid) {
                expect.soft(result.stderr).toBe("");
                expect(Buffer.from(output).toString("hex")).toBe(operator === "-level-colors"
                    ? "f0f0ffff9191eeeeffffe7e73c3cffff4141"
                    : "f0f000009191eeee0000e7e73c3c00004141");
            } else {
                expect.soft(result.stderr).toContain(`no images found for operation '${operator}'`);
                expect.soft(output).toEqual(original);
            }
        });
    }
}
