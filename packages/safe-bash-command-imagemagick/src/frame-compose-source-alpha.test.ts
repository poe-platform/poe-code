import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete native ImageMagick 7.1.2-35 Q16-HDRI rasters, including the matte and bevels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "Off", compose: "Copy", geometry: "1x1+0+0", size: 3, corner: "20402040", source: "4080c0ff", hash: "8b3f7a596e5df19fb8d6665db2aee4db48f2719fb4bb334e4a44171d59b9f667" },
        { alpha: "Off", compose: "Multiply", geometry: "2x2+1+1", size: 5, corner: "667c6640", source: "3870a8ff", hash: "1a4d5c35122236ff1f5ed4818a7e4ef5cf4300b52e8e8bce80530cdf9d17d870" },
        { alpha: "Off", compose: "Xor", geometry: "1x1+0+0", size: 3, corner: "20402040", source: "00000000", hash: "13c6ae66dd0274bd1ed71dfdbd600002f3279d0ff016e51036c01577e06a3af5" },
        { alpha: "Off", compose: "Over", geometry: "1x1+0+0", size: 3, corner: "20402040", source: "4080c0ff", hash: "8b3f7a596e5df19fb8d6665db2aee4db48f2719fb4bb334e4a44171d59b9f667" },
        { alpha: "On", compose: "Copy", geometry: "1x1+0+0", size: 3, corner: "20402040", source: "4080c080", hash: "49d8efe99a58d9d33fbf36ebbf13d2da4ac7a2d0f5293655e89c0c5dc2144e30" },
    ])(`${mode}: matches native $compose frame with alpha $alpha`, async ({ alpha, compose, geometry, size, corner, source, hash }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["xc:#4080c080", "-alpha", alpha, "-colorspace", "sRGB", "-mattecolor", "#20402040",
            "-compose", compose, "-frame", geometry, "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks));
        expect(output.byteLength).toBe(size * size * 4);
        expect(output.subarray(0, 4).toString("hex")).toBe(corner);
        expect(output.subarray(Math.floor(size * size / 2) * 4, (Math.floor(size * size / 2) + 1) * 4).toString("hex")).toBe(source);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
