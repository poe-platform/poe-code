import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: +monochrome preserves pixels, including prior conversion.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { input: ["xc:#204080", "+monochrome"], expected: "204080ff" },
        { input: ["xc:#303030", "xc:#404040", "+append", "+monochrome"], expected: "303030ff404040ff" },
        { input: ["xc:#204080", "-monochrome", "+monochrome"], expected: "000000ff" },
        { input: ["xc:#204080"], expected: "204080ff" },
        { input: ["xc:#204080", "-monochrome"], expected: "000000ff" },
        { input: ["+monochrome", "xc:#204080"], expected: "204080ff" },
        { input: ["xc:#204080", "+monochrome", "-monochrome"], expected: "000000ff" },
        { input: ["xc:#20408080", "+monochrome", "+monochrome"], expected: "20408080" }
    ])(`${mode}: $input`, async ({ input, expected }) => {
        const argv = [...input, "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem();
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(chunks)
            : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
        expect(output.toString("hex")).toBe(expected);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`accepts +monochrome in mogrify (${mode})`, async () => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const input = mode === "retained" ? { filesystem, cwd: "/" } : files;
        expect((await runMagickCli(["xc:#204080", "/input.png"], input)).exitCode).toBe(0);
        const argv = ["mogrify", "+monochrome", "/input.png"];
        const result = mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, input);
        expect(result.exitCode, result.stderr).toBe(0);
        const image = decodeImage(mode === "retained" ? await filesystem.readFile("/input.png") : files.get("/input.png")!);
        expect([...image.data]).toEqual([32, 64, 128, 255]);
    });
}
