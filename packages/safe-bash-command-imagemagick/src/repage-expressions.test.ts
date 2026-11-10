import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: repage evaluates each frame against the live list.
const frames = ["-size", "4x3", "xc:red", "-crop", "3x2+1+1", "-size", "5x2", "xc:blue"];
const info = ["-format", "%wx%h|%g;", "info:/out"];
const crop = ["-crop", "1x1+0+0", "-depth", "8", "rgba:/out"];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { geometry: "6x3+%[fx:t]+0", tail: info, expected: "3x2|6x3+0+0;5x2|6x3+1+0;" },
        { geometry: "%[fx:n+4]x3", tail: ["-background", "black", "-flatten", ...info], expected: "6x3|6x3+0+0;" },
        { geometry: "%nx3", tail: info, expected: "3x2|2x3+1+1;5x2|2x3+0+0;" },
        { geometry: "%[fx:u[1].w]x3", tail: info, expected: "3x2|5x3+1+1;5x2|5x3+0+0;" },
        { geometry: "%[fx:u[0].page.width+2]x3", tail: info, expected: "3x2|6x3+1+1;5x2|8x3+0+0;" },
        { geometry: "%[fx:w+1]x3", tail: info, expected: "3x2|4x3+1+1;5x2|6x3+0+0;" },
        { geometry: "6x3+%[fx:t]+0", tail: crop, expected: [255, 0, 0, 255, 255, 255, 255, 0] },
        { geometry: "6x3+0+0", tail: crop, expected: [255, 0, 0, 255, 0, 0, 255, 255] },
    ])(`${mode}: repage $geometry followed by $tail`, async ({ geometry, tail, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = [...frames, "-repage", geometry, ...tail];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
        const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        expect(typeof expected === "string" ? new TextDecoder().decode(output) : [...output]).toEqual(expected);
    });
}
