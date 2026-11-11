import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "stream", "buffered", "sync"] as const)
for (const test of [
    { geometry: "1x1+9+9", width: 1, height: 1, pixels: "ffffff", warning: true },
    { geometry: "1x1+3+0", width: 3, height: 2, pixels: "ff0000".repeat(6), warning: true },
    { geometry: "1x1+1+0", width: 1, height: 1, pixels: "ff0000", warning: false }
]) {
    it(`${mode}: montage explicit crop ${test.geometry} preserves pixels and reports missed geometry`, async () => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-size", "3x2", "xc:red", "-crop", test.geometry, "-tile", "1x1", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
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
        expect(exitCode).toBe(0);
        const image = decodeImage(bytes!);
        expect([image.width, image.height]).toEqual([test.width, test.height]);
        const rgb = Buffer.from(test.pixels, "hex");
        expect(Array.from(image.data)).toEqual(Array.from({ length: rgb.length / 3 }, (_, index) => [
            ...rgb.subarray(index * 3, index * 3 + 3), 255
        ]).flat());
        expect(stderr).toBe(test.warning ? `montage: geometry does not contain image '${test.geometry}'\n` : "");
    });
}
