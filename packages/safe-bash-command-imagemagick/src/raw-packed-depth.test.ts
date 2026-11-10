import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Reference bytes from ImageMagick 7.1.2-35 Q16-HDRI; packed rows restart on byte boundaries.
const cases = [
    { coder: "rgb", depth: 10, input: "093e73a8dd12477cb1e61b5085baef24", expected: "09f93aff37121effb198b4ff21babcff" },
    { coder: "rgb", depth: 12, input: "093e73a8dd12477cb1e61b5085baef24598e", expected: "09e6a8ffd047caffe5b485ffae2498ff" },
    { coder: "gray", depth: 10, input: "093e73a8dd12", expected: "090909fff9f9f9ffa8a8a8ff747474ff" },
    { coder: "gray", depth: 12, input: "093e73a8dd12", expected: "090909ffe6e6e6ffa8a8a8ffd0d0d0ff" },
    { coder: "rgb", depth: 16, input: "093e73a8dd12477cb1e61b5085baef24598ec3f82d6297cc", expected: "3ea813ff7ce650ffba258efff862ccff" }
];

for (const mode of ["file", "stream", "sync"] as const) {
    it.each(cases.flatMap(test => [
        { ...test, error: "" },
        { ...test, input: test.input + test.input, expected: test.expected + test.expected, error: "" },
        { ...test, input: test.input + "ff", error: "" },
        { ...test, input: test.input + test.input.slice(0, test.input.length / 2), expected: "4b454550", error: `unexpected end-of-file in ${test.coder.toUpperCase()} input` },
        { ...test, input: test.input.slice(0, -2), expected: "4b454550", error: `unexpected end-of-file in ${test.coder.toUpperCase()} input` }
    ]))(`reads raw sample depths via ${mode}: $coder $depth $error`, async ({ coder, depth, input, expected, error }) => {
        const bytes = Buffer.from(input, "hex");
        const argv = ["-size", "2x2", "-depth", String(depth), `${coder}:${mode === "stream" ? "-" : "raw.bin"}`, "-append", "-depth", "8", "rgba:out"];
        let stderr = "", output: Uint8Array, exitCode: number;
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([["raw.bin", bytes], ["out", Buffer.from("KEEP")]]);
            const result = runMagickCliSync(argv, files);
            stderr = result.stderr;
            exitCode = result.exitCode;
            output = files.get("out")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/raw.bin", bytes);
            await fs.writeFile("/out", Buffer.from("KEEP"));
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            exitCode = result.exitCode;
            output = await fs.readFile("/out");
        }
        expect(exitCode).toBe(error ? 1 : 0);
        if (error) expect(stderr).toContain(error);
        else expect(stderr).toBe("");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
