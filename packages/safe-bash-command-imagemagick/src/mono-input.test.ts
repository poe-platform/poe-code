import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick MONO bytes, independent of the safe-bash writer.
const narrow = Buffer.from("a5041a070f02".repeat(4), "hex");
const wide = Uint8Array.from({ length: 33 * 12 }, (_, i) => {
    const byte = i % 33 < 32 ? ((i % 33) * 13 + Math.floor(i / 33) * 29 + 5) % 256 : 160;
    let reversed = 0;
    for (let bit = 0; bit < 8; bit++) reversed |= ((byte >>> bit) & 1) << (7 - bit);
    return reversed;
});
for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const name of ["/in.mono", "MONO:/in.bin"]) {
        it.each([
            { width: 11, input: narrow, hash: "55c314319c292a137abb00a59aeb1dfcc3a3367ac66213f2cc3635eec46ed76b" },
            { width: 259, input: wide, hash: "3073be48303ddd682a2750abd7b5f000034daa8fdab8b2cb20c7b1cc5c2e81b8" }
        ])(`decodes native $width-pixel MONO rows (${mode}, ${name})`, async ({ width, input, hash }) => {
            const path = name.startsWith("MONO:") ? name.slice(5) : name;
            const files = new Map<string, Uint8Array>([[path, input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile(path, input);
            const argv = ["-size", `${width}x12`, name, "-depth", "8", "gray:/out"];
            const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(output.length).toBe(width * 12);
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        });
    }
    it(`requires size without replacing the destination (${mode})`, async () => {
        const files = new Map([["/in.mono", narrow], ["/out", Buffer.from("KEEP")]]), filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["/in.mono", "gray:/out"];
        const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("must specify image size");
        expect(Buffer.from(mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!).toString()).toBe("KEEP");
    });
}

for (const mode of ["sync", "retained"] as const) {
    it.each([
        { options: [], input: [1, 255], expected: "00ffffffffffffff" },
        { options: ["-depth", "16", "-interlace", "Partition"], input: [1], expected: "00ffffffffffffff" },
        { options: ["-endian", "MSB"], input: [1], expected: "ff00000000000000" },
        { options: ["-endian", "LSB"], input: [1], expected: "ff00000000000000" },
        { options: ["+endian"], input: [1], expected: "ff00000000000000" },
        { options: ["-size", "8x1+1"], input: [255, 1], expected: "00ffffffffffffff" },
        { options: ["-size", "11x2"], input: [1], expected: "00ffffffffffffff0000000000000000000000000000" }
    ])(`matches native MONO settings and trailing/missing bytes (${mode}, $options)`, async ({ options, input, expected }) => {
        const files = new Map([["/in.mono", Uint8Array.from(input)]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.mono", files.get("/in.mono")!);
        const argv = ["-size", "8x1", ...options, "/in.mono", "-interlace", "None", "-depth", "8", "gray:/out"];
        const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, { filesystem, cwd: "/" });
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(Buffer.from(mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected);
    });
}
