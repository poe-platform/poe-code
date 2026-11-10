import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const rgb = "093e73a8dd12477cb1e61b50";
const rgba = "093e73ffa8dd12ff477cb1ffe61b50ff";
const gray = "090909ff3e3e3eff737373ffa8a8a8ff";

for (const mode of ["command", "sync"] as const) {
    it.each([
        { operand: "input.rgb", path: "input.rgb", input: rgb, expected: rgba },
        { operand: "input.RGB", path: "input.RGB", input: rgb, expected: rgba },
        { operand: "rgb:raw.bin", path: "raw.bin", input: rgb, expected: rgba },
        { operand: "input.gray", path: "input.gray", input: "093e73a8", expected: gray },
        { operand: "gray:input.rgb", path: "input.rgb", input: "093e73a8", expected: gray },
        { operand: "input.rgb[1x1+1+0]", path: "input.rgb", input: rgb, expected: "a8dd12ff" },
        { operand: "rgb:raw.bin[1x1+1+0]", path: "raw.bin", input: rgb, expected: "a8dd12ff" }
    ])(`decodes raw filename inputs (${mode}): $operand`, async ({ operand, path, input, expected }) => {
        const bytes = Buffer.from(input, "hex");
        const argv = ["-size", "2x2", "-depth", "8", operand, "-append", "-depth", "8", "rgba:out"];
        const files = new Map<string, Uint8Array>([[path, bytes], ["out", Buffer.from("KEEP")]]);
        let output: Uint8Array;
        if (mode === "sync") {
            const result = runMagickCliSync(argv, files);
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            output = files.get("out")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile(`/${path}`, bytes);
            await fs.writeFile("/out", Buffer.from("KEEP"));
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
            output = await fs.readFile("/out");
        }
        // Exact RGBA8 bytes from native ImageMagick, including the RGB/GRAY controls.
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });

    for (const operand of ["input.rgb", "rgb:input.rgb"]) {
        it.each([
            { options: [], input: rgb, error: "must specify image size" },
            { options: ["-size", "2x2", "-depth", "8"], input: "093e73", error: "unexpected end-of-file" }
        ])(`preserves output on invalid raw RGB input (${mode}, ${operand}): $error`, async ({ options, input, error }) => {
            const bytes = Buffer.from(input, "hex"), original = Buffer.from("KEEP");
            const argv = [...options, operand, "-append", "-depth", "8", "rgba:out"];
            if (mode === "sync") {
                const files = new Map<string, Uint8Array>([["input.rgb", bytes], ["out", original]]);
                const result = runMagickCliSync(argv, files);
                expect(result.exitCode).toBe(1);
                expect(result.stderr).toContain(error);
                expect(files.get("out")).toBe(original);
            } else {
                const fs = new MemoryFileSystem();
                await fs.writeFile("/input.rgb", bytes);
                await fs.writeFile("/out", original);
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                expect(result.exitCode).toBe(1);
                expect(stderr).toContain(error);
                expect(await fs.readFile("/out")).toEqual(new Uint8Array(original));
            }
        });
    }
}
