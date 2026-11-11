import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync, runIdentifyCli, runIdentifyCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI; every RGBA8 byte, including half-opacity alpha.
const cases = [
    { coder: "ycbcr", input: "4c54ff962b151dff6bff7f80008080972ac95b94f45a959a", output: "ff0000ff01ff00ff0000fffffffffeff010001fffe8000fffe017fff7f4080ff" },
    { coder: "ycbcra", input: "4c54ff80962b15801dff6b80ff7f808000808080972ac9805b94f4805a959a80", output: "ff00008001ff00800000ff80fffffe8001000180fe800080fe017f807f408080" },
    { coder: "rgb", input: "ff000000ff000000ffffffff000000ff8000fe0180804080", output: "ff0000ff00ff00ff0000ffffffffffff000000ffff8000fffe0180ff804080ff" },
];

for (const mode of ["command", "stream", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: decodes $coder before converting to sRGB`, async ({ coder, input, output }) => {
        const bytes = Buffer.from(input, "hex");
        const args = ["-size", "4x2", "-depth", "8", `${coder}:${mode === "stream" ? "-" : "/in.ppm"}`, "-colorspace", "sRGB", "-depth", "8", `rgba:${mode === "sync" || mode === "buffered" ? "/out" : "-"}`];
        if (mode === "sync" || mode === "buffered") {
            const files = new Map([["/in.ppm", bytes]]);
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect(Buffer.from(files.get("/out")!).toString("hex")).toBe(output);
            return;
        }
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", bytes);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
            stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.concat(stdout).toString("hex")).toBe(output);
    });
}

for (const mode of ["retained", "sync"] as const) {
    for (const { coder, input } of cases.slice(0, 2)) {
        it(`${mode}: identifies ${coder} working channels`, async () => {
            const bytes = Buffer.from(input, "hex"), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", bytes);
            const args = ["-size", "4x2", "-depth", "8", "-format", "%[colorspace]|%[channels]", `${coder}:/in.ppm`];
            const result = mode === "sync" ? runIdentifyCliSync(args, new Map([["/in.ppm", bytes]])) : await runIdentifyCli(args, { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stdout: coder === "ycbcra" ? "YCbCr|ycbcra 4.0" : "YCbCr|ycbcr  3.0", stderr: "" });
        });
    }
}

for (const mode of ["retained", "sync"] as const) {
    for (const { coder, input, output } of cases.slice(0, 2)) {
        it.each(["LSB", "MSB"])(`${mode}: decodes .${coder} 16-bit %s samples across bounded reads`, async endian => {
            const bytes = Buffer.from([...Buffer.from(input.repeat(300), "hex")].flatMap(value => [value, value]));
            const path = `/in.${coder.toUpperCase()}`, files = new Map<string, Uint8Array>([[path, bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile(path, bytes);
            const args = ["-size", "4x600", "-depth", "16", "-endian", endian, path, "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect(Buffer.from(mode === "sync" ? files.get("/out")! : await fs.readFile("/out")).toString("hex")).toBe(output.repeat(300));
        });

        it.each([
            { options: [], error: "must specify image size" },
            { options: ["-size", "4x3"], error: "unexpected end-of-file" },
        ])(`${mode}: rejects invalid ${coder} input: $error`, async ({ options, error }) => {
            const bytes = Buffer.from(input, "hex"), keep = new TextEncoder().encode("KEEP"), fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>([["/in.ppm", bytes], ["/out", keep]]);
            for (const [path, data] of files) await fs.writeFile(path, data);
            const args = [...options, "-depth", "8", `${coder}:/in.ppm`, "-colorspace", "sRGB", "rgba:/out"];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain(error);
            expect(mode === "sync" ? files.get("/out") : await fs.readFile("/out")).toEqual(keep);
        });
    }
}
