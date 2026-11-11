import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import { rgb565RasterInput } from "./rgb565-input.js";

// ImageMagick 7.1.2-35 Q16-HDRI: raw packed words, not a BMP container.
const input = Buffer.from("00f8e0071f00ffff000000fce0ff1f78", "hex");
const rgba = "f70000ff00fb00ff0000f7fff7fbf7ff000000fff78000fff7fb00ff7800f7ff";

for (const mode of ["command", "sync"] as const) {
    it.each([
        { operand: "rgb565:in.ppm", options: ["-depth", "8"], bytes: input, expected: rgba },
        { operand: "rgb565:-", options: ["-depth", "8"], bytes: input, expected: rgba },
        { operand: "in.RGB565", options: [], bytes: input, expected: rgba },
        { operand: "RGB565:in.ppm", options: ["-endian", "MSB"], bytes: Buffer.from(input).swap16(), expected: rgba },
        { operand: "rgb565:in.ppm[1]", options: ["-size", "4x2+4"], bytes: Buffer.concat([Buffer.from("skip"), Buffer.alloc(16), input]), expected: rgba },
        { operand: "rgb:in.ppm", options: ["-depth", "8"], bytes: Buffer.from("ff000000ff000000ffffffff000000ff8000fe0180804080", "hex"), expected: "ff0000ff00ff00ff0000ffffffffffff000000ffff8000fffe0180ff804080ff" }
    ])(`reads raw pixels (${mode}): $operand $options`, async ({ operand, options, bytes, expected }) => {
        const path = operand === "in.RGB565" ? operand : "in.ppm";
        const argv = ["-size", "4x2", ...options, operand, "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        const files = new Map<string, Uint8Array>([[path, bytes]]);
        if (mode === "sync") {
            expect(runMagickCliSync(argv, files, bytes)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            expect(Buffer.from(files.get("out")!).toString("hex")).toBe(expected);
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile(`/${path}`, bytes);
            const args = createCommandArguments([...argv.slice(0, -1), "rgba:-"]);
            const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () { yield bytes.subarray(0, 3); yield bytes.subarray(3); })(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
            });
            expect(Buffer.concat(stderr).toString()).toBe("");
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
        }
    });
}

for (const retained of [false, true]) {
    it(`preserves Q16 channel expansion (${retained})`, async () => {
        const files = new Map([["/in", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in", input);
        const argv = ["-size", "4x2", "rgb565:/in", "-depth", "16", "-endian", "MSB", "rgb:/out"];
        const result = retained ? await runMagickCli(argv, { filesystem: fs, cwd: "/" }) : runMagickCliSync(argv, files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(Buffer.from(retained ? await fs.readFile("/out") : files.get("/out")!).toString("hex"))
            .toBe("f800000000000000fc00000000000000f800f800fc00f800000000000000f80080000000f800fc00000078000000f800");
    });

    it.each([
        { options: [], bytes: input, error: "must specify image size" },
        { options: ["-size", "4x2"], bytes: input.subarray(0, 15), error: "unexpected end-of-file" },
        { options: ["-size", "4x2"], bytes: Buffer.concat([input, input.subarray(0, 8)]), error: "unexpected end-of-file" }
    ])(`preserves existing output on invalid input (${retained}): $error`, async ({ options, bytes, error }) => {
        const files = new Map([["/in", bytes], ["/out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
        for (const [path, data] of files) await fs.writeFile(path, data);
        const argv = [...options, "rgb565:/in", "rgba:/out"];
        const result = retained ? await runMagickCli(argv, { filesystem: fs, cwd: "/" }) : runMagickCliSync(argv, files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(error);
        expect(Buffer.from(retained ? await fs.readFile("/out") : files.get("/out")!).toString()).toBe("KEEP");
    });
}

it("bounds RGB565 source reads and preserves partial output bytes across scenes", () => {
    const width = 5001, frame = Buffer.alloc(width * 2, 255);
    const bytes = Buffer.concat([Buffer.from("skip"), Buffer.alloc(frame.length), frame]);
    const raw = rgb565RasterInput(width, 1, bytes.length, 4);
    const header = Buffer.from(`id=ImageMagick class=DirectClass colorspace=sRGB matte=False columns=${width} rows=1 depth=16\n:\x1a`);
    const expected = Buffer.concat([header, Buffer.from("f800fc00f800".repeat(width), "hex")]);
    expect(raw.pages).toBe(2);
    for (const [position, length] of [[0, raw.size], ...Array.from({ length: header.length + 8 }, (_, i) => [i, 7])]) {
        const steps = raw.read(position!, length!, 1);
        let next = steps.next();
        while (!next.done) {
            expect(next.value.length).toBeLessThanOrEqual(8192);
            next = steps.next(bytes.subarray(next.value.position, next.value.position + next.value.length));
        }
        expect(Buffer.from(next.value)).toEqual(expected.subarray(position!, position! + length!));
    }
});
