import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const write of [false, true]) {
        for (const sequence of [false, true]) {
            it.each(["/out.dds", "DDS:/out.bin", "dds:-", "png:-"])(`writes the first image as DDS (${mode}, write=${write}, sequence=${sequence}): %s`, async target => {
                const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
                const args = ["xc:red", ...(sequence ? ["xc:blue"] : []), "-depth", "8", ...(write ? ["-write", target, "null:"] : [target])];
                const chunks: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? { ...await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout: "", stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                const stdout = mode === "command" ? Buffer.concat(chunks) : Buffer.from(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
                const path = target.includes(":") ? target.slice(target.indexOf(":") + 1) : target;
                const stored = mode === "retained" || mode === "command";
                const names = stored ? (await filesystem.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
                expect(names).toEqual(path === "-" ? [] : [path]);
                if (path !== "-") expect(stdout.length).toBe(0);
                const bytes = path === "-" ? stdout : Buffer.from(stored ? await filesystem.readFile(path) : files.get(path)!);
                if (target === "png:-") {
                    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
                    expect([...decodeImage(bytes).data]).toEqual(sequence ? [0, 0, 255, 255] : [255, 0, 0, 255]);
                    return;
                }
                expect(bytes.subarray(0, 8).toString("hex")).toBe("444453207c000000");
                expect(bytes.readUInt32LE(12)).toBe(1); // height
                expect(bytes.readUInt32LE(16)).toBe(1); // width
                expect(bytes.readUInt32LE(76)).toBe(32); // DDS_PIXELFORMAT size
                expect(bytes.readUInt32LE(80) & 0x40).toBe(0x40); // uncompressed RGB
                const bits = bytes.readUInt32LE(88), pixel = bytes.readUInt32LE(128);
                expect(bits).toBe(32);
                expect(pixel & bytes.readUInt32LE(92)).toBe(bytes.readUInt32LE(92)); // red
                expect(pixel & bytes.readUInt32LE(96)).toBe(0); // green
                expect(pixel & bytes.readUInt32LE(100)).toBe(0); // blue
                expect(bytes.length).toBe(132); // one pixel, no second image
            });
        }
    }
}

for (const stored of [false, true]) {
    it(`preserves dimensions, rows and alpha across DDS storage chunks (stored=${stored})`, async () => {
        const args = ["-size", "129x129", "xc:#11223344", "-depth", "8", "dds:-"];
        const result = stored ? await runConvertCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" }) : runConvertCliSync(args, new Map());
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = Buffer.from(result.stdoutBytes!);
        expect(bytes.readUInt32LE(12)).toBe(129);
        expect(bytes.readUInt32LE(16)).toBe(129);
        expect(bytes.readUInt32LE(20)).toBe(129 * 4);
        expect(bytes.readUInt32LE(80)).toBe(0x41);
        expect(bytes.readUInt32LE(104)).toBe(0xff000000);
        expect(bytes.subarray(128)).toEqual(Buffer.from(Array.from({ length: 129 * 129 }, () => [0x11, 0x22, 0x33, 0x44]).flat()));
    });
}
