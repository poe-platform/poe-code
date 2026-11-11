import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Decode the SGI verbatim planar layout independently of the encoder.
function decodeRecords(bytes: Uint8Array): number[][] {
    const records: number[][] = [];
    for (let offset = 0; offset < bytes.length;) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset);
        expect(view.getUint16(0)).toBe(474);
        expect(view.getUint8(2)).toBe(0);
        expect(view.getUint8(3)).toBe(1);
        expect(view.getUint16(4)).toBe(3);
        const width = view.getUint16(6), height = view.getUint16(8), channels = view.getUint16(10);
        expect(channels).toBe(3);
        const pixels: number[] = [];
        for (let y = height - 1; y >= 0; y--) for (let x = 0; x < width; x++) {
            for (let channel = 0; channel < channels; channel++) pixels.push(view.getUint8(512 + channel * width * height + y * width + x));
        }
        records.push(pixels);
        offset += 512 + width * height * channels;
    }
    return records;
}

for (const mode of ["sync", "buffered", "stored", "command"] as const) {
    for (const write of [false, true]) {
        for (const [name, inputs, options, target, paths, expected] of [
            ["file", ["xc:red"], [], "/f.sgi", ["/f.sgi"], [[255, 0, 0]]],
            ["stdout", ["xc:red"], [], "sgi:-", [], [[255, 0, 0]]],
            ["adjoined", ["xc:red", "xc:blue"], [], "/f.sgi", ["/f.sgi"], [[255, 0, 0], [0, 0, 255]]],
            ["split", ["xc:red", "xc:blue"], ["+adjoin"], "/f.sgi", ["/f-0.sgi", "/f-1.sgi"], [[255, 0, 0], [0, 0, 255]]],
            ["sequence stdout", ["xc:red", "xc:blue"], [], "SGI:-", [], [[255, 0, 0], [0, 0, 255]]],
            ["pixel order", ["/in.ppm"], [], "sgi:/f.bin", ["/f.bin"], [[255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]]],
        ] as const) {
            it(`${mode} ${write ? "-write" : "output"} SGI ${name}`, async () => {
                const input = new Uint8Array([...new TextEncoder().encode("P6\n2 2\n255\n"), 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
                const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const args = [...inputs, "-depth", "8", ...options, ...(write ? ["-write", target, "null:"] : [target])];
                const chunks: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "stored" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const stdout = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : undefined;
                const stored = mode === "stored" || mode === "command";
                const destinations = stored ? (await fs.readdir("/")).map(entry => "/" + entry.name) : [...files.keys()];
                expect(destinations.sort()).toEqual(["/in.ppm", ...paths].sort());
                if (paths.length) {
                    expect(stdout?.length ?? 0).toBe(0);
                    const records: number[][] = [];
                    for (const path of paths) records.push(...decodeRecords(stored ? await fs.readFile(path) : files.get(path)!));
                    expect(records).toEqual(expected);
                } else {
                    expect(stdout).toBeDefined();
                    expect(decodeRecords(stdout!)).toEqual(expected);
                }
            });
        }
    }
}
