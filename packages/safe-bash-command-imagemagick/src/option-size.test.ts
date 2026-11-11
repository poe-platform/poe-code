import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from({ length: 48 }, (_, i) => i + 1);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    async function run(args: string[]) {
        const files = new Map([["in.raw", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.raw", input);
        if (mode === "sync") return runMagickCliSync(args, files);
        if (mode === "buffered") return runMagickCli(args, files);
        if (mode === "retained") return runMagickCli(args, { filesystem: fs, cwd: "/" });
        const argumentValues = createCommandArguments(args), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        const stdoutBytes = Buffer.concat(chunks);
        return { ...result, stderr, stdoutBytes, stdout: stdoutBytes.toString() };
    }

    // ImageMagick 7.1.2-35: option:size changes the next raw input's geometry.
    it.each([
        { name: "direct size control", settings: ["-size", "2x2"], start: 0, length: 12 },
        { name: "assign option", settings: ["-set", "option:size", "2x2"], start: 0, length: 12 },
        { name: "replace direct size", settings: ["-size", "1x1", "-set", "option:size", "2x2"], start: 0, length: 12 },
        { name: "replace option", settings: ["-set", "option:size", "1x1", "-set", "option:size", "2x2"], start: 0, length: 12 },
        { name: "direct size overrides option", settings: ["-set", "option:size", "2x2", "-size", "1x1"], start: 0, length: 3 },
        { name: "option includes byte offset", settings: ["-set", "option:size", "2x2+3"], start: 3, length: 12 },
        { name: "replacement clears byte offset", settings: ["-size", "1x1+3", "-set", "option:size", "2x2"], start: 0, length: 12 },
        { name: "reset then assign", settings: ["-size", "1x1+3", "+set", "option:size", "-set", "option:size", "2x2"], start: 0, length: 12 },
    ])(`${mode}: $name reads exact RGB bytes`, async ({ settings, start, length }) => {
        const result = await run([...settings, "-depth", "8", "rgb:in.raw[0]", "rgb:-"]);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Array.from(result.stdoutBytes!)).toEqual(Array.from(input.slice(start, start + length)));
    });

    it.each([
        ["-size", "2x2", "+set", "option:size"],
        ["-set", "option:size", "2x2", "+set", "option:size"],
        ["-set", "option:size", "2x2", "+size"],
    ])(`${mode}: clearing size with %j requires raw dimensions again`, async (...settings) => {
        const result = await run([...settings, "-depth", "8", "rgb:in.raw[0]", "rgb:-"]);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("must specify image size");
    });

    for (const [source, defaultSize] of [["xc:orange", "1x1"], ["gradient:red-blue", "1x1"], ["pattern:checkerboard", "30x30"]]) {
        it.each([
            { name: "assign", settings: ["-set", "option:size", "2x2"], expected: "2x2" },
            { name: "replace", settings: ["-size", "1x1", "-set", "option:size", "2x2"], expected: "2x2" },
            { name: "clear direct", settings: ["-size", "2x2", "+set", "option:size"], expected: defaultSize },
            { name: "clear option", settings: ["-set", "option:size", "2x2", "+set", "option:size"], expected: defaultSize },
        ])(`${mode}: $name size before ${source}`, async ({ settings, expected }) => {
            expect(await run([...settings, source!, "-format", "%wx%h", "info:"])).toMatchObject({ exitCode: 0, stderr: "", stdout: expected });
        });
    }

    it(`${mode}: size changes affect only subsequent inputs`, async () => {
        expect(await run(["xc:red", "-set", "option:size", "2x2", "xc:blue", "+set", "option:size", "xc:lime", "-format", "%wx%h;", "info:"]))
            .toMatchObject({ exitCode: 0, stderr: "", stdout: "1x1;2x2;1x1;" });
    });

    it(`${mode}: respects parenthesized size settings`, async () => {
        expect(await run(["-respect-parentheses", "-size", "3x1", "(", "-set", "option:size", "2x2", "xc:red", ")", "xc:blue", "-format", "%wx%h;", "info:"]))
            .toMatchObject({ exitCode: 0, stderr: "", stdout: "2x2;3x1;" });
    });
}
