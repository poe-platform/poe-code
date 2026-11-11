import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference pixels.
        [5, "3x3!", "3x3", [8, 9, 10, 13, 14, 15, 18, 19, 20]],
        [5, "5x4!", "5x4", Array.from({ length: 20 }, (_, i) => i + 1)],
        [4, "3x3!", "3x3", [1, 3, 4, 7, 8, 10, 18, 14, 20]],
    ] as const)(`${mode}: uses %s channels for seams at %s`, async (channels, geometry, size, expected) => {
        const input = Buffer.concat([Buffer.from("P5\n5 4\n255\n"), Buffer.from(Array.from({ length: 20 }, (_, i) => i + 1))]);
        const files = new Map([["/grid.pgm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/grid.pgm", input);
        const args = ["/grid.pgm", "/grid.pgm", "/grid.pgm", "-size", "5x4", "xc:white", ...(channels === 5 ? ["/grid.pgm"] : []), "-combine",
            "-liquid-rescale", geometry,
            "-format", "%wx%h;", "-write", "info:", "-depth", "8", "gray:-"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const chunks: Uint8Array[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            signal: new AbortController().signal,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = "stdout" in result && typeof result.stdout === "string"
            ? Buffer.concat([Buffer.from(result.stdout), Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : [])])
            : Buffer.concat(chunks);
        expect(output).toEqual(Buffer.concat([Buffer.from(`${size};`), Buffer.from(expected)]));
    });
}
