import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 45 }, (_, index) => (index * 13 + 7) % 256))]);
const opacity = ["-format", "%[fx:p{0,0}.a]", "info:/out"];
const shadow = ["-shadow", "70x0+0+0"];

// ImageMagick 7.1.2-35 Q16-HDRI replaces Copy's unblended alpha with opaque samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { source: "in.ppm", operators: ["-alpha", "copy"], output: opacity, expected: "0.0712702" },
        { source: "in.ppm", operators: ["-alpha", "copy", ...shadow], output: opacity, expected: "0.0498891" },
        ...["deactivate", "discrete"].flatMap(alpha => [
            { source: "in.ppm", operators: ["-alpha", "copy", "-alpha", alpha], output: opacity, expected: "1" },
            { source: "in.ppm", operators: ["-alpha", "copy", "-alpha", alpha, ...shadow], output: opacity, expected: "0.7" },
            { source: "in.ppm", operators: ["-alpha", "copy", "-alpha", alpha, "-alpha", "activate"], output: opacity, expected: "1" },
            { source: "xc:#33669940", operators: ["-alpha", alpha, ...shadow], output: ["-depth", "8", "rgba:/out"], expected: Uint8Array.of(255, 255, 255, 45) }
        ])
    ])(`${mode}: $source after $operators`, async ({ source, operators, output, expected }) => {
        const argv = [source, ...operators, ...output];
        const files = new Map<string, Uint8Array>([["in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(bytes).toEqual(typeof expected === "string" ? new TextEncoder().encode(expected) : expected);
    });
}
