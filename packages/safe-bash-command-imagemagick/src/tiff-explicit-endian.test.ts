import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI writes MM for either explicit -endian value.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: [], marker: "II" },
        { options: ["-endian", "MSB"], marker: "MM" },
        { options: ["-endian", "LSB"], marker: "MM" },
        { options: ["-endian", "Undefined"], marker: "MM" },
        { options: ["-endian", "LSB", "+endian"], marker: "MM" },
        { options: ["-endian", "MSB", "-define", "tiff:endian=lsb"], marker: "II" },
        { options: ["-endian", "LSB", "-define", "tiff:endian=msb"], marker: "MM" },
        { options: ["-define", "tiff:endian=lsb", "-endian", "MSB"], marker: "II" },
        { options: ["-endian", "LSB", "-define", "tiff:endian=lsb", "+define", "tiff:endian"], marker: "MM" }
    ])(`${mode}: writes native TIFF byte order with $options`, async ({ options, marker }) => {
        const argv = ["xc:#123456789abc", "-depth", "16", ...options, "-write", "/copy.tif", "TIFF:-"];
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(argv);
        const result: { exitCode: number; stderr?: string; stdoutBytes?: Uint8Array } = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr ?? stderr).toBe("");
        const stdout = mode === "command" ? Buffer.concat(chunks)
            : result.stdoutBytes!;
        const written = mode === "command" || mode === "retained" ? await fs.readFile("/copy.tif") : files.get("/copy.tif")!;
        for (const bytes of [stdout, written]) {
            expect(new TextDecoder().decode(bytes.subarray(0, 2))).toBe(marker);
            expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(2, marker === "II")).toBe(42);
            expect(decodeImage(bytes).data).toEqual(Uint8Array.of(18, 86, 154, 255));
        }
    });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each(["TIFF", "TIFF64"])(`${mode}: applies explicit endian to separate %s frames`, async format => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:#123456789abc", "xc:#123456789abc", "-depth", "16", "-endian", "LSB", "+adjoin",
            "-write", `${format}:/copy.tif`, `${format}:/out.tif`];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const path of ["/copy-0.tif", "/copy-1.tif", "/out-0.tif", "/out-1.tif"]) {
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            expect(new TextDecoder().decode(bytes.subarray(0, 2))).toBe("MM");
            expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(2)).toBe(format === "TIFF" ? 42 : 43);
            expect(decodeImage(bytes).data).toEqual(Uint8Array.of(18, 86, 154, 255));
        }
    });
}
