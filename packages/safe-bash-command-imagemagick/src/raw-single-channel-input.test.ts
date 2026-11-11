import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";
import { rawRasterInput } from "./raw-rgb.js";

// ImageMagick 7.1.2-35 Q16-HDRI imports every named single channel into red.
for (const mode of ["file", "stream", "sync"] as const) {
    it.each<{ coder: string; input: string; expected: string; options?: string[]; outputDepth?: string; selector?: string }>([
        ...["r", "g", "b", "a", "o", "c", "m", "y", "k", "G"].map(coder => ({ coder, input: "40c0", expected: "400000ffc00000ff" })),
        { coder: "gray", input: "40c0", expected: "404040ffc0c0c0ff" },
        { coder: "g", input: "1234abcd", options: ["-depth", "16", "-endian", "MSB"], outputDepth: "16", expected: "123400000000ffffabcd00000000ffff" },
        { coder: "g", input: "3412cdab", options: ["-depth", "16", "-endian", "LSB"], outputDepth: "16", expected: "123400000000ffffabcd00000000ffff" },
        { coder: "g", input: "4c", options: ["-depth", "4"], expected: "440000ffcc0000ff" },
        { coder: "g", input: "40", options: ["-depth", "1"], expected: "000000ffff0000ff" },
        { coder: "g", input: "12341234abcdabcd", options: ["-depth", "32", "-endian", "MSB"], outputDepth: "16", expected: "123400000000ffffabcd00000000ffff" },
        { coder: "g", input: "ff102040c0", options: ["-size", "2x1+1"], selector: "[1]", expected: "400000ffc00000ff" },
        ...["Line", "Plane", "Partition"].map(interlace => ({ coder: "g", input: "40c0", options: ["-interlace", interlace], expected: "400000ffc00000ff" }))
    ])(`reads $coder input through ${mode}: $options`, async ({ coder, input, expected, options = [], outputDepth = "8", selector = "" }) => {
        const bytes = Buffer.from(input, "hex");
        const argv = ["-size", "2x1", "-depth", "8", ...options, `${coder}:${mode === "stream" ? "-" : "in.bin"}${selector}`, "+interlace", "-depth", outputDepth, "-endian", "MSB", "rgba:-"];
        if (mode === "sync") {
            const result = runMagickCliSync(argv, new Map([["in.bin", bytes]]));
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(expected);
            return;
        }
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.bin", bytes);
        const args = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () { if (mode === "stream") for (const byte of bytes) yield Uint8Array.of(byte); })(),
            stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        expect(stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
        expect(Buffer.from(await fs.readFile("/in.bin"))).toEqual(bytes);
    });
}

for (const mode of ["file", "sync"] as const) {
    it.each([
        { options: [], input: "40c0", error: "must specify image size" },
        { options: ["-size", "2x1"], input: "40", error: "unexpected end-of-file" },
        { options: ["-size", "2x1", "-depth", "64"], input: "40c0", error: "unsupported G input depth" }
    ])(`preserves output on invalid named input (${mode}): $options`, async ({ options, input, error }) => {
        const files = new Map<string, Uint8Array>([["/in.bin", Buffer.from(input, "hex")], ["/out", Buffer.from("KEEP")]]);
        const argv = ["-depth", "8", ...options, "g:/in.bin", "rgba:/out"];
        if (mode === "sync") {
            const result = runMagickCliSync(argv, files);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain(error);
            expect(Buffer.from(files.get("/out")!).toString()).toBe("KEEP");
        } else {
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const result = await runConvertCli(argv, { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain(error);
            expect(Buffer.from(await filesystem.readFile("/out")).toString()).toBe("KEEP");
        }
    });
}

it.each([8, 16])("bounds partial %d-bit named-channel reads across rows and frames", depth => {
    const pixels = 10002, sample = Buffer.from(depth === 8 ? "40c0" : "1234abcd", "hex");
    const frame = Buffer.concat(Array.from({ length: pixels / 2 }, () => sample));
    const input = Buffer.concat([Buffer.from("PAD"), Buffer.alloc(frame.length), frame]);
    const raw = rawRasterInput(5001, 2, depth, "msb", input.length, "g", 3);
    const expected = Buffer.concat([
        Buffer.from(`P6\n5001 2\n${depth === 8 ? 255 : 65535}\n`),
        Buffer.from((depth === 8 ? "400000c00000" : "123400000000abcd00000000").repeat(pixels / 2), "hex")
    ]);
    expect(raw.pages).toBe(2);
    expect(raw.size).toBe(expected.length);
    for (let position = 0; position < raw.size; position += 4093) {
        const length = Math.min(10001, raw.size - position), steps = raw.read(position, length, 1);
        let next = steps.next();
        while (!next.done) {
            expect(next.value.length).toBeLessThanOrEqual(8192);
            expect(next.value.channel).toBe(0);
            next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
        }
        expect(Buffer.from(next.value)).toEqual(expected.subarray(position, position + length));
    }
});
