import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: 9x8 RGBA output from a translucent 3x2 canvas.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: [], corner: "2880b070", source: "cd7c97ff", hash: "d6d3a5c2129cd2ab5c4ffc7a69cfbc1fd0fb80e3d7ddee7cbcff7b1b36450bda" },
        { options: ["-mattecolor", "orange"], corner: "ffa500ff", source: "cd7c97ff", hash: "08d3a95b70da5ab5ab351d4b1dff919803307e4d57553e3791e41ae534f4dac8" },
        { options: ["-set", "option:mattecolor", "orange"], corner: "ffa500ff", source: "cd7c97ff", hash: "08d3a95b70da5ab5ab351d4b1dff919803307e4d57553e3791e41ae534f4dac8" },
        { options: ["-bordercolor", "orange"], corner: "2880b070", source: "db6336ff", hash: "b7c2754642a2d7e25ee7adcbf854a336ba7775cfc0407a69a5fabf8d615f3e10" },
        { options: ["-set", "option:bordercolor", "orange"], corner: "2880b070", source: "db6336ff", hash: "b7c2754642a2d7e25ee7adcbf854a336ba7775cfc0407a69a5fabf8d615f3e10" },
        { options: ["-set", "bordercolor", "orange"], corner: "2880b070", source: "cd7c97ff", hash: "d6d3a5c2129cd2ab5c4ffc7a69cfbc1fd0fb80e3d7ddee7cbcff7b1b36450bda" },
        { options: ["-set", "option:mattecolor", "orange", "-mattecolor", "#2880b070"], corner: "2880b070", source: "cd7c97ff", hash: "d6d3a5c2129cd2ab5c4ffc7a69cfbc1fd0fb80e3d7ddee7cbcff7b1b36450bda" },
    ])(`${mode}: matches native frame colors for $options`, async ({ options, corner, source, hash }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["-size", "3x2", "xc:#c0306090", "-mattecolor", "#2880b070", ...options,
            "-compose", "Over", "-frame", "3x3+0+0", "-depth", "8", "rgba:-"];
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
        expect(output.byteLength).toBe(288);
        expect(output.subarray(0, 4).toString("hex")).toBe(corner);
        expect(output.subarray((3 * 9 + 3) * 4, (3 * 9 + 4) * 4).toString("hex")).toBe(source);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
