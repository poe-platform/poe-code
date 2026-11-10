import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

function pixels(bytes: Uint8Array, width = 2): string {
    const png = Buffer.from(bytes), chunks: Buffer[] = [];
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(1);
    if (png[25] === 3) {
        const image = decodeImage(bytes);
        return Buffer.from(image.data.filter((_, index) => index % 4 !== 3)).toString("hex");
    }
    expect(png[25]).toBe(2);
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
    }
    const row = inflateSync(Buffer.concat(chunks)), stride = 3 * png[24]! / 8;
    expect([0, 1]).toContain(row[0]);
    if (row[0] === 1) for (let i = 1 + stride; i < row.length; i++) row[i] = (row[i]! + row[i - stride]!) & 255;
    return row.subarray(1).toString("hex");
}

for (const mode of ["file", "stream", "sync"] as const) {
    it.each([
        { options: [], hex: "1234456789abcdef13792468", expected: "34126745ab89efcd79136824" },
        { options: ["-depth", "16", "-endian", "MSB"], hex: "1234456789abcdef13792468", expected: "1234456789abcdef13792468" },
        { options: ["-depth", "16", "-endian", "Undefined"], hex: "123456789abc1234456789ab", expected: "123456789abc1234456789ab" },
        { options: ["-depth", "16", "-endian", "LSB"], hex: "1234456789abcdef13792468", expected: "34126745ab89efcd79136824" },
        { options: ["-depth", "8"], hex: "124589cd1324", expected: "124589cd1324" }
    ])(`decodes raw RGB ${mode}: $options`, async ({ options, hex, expected }) => {
        const input = Buffer.from(hex, "hex"), argv = ["-size", "2x1", ...options, mode === "stream" ? "rgb:-" : "rgb:in.dat", "out.png"];
        if (mode === "sync") {
            const files = new Map([["in.dat", input as Uint8Array]]);
            const result = runMagickCliSync(argv, files);
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(pixels(files.get("out.png")!)).toBe(expected);
            return;
        }
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.dat", input);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () { for (const byte of input) yield Uint8Array.of(byte); })(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(pixels(await fs.readFile("/out.png"))).toBe(expected);
    });
}

it.each([
    { options: [], input: "123456789abc", error: "must specify image size" },
    { options: ["-size", "2x1"], input: "123456", error: "unexpected end-of-file" },
    { options: ["-size", "2x1", "-depth", "64"], input: "123456", error: "unsupported RGB input depth" }
])("rejects invalid raw input without overwriting output: $options", ({ options, input, error }) => {
    const original = Uint8Array.of(42), files = new Map([["in.dat", Buffer.from(input, "hex") as Uint8Array], ["out.png", original]]);
    const result = runMagickCliSync([...options, "rgb:in.dat", "out.png"], files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(error);
    expect(files.get("out.png")).toBe(original);
});


it.each([16, 32])("preserves RGB%d samples across bounded file reads", async (depth) => {
    const width = 3001, input = Uint8Array.from({ length: width * 6 }, (_, i) => i * 43 & 255);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.dat", depth === 32 ? Uint8Array.from(Array.from({ length: input.length / 2 }, (_, i) => [input[2 * i]!, input[2 * i + 1]!, input[2 * i]!, input[2 * i + 1]!]).flat()) : input);
    const args = createCommandArguments(["-size", `${width}x1`, "-depth", String(depth), "rgb:in.dat", "out.png"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(pixels(await fs.readFile("/out.png"), width)).toBe(Buffer.from(input).swap16().toString("hex"));
});
