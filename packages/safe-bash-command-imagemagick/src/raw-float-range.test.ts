import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: remove input defines before exporting RGBA bytes.
const cases = [
    { name: "maximum", values: [18, 52, 86], half: "4c8052805560", defines: ["quantum:maximum=255"], rgba: "123456ff", halfRgba: "ffffffff" },
    { name: "minimum", values: [-0.5, 0, 0.5], half: "b80000003800", defines: ["quantum:minimum=-1"], rgba: "4080bfff", halfRgba: "000080ff" },
    { name: "scale", values: [1000, 4000, 8000], half: "63d06bd06fd0", defines: ["quantum:scale=2"], rgba: "081f3eff", halfRgba: "ffffffff" },
    { name: "default", values: [0.25, 0.5, 0.75], half: "340038003a00", defines: [], rgba: "4080bfff", halfRgba: "4080bfff" },
    { name: "range", values: [10, 15, 20], half: "49004b804d00", defines: ["quantum:minimum=10", "quantum:maximum=20"], rgba: "0080ffff", halfRgba: "ffffffff" },
    { name: "scale override", values: [10, 20, 30], half: "49004d004f80", defines: ["quantum:minimum=10", "quantum:maximum=20", "quantum:scale=1000"], rgba: "00274eff", halfRgba: "ffffffff" },
    { name: "reversed range", values: [0, 0.5, 1], half: "000038003c00", defines: ["quantum:minimum=1", "quantum:maximum=0"], rgba: "ff8000ff", halfRgba: "0080ffff" },
    { name: "equal nonzero range", values: [0, 1, 2], half: "00003c004000", defines: ["quantum:minimum=2", "quantum:maximum=2"], rgba: "0080ffff", halfRgba: "00ffffff" },
    { name: "zero range", values: [0, 0.5, 1], half: "000038003c00", defines: ["quantum:maximum=0"], rgba: "000000ff", halfRgba: "0080ffff" },
    { name: "zero scale", values: [1000, 4000, 8000], half: "63d06bd06fd0", defines: ["quantum:scale=0"], rgba: "000000ff", halfRgba: "ffffffff" }
];

for (const depth of [16, 32, 64]) for (const mode of ["sync", "file", "stream"] as const) {
    it.each(cases)(`reads ${depth}-bit RGB with $name via ${mode}`, async ({ values, half, defines, rgba, halfRgba }) => {
        const input = depth === 16 ? Buffer.from(half, "hex") : Buffer.alloc(3 * depth / 8);
        if (depth !== 16) values.forEach((value, index) => depth === 32 ? input.writeFloatBE(value, index * 4) : input.writeDoubleBE(value, index * 8));
        if (mode === "stream") for (let offset = 0; offset < input.length; offset += depth / 8) input.subarray(offset, offset + depth / 8).reverse();
        const argv = ["-size", "1x1", "-depth", String(depth), "-endian", mode === "stream" ? "LSB" : "MSB", "-define", "quantum:format=floating-point",
            ...defines.flatMap(value => ["-define", value]), `rgb:${mode === "stream" ? "-" : "/in.raw"}`, "+define", "quantum:format",
            ...defines.flatMap(value => ["+define", value.split("=")[0]!]), "-depth", "8", "rgba:-"];
        const expected = depth === 16 ? halfRgba : rgba;
        if (mode === "sync") {
            const result = runMagickCliSync(argv, new Map([["/in.raw", input]]));
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(expected);
            return;
        }
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.raw", input);
        const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () { for (const byte of input) yield Uint8Array.of(byte); })(),
            stdout: { async write(bytes) { chunks.push(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(Buffer.concat(chunks).toString("hex")).toBe(expected);
    });
}

for (const depth of [32, 64]) for (const retained of [false, true]) {
    it.each([
        { coder: "rgb", size: "1x1", interlace: "Plane", reset: false, floating: true, expected: "123456ff" },
        { coder: "rgb", size: "1x1", interlace: "Line", reset: false, floating: true, expected: "123456ff" },
        { coder: "gray", size: "3x1", interlace: "None", reset: false, floating: true, expected: "121212ff343434ff565656ff" },
        { coder: "rgb", size: "1x1", interlace: "None", reset: true, floating: true, expected: "4080bfff" },
        ...(depth === 32 ? [{ coder: "rgb", size: "1x1", interlace: "None", reset: false, floating: false, expected: "4080bfff" }] : [])
    ])(`scales $coder $interlace input at ${depth} bits, reset=$reset, floating=$floating, retained=${retained}`, async ({ coder, size, interlace, reset, floating, expected }) => {
        const input = Buffer.alloc(3 * depth / 8);
        const values = reset || !floating ? [0.25, 0.5, 0.75] : [18, 52, 86];
        values.forEach((value, index) => !floating ? input.writeUInt32BE(Math.round(value * 4294967295), index * 4)
            : depth === 32 ? input.writeFloatBE(value, index * 4) : input.writeDoubleBE(value, index * 8));
        const argv = ["-size", size, "-depth", String(depth), "-endian", "MSB", "-interlace", interlace,
            "-define", `quantum:format=${floating ? "floating-point" : "unsigned"}`, "-define", "quantum:maximum=255",
            ...(reset ? ["-define", "quantum:minimum=-1", "-define", "quantum:scale=2", "+define", "quantum:minimum", "+define", "quantum:maximum", "+define", "quantum:scale"] : []),
            `${coder}:/in.raw`, "+define", "quantum:format", "+define", "quantum:maximum", "+interlace", "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.raw", input);
        const result = retained ? await runMagickCli(argv, { filesystem: fs, cwd: "/" }) : runMagickCliSync(argv, new Map([["/in.raw", input]]));
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(expected);
    });
}
