import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Pixel output and warnings verified against ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["magick", "montage", "retained", "stream", "buffered", "sync"] as const)
for (const test of [
    { operations: ["-flatten"], width: 3, height: 1, pixels: "ff00000000ffffffff" },
    { operations: ["-layers", "flatten"], width: 3, height: 1, pixels: "ff00000000ffffffff" },
    { operations: ["-layers", "mosaic"], width: 3, height: 1, pixels: "ff00000000ffffffff" },
    { operations: ["-layers", "merge"], width: 2, height: 1, pixels: "ff00000000ff" },
    { operations: ["-flatten", "-flop"], width: 3, height: 1, pixels: "ffffff0000ffff0000" },
    { operations: ["-flatten", "-layers", "merge"], width: 3, height: 1, pixels: "ff00000000ffffffff" },
    { operations: [], width: 2, height: 2, pixels: "ff0000ff00000000ffffffff" }
]) {
    it(`${mode}: composites positioned montage inputs before tiling: ${test.operations.join(" ")}`, async () => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-background", "white", "(", "-size", "2x1", "xc:red", "-repage", "3x1+0+0", ")", "(", "-size", "1x1", "xc:blue", "-repage", "3x1+1+0", ")", ...test.operations, "-tile", "1x", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
        let stderr = "", bytes: Uint8Array | undefined, exitCode: number;
        const sink = { async write(chunk: Uint8Array) { stderr += new TextDecoder().decode(chunk); } };
        if (mode === "magick" || mode === "montage") {
            const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
            const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
            const chunks: Uint8Array[] = [];
            exitCode = (await command.execute({
                command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } }, stderr: sink
            })).exitCode;
            bytes = Buffer.concat(chunks);
        } else {
            const result = mode === "sync" ? runMontageCliSync(args, files)
                : await runMontageCli(args, mode === "buffered" ? files : {
                    filesystem, cwd: "/", ...(mode === "stream" ? { stderr: sink } : {})
                });
            ({ exitCode, stdoutBytes: bytes } = result);
            stderr += result.stderr;
        }
        expect(exitCode, stderr).toBe(0);
        expect(Buffer.from(bytes!)).toEqual(Buffer.concat([Buffer.from(`P6\n${test.width} ${test.height}\n255\n`), Buffer.from(test.pixels, "hex")]));
        expect(stderr).toBe("");
    });
}

it.each([
    { args: ["-layers"], message: "missing argument for -layers" },
    { args: ["-layers", "unknown"], message: "unsupported layer method 'unknown'" },
    { args: ["-flatten"], message: "no images found for operation -flatten" }
])("rejects invalid layer operations: $args", ({ args, message }) => {
    expect(runMontageCliSync(args, new Map())).toMatchObject({ exitCode: 1, stderr: `montage: ${message}\n` });
});
