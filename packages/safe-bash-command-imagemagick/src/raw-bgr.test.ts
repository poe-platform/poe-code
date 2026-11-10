import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, RGBA8 output in row order.
const cases = [
    { coder: "bgr", depth: 8, input: "093e73a8dd12477cb1e61b50", output: "733e09ff12dda8ffb17c47ff501be6ff" },
    { coder: "bgr", depth: 16, input: "093e73a8dd12477cb1e61b5085baef24598ec3f82d6297cc", output: "13a83eff50e67cff8e25baffcc62f8ff" },
    { coder: "bgra", depth: 8, input: "093e73a8dd12477cb1e61b5085baef24", output: "733e09a84712dd7c1be6b150efba8524" },
    { coder: "bgra", depth: 16, input: "093e73a8dd12477cb1e61b5085baef24598ec3f82d6297cc01366ba0d50a3f74", output: "13a83e7cba50e62562f88ecc0ba03674" },
    { coder: "bgro", depth: 8, input: "093e73a8dd12477cb1e61b5085baef24", output: "733e09574712dd831be6b1afefba85db" },
    { coder: "bgro", depth: 16, input: "093e73a8dd12477cb1e61b5085baef24598ec3f82d6297cc01366ba0d50a3f74", output: "13a83e83ba50e6da62f88e330ba0368b" },
    { coder: "rgb", depth: 8, input: "093e73a8dd12477cb1e61b50", output: "093e73ffa8dd12ff477cb1ffe61b50ff" },
];

for (const mode of ["file", "stream", "sync", "buffered"] as const) {
    it.each(cases)(`${mode}: decodes $coder at depth $depth`, async ({ coder, depth, input, output }) => {
        const bytes = Buffer.from(input, "hex"), keep = new TextEncoder().encode("KEEP");
        const args = ["-size", "2x2", "-depth", String(depth), `${coder}:${mode === "stream" ? "-" : "/raw.bin"}`, "-append", "-depth", "8", "rgba:/out"];
        const files = new Map<string, Uint8Array>([["/raw.bin", bytes], ["/out", keep]]);
        if (mode === "sync" || mode === "buffered") {
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect(Buffer.from(files.get("/out")!).toString("hex")).toBe(output);
            return;
        }
        const fs = new MemoryFileSystem();
        for (const [path, data] of files) await fs.writeFile(path, data);
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.from(await fs.readFile("/out")).toString("hex")).toBe(output);
    });
}

for (const mode of ["file", "sync"] as const) {
    for (const coder of ["bgr", "bgra", "bgro"]) {
        it.each([
            { options: [], input: "093e73a8", error: "must specify image size" },
            { options: ["-size", "2x2"], input: "093e73a8", error: "unexpected end-of-file" },
            { options: ["-size", "2x2"], input: "", error: "unable to open image" },
        ])(`${mode}: rejects invalid ${coder} input without replacing the destination: $error`, async ({ options, input, error }) => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/out", keep]]), fs = new MemoryFileSystem();
            if (input) files.set("/raw.bin", Buffer.from(input, "hex"));
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const args = [...options, "-depth", "8", `${coder}:/raw.bin`, "rgba:/out"];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain(error);
            expect(mode === "sync" ? files.get("/out") : await fs.readFile("/out")).toEqual(keep);
        });
    }
    for (const endian of ["LSB", "MSB"]) {
        it.each([
            { coder: "bgr", input: "123456789abc", output: "9abc56781234ffff" },
            { coder: "bgra", input: "123456789abc0000123456789abcffff", output: "9abc5678123400009abc56781234ffff" },
            { coder: "bgro", input: "123456789abc1234123456789abcffff", output: "9abc56781234edcb9abc567812340000" },
        ])(`${mode}: preserves $coder 16-bit samples across chunks with ${endian} input`, async ({ coder, input, output }) => {
            const width = 3002, repetitions = coder === "bgr" ? width : width / 2;
            const bytes = Buffer.from(input.repeat(repetitions), "hex");
            if (endian === "LSB") bytes.swap16();
            const path = `/in.${coder.toUpperCase()}`, files = new Map<string, Uint8Array>([[path, bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile(path, bytes);
            const args = ["-size", `${width}x1`, "-depth", "16", "-endian", endian, path, "-endian", "MSB", "rgba:/out"];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const actual = mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
            expect(Buffer.from(actual).toString("hex")).toBe(output.repeat(repetitions));
        });
    }
}
