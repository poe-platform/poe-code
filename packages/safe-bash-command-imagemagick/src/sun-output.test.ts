import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Read uncompressed RT_FORMAT_RGB Sun raster frames independently of the encoder.
function readSun(bytes: Uint8Array) {
    const frames: { width: number; height: number; rgb: number[] }[] = [];
    let offset = 0;
    while (offset < bytes.length) {
        const header = new DataView(bytes.buffer, bytes.byteOffset + offset, 32);
        expect(header.getUint32(0)).toBe(0x59a66a95);
        const width = header.getUint32(4), height = header.getUint32(8);
        expect(header.getUint32(12)).toBe(24);
        expect(header.getUint32(20)).toBe(3);
        expect(header.getUint32(24)).toBe(0);
        expect(header.getUint32(28)).toBe(0);
        const stride = width * 3 + width % 2;
        expect(header.getUint32(16)).toBe(stride * height);
        offset += 32;
        const rgb: number[] = [];
        for (let y = 0; y < height; y++) {
            rgb.push(...bytes.subarray(offset, offset + width * 3));
            offset += stride;
        }
        frames.push({ width, height, rgb });
    }
    expect(offset).toBe(bytes.length);
    return frames;
}

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const destination of ["f.sun", "SUN:f.bin", "sun:-"]) {
        for (const sequence of [false, true]) for (const write of [false, true]) {
            it(`writes Sun raster (${mode}, ${destination}, sequence=${sequence}, write=${write})`, async () => {
                const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
                const args = ["xc:red", ...(sequence ? ["xc:blue"] : []), "-depth", "8", ...(write ? ["-write", destination, "null:"] : [destination])];
                const stdout: Uint8Array[] = [], stderr: string[] = [];
                let result;
                if (mode === "command") {
                    const argumentValues = createCommandArguments(args);
                    result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues,
                        env: {}, cwd: "/", fs, stdin: (async function* () {})(), signal: new AbortController().signal,
                        stdout: { async write(chunk) { stdout.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk.slice()); } },
                        stderr: { async write(chunk) { stderr.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)); } }
                    });
                } else {
                    result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                    expect(result.stderr).toBe("");
                    if (result.stdoutBytes) stdout.push(result.stdoutBytes);
                }
                expect(result.exitCode).toBe(0);
                expect(stderr.join("")).toBe("");
                const path = destination === "f.sun" ? "f.sun" : "f.bin";
                const names = mode === "command" || mode === "retained" ? (await fs.readdir("/")).map(entry => entry.name) : [...files.keys()];
                expect(names).toEqual(destination === "sun:-" ? [] : [path]);
                const bytes = destination === "sun:-" ? Buffer.concat(stdout) : mode === "command" || mode === "retained" ? await fs.readFile("/" + path) : files.get(path)!;
                if (destination !== "sun:-") expect(stdout).toEqual([]);
                expect(readSun(bytes)).toEqual([
                    { width: 1, height: 1, rgb: [255, 0, 0] },
                    ...(sequence ? [{ width: 1, height: 1, rgb: [0, 0, 255] }] : [])
                ]);
            });
        }
    }
}

it.each(["sync", "retained"] as const)("preserves explicit scene splitting and PNG stdout (%s)", async mode => {
    for (const output of [["+adjoin", "f.sun"], ["f-%d.sun"]]) {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["xc:red", "xc:blue", "-depth", "8", ...output];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (let i = 0; i < 2; i++) {
            const bytes = mode === "sync" ? files.get(`f-${i}.sun`)! : await fs.readFile(`/f-${i}.sun`);
            expect(readSun(bytes)).toEqual([{ width: 1, height: 1, rgb: i === 0 ? [255, 0, 0] : [0, 0, 255] }]);
        }
    }
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = ["xc:red", "-depth", "8", "png:-"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect([...result.stdoutBytes!.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(files.size).toBe(0);
    expect(await fs.readdir("/")).toEqual([]);
});

it.each([2, 3, 1025])("pads rows across chunk boundaries (width %i)", async width => {
    for (const retained of [false, true]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-size", `${width}x2`, "xc:red", "sun:-"];
        const result = retained ? await runConvertCli(args, { filesystem: fs, cwd: "/" }) : runConvertCliSync(args, files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(readSun(result.stdoutBytes!)).toEqual([{ width, height: 2, rgb: Array.from({ length: width * 2 }, () => [255, 0, 0]).flat() }]);
    }
});
